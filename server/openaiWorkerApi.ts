import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type WorkerRunInput = {
  sourceItemId: string;
  label: string;
  description: string;
  textContent: string;
  mimeType: string | null;
};

type WorkerRunMode = 'fast' | 'balanced' | 'thorough';
type WorkerRunOutputMode = 'per-file' | 'collated';

type WorkerRunRequest = {
  mode: string;
  focus: 'general' | 'coding' | 'describing' | 'research';
  runMode: WorkerRunMode;
  outputMode: WorkerRunOutputMode;
  workerLabel: string;
  inputs: WorkerRunInput[];
};

type WorkerOutputFile = {
  sourceItemId: string;
  label: string;
  description: string;
  contentText: string;
};

type WorkerProviderConfig =
  | {
      provider: 'openrouter';
      apiKey: string;
      model: string;
    }
  | {
      provider: 'openai';
      apiKey: string;
      model: string;
    };

const MAX_INPUT_FILES = 8;
const COLLATED_WORKER_SOURCE_ITEM_ID = '__collated__';
const OPENROUTER_EMPTY_BODY_RETRY_DELAY_MS = 600;
const inFlightWorkerRuns = new Map<string, Promise<string>>();

const WORKER_RUN_SETTINGS: Record<
  WorkerRunMode,
  {
    maxInputCharactersPerFile: number;
    maxTotalInputCharacters: number;
    maxCollatedInputCharacters: number;
    providerTimeoutMs: number;
    openRouterMaxTokens: number;
    openAiMaxOutputTokens: number;
  }
> = {
  fast: {
    maxInputCharactersPerFile: 10_000,
    maxTotalInputCharacters: 12_000,
    maxCollatedInputCharacters: 9_000,
    providerTimeoutMs: 14_000,
    openRouterMaxTokens: 900,
    openAiMaxOutputTokens: 900,
  },
  balanced: {
    maxInputCharactersPerFile: 18_000,
    maxTotalInputCharacters: 22_000,
    maxCollatedInputCharacters: 16_000,
    providerTimeoutMs: 22_000,
    openRouterMaxTokens: 1_600,
    openAiMaxOutputTokens: 1_600,
  },
  thorough: {
    maxInputCharactersPerFile: 28_000,
    maxTotalInputCharacters: 34_000,
    maxCollatedInputCharacters: 24_000,
    providerTimeoutMs: 34_000,
    openRouterMaxTokens: 2_400,
    openAiMaxOutputTokens: 2_400,
  },
};

const OPENROUTER_PROVIDER_PREFERENCES: Record<
  WorkerRunMode,
  {
    sort: 'latency' | 'throughput';
    preferredMaxLatencySeconds: number;
    preferredMinThroughputTokensPerSecond: number;
  }
> = {
  fast: {
    sort: 'latency',
    preferredMaxLatencySeconds: 6,
    preferredMinThroughputTokensPerSecond: 35,
  },
  balanced: {
    sort: 'throughput',
    preferredMaxLatencySeconds: 10,
    preferredMinThroughputTokensPerSecond: 45,
  },
  thorough: {
    sort: 'throughput',
    preferredMaxLatencySeconds: 14,
    preferredMinThroughputTokensPerSecond: 55,
  },
};

function getOpenRouterModelForRunMode(runMode: WorkerRunMode) {
  const modeOverride =
    runMode === 'fast'
      ? process.env.OPENROUTER_MODEL_FAST?.trim()
      : runMode === 'thorough'
        ? process.env.OPENROUTER_MODEL_THOROUGH?.trim()
        : process.env.OPENROUTER_MODEL_BALANCED?.trim();

  return modeOverride || process.env.OPENROUTER_MODEL?.trim() || 'qwen/qwen3-32b';
}

function getOpenAiModelForRunMode(runMode: WorkerRunMode) {
  const modeOverride =
    runMode === 'fast'
      ? process.env.OPENAI_MODEL_FAST?.trim()
      : runMode === 'thorough'
        ? process.env.OPENAI_MODEL_THOROUGH?.trim()
        : process.env.OPENAI_MODEL_BALANCED?.trim();

  return modeOverride || process.env.OPENAI_MODEL?.trim() || 'gpt-5.4-mini';
}

function getOpenRouterOutputTokenBudget(requestBody: WorkerRunRequest) {
  const runSettings = WORKER_RUN_SETTINGS[requestBody.runMode];

  if (requestBody.outputMode === 'collated') {
    return runSettings.openRouterMaxTokens;
  }

  const perInputBudget =
    requestBody.runMode === 'fast'
      ? 220
      : requestBody.runMode === 'thorough'
        ? 420
        : 320;

  return Math.min(
    runSettings.openRouterMaxTokens,
    Math.max(perInputBudget, perInputBudget * requestBody.inputs.length),
  );
}

function getOpenAiOutputTokenBudget(requestBody: WorkerRunRequest) {
  const runSettings = WORKER_RUN_SETTINGS[requestBody.runMode];

  if (requestBody.outputMode === 'collated') {
    return runSettings.openAiMaxOutputTokens;
  }

  const perInputBudget =
    requestBody.runMode === 'fast'
      ? 220
      : requestBody.runMode === 'thorough'
        ? 420
        : 320;

  return Math.min(
    runSettings.openAiMaxOutputTokens,
    Math.max(perInputBudget, perInputBudget * requestBody.inputs.length),
  );
}

function distributeInputCharacterBudget(
  inputs: WorkerRunInput[],
  {
    maxInputCharactersPerFile,
    maxTotalInputCharacters,
  }: {
    maxInputCharactersPerFile: number;
    maxTotalInputCharacters: number;
  },
) {
  const clampedInputs = inputs.map((input) => ({
    ...input,
    textContent: input.textContent.trim().slice(0, maxInputCharactersPerFile),
  }));

  if (clampedInputs.length === 0) {
    return clampedInputs;
  }

  let remainingBudget = Math.max(1, maxTotalInputCharacters);
  const characterBudgets = new Array(clampedInputs.length).fill(0);
  let pendingIndexes = clampedInputs
    .map((input, index) => ({
      index,
      maxLength: Math.min(maxInputCharactersPerFile, input.textContent.length),
    }))
    .filter((entry) => entry.maxLength > 0);

  while (remainingBudget > 0 && pendingIndexes.length > 0) {
    const fairShare = Math.max(1, Math.floor(remainingBudget / pendingIndexes.length));
    const nextPendingIndexes: typeof pendingIndexes = [];

    pendingIndexes.forEach(({ index, maxLength }) => {
      const remainingLength = maxLength - characterBudgets[index];

      if (remainingLength <= 0 || remainingBudget <= 0) {
        return;
      }

      const grantedCharacters = Math.min(remainingLength, fairShare, remainingBudget);
      characterBudgets[index] += grantedCharacters;
      remainingBudget -= grantedCharacters;

      if (characterBudgets[index] < maxLength) {
        nextPendingIndexes.push({ index, maxLength });
      }
    });

    if (nextPendingIndexes.length === pendingIndexes.length) {
      break;
    }

    pendingIndexes = nextPendingIndexes;
  }

  return clampedInputs.flatMap((input, index) => {
    const allocatedCharacters = Math.max(0, characterBudgets[index] ?? 0);
    const nextTextContent = input.textContent.slice(0, allocatedCharacters).trim();

    if (!nextTextContent) {
      return [];
    }

    return [
      {
        ...input,
        textContent: nextTextContent,
      },
    ];
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function formatTimeoutLabel(milliseconds: number) {
  return `${Math.max(1, Math.round(milliseconds / 1000))}s`;
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

async function fetchJsonWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    const rawText = await response.text().catch(() => '');
    const contentType = response.headers.get('content-type')?.trim() ?? '';
    let payload: unknown = null;
    let jsonParseError: string | null = null;
    let didParseJson = false;

    if (rawText.trim().length > 0) {
      try {
        payload = JSON.parse(rawText) as unknown;
        didParseJson = true;
      } catch (error) {
        jsonParseError =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'The response body was not valid JSON.';
      }
    }

    return {
      response,
      payload,
      rawText,
      contentType,
      jsonParseError,
      didParseJson,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `The model provider timed out after ${formatTimeoutLabel(timeoutMs)}. Try Fast mode, fewer files, or a faster model.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractResponseText(payload: unknown) {
  if (typeof (payload as { output_text?: unknown })?.output_text === 'string') {
    return (payload as { output_text: string }).output_text;
  }

  if (!Array.isArray((payload as { output?: unknown })?.output)) {
    return '';
  }

  return (payload as { output: Array<{ content?: Array<{ type?: string; text?: string }> }> }).output
    .flatMap((item) => item.content ?? [])
    .flatMap((contentItem) =>
      contentItem.type === 'output_text' && typeof contentItem.text === 'string'
        ? [contentItem.text]
        : [],
    )
    .join('\n');
}

function extractOpenRouterResponseText(payload: unknown) {
  const choices = (payload as {
    choices?: Array<{
      text?: unknown;
      message?: {
        content?: unknown;
      };
    }>;
  })?.choices;

  if (!Array.isArray(choices)) {
    return '';
  }

  return choices
    .flatMap((choice) => {
      if (typeof choice?.text === 'string' && choice.text.trim().length > 0) {
        return [choice.text.trim()];
      }

      const content = choice?.message?.content;

      if (typeof content === 'string' && content.trim().length > 0) {
        return [content.trim()];
      }

      if (!Array.isArray(content)) {
        return [];
      }

      return content.flatMap((item) =>
        typeof item?.text === 'string' && item.text.trim().length > 0
          ? [item.text.trim()]
          : [],
      );
    })
    .join('\n');
}

function readOpenRouterChoiceError(payload: unknown) {
  const choiceError = (payload as {
    choices?: Array<{
      error?: unknown;
    }>;
  })?.choices?.find((choice) => Boolean(choice?.error))?.error;

  if (!choiceError) {
    return '';
  }

  return readProviderErrorMessage({ error: choiceError }, 'The OpenRouter completion failed.');
}

function readOpenRouterNoContentReason(payload: unknown) {
  const firstChoice = (payload as {
    choices?: Array<{
      finish_reason?: unknown;
      native_finish_reason?: unknown;
      message?: {
        tool_calls?: unknown;
      };
    }>;
  })?.choices?.[0];

  if (!firstChoice) {
    return '';
  }

  const finishReason =
    typeof firstChoice.finish_reason === 'string' && firstChoice.finish_reason.trim().length > 0
      ? firstChoice.finish_reason.trim()
      : '';
  const nativeFinishReason =
    typeof firstChoice.native_finish_reason === 'string' &&
    firstChoice.native_finish_reason.trim().length > 0
      ? firstChoice.native_finish_reason.trim()
      : '';
  const hasToolCalls = Array.isArray(firstChoice.message?.tool_calls) && firstChoice.message.tool_calls.length > 0;
  const detailParts = [
    finishReason ? `finish_reason: ${finishReason}` : '',
    nativeFinishReason ? `native_finish_reason: ${nativeFinishReason}` : '',
    hasToolCalls ? 'tool calls returned instead of text' : '',
  ].filter(Boolean);

  return detailParts.length > 0 ? ` (${detailParts.join('; ')})` : '';
}

function isOpenRouterLengthTruncated(payload: unknown) {
  const firstChoice = (payload as {
    choices?: Array<{
      finish_reason?: unknown;
      native_finish_reason?: unknown;
    }>;
  })?.choices?.[0];
  const finishReason =
    typeof firstChoice?.finish_reason === 'string'
      ? firstChoice.finish_reason.trim().toLowerCase()
      : '';
  const nativeFinishReason =
    typeof firstChoice?.native_finish_reason === 'string'
      ? firstChoice.native_finish_reason.trim().toLowerCase()
      : '';

  return [finishReason, nativeFinishReason].some((value) =>
    ['length', 'max_tokens', 'max_output_tokens'].includes(value),
  );
}

function buildOpenRouterFallbackResponseText(
  payload: unknown,
  upstreamResponse: Response,
  rawText: string,
  contentType: string,
  jsonParseError: string | null,
  didParseJson: boolean,
  requestBody: WorkerRunRequest,
) {
  const firstChoice = (payload as {
    choices?: Array<{
      finish_reason?: unknown;
      native_finish_reason?: unknown;
      message?: {
        role?: unknown;
      };
    }>;
  })?.choices?.[0];
  const noContentReason = readOpenRouterNoContentReason(payload);
  const trimmedRawText = rawText.trim();
  const rawBodyPreview =
    trimmedRawText.length > 0
      ? trimmedRawText.slice(0, 4_000)
      : '';
  const bodySummary =
    didParseJson
      ? 'The provider returned JSON, but it did not contain extractable assistant text.'
      : rawBodyPreview.length === 0
        ? 'The provider response body was empty.'
        : 'The provider response body was not valid JSON.'
  ;

  return JSON.stringify(
    {
      files:
        requestBody.outputMode === 'collated'
          ? [
              {
                sourceItemId: COLLATED_WORKER_SOURCE_ITEM_ID,
                label: 'Collated AI Output',
                description: 'Fallback output captured from a non-standard OpenRouter response.',
                contentText: [
                  '# Provider Response',
                  '',
                  'OpenRouter returned a successful HTTP status, but no standard assistant text content was extracted.',
                  '',
                  `http_status: ${upstreamResponse.status}${upstreamResponse.statusText ? ` ${upstreamResponse.statusText}` : ''}`,
                  contentType ? `content_type: ${contentType}` : '',
                  firstChoice?.message?.role ? `role: ${String(firstChoice.message.role)}` : '',
                  typeof firstChoice?.finish_reason === 'string'
                    ? `finish_reason: ${firstChoice.finish_reason}`
                    : '',
                  typeof firstChoice?.native_finish_reason === 'string'
                    ? `native_finish_reason: ${firstChoice.native_finish_reason}`
                    : '',
                  noContentReason ? `details:${noContentReason}` : '',
                  jsonParseError ? `json_parse_error: ${jsonParseError}` : '',
                  '',
                  bodySummary,
                  '',
                  payload === null
                    ? rawBodyPreview
                      ? '```text'
                      : ''
                    : '```json',
                  payload === null
                    ? rawBodyPreview
                    : JSON.stringify(payload, null, 2),
                  payload === null
                    ? rawBodyPreview
                      ? '```'
                      : ''
                    : '```',
                ]
                  .filter(Boolean)
                  .join('\n'),
              },
            ]
          : requestBody.inputs.map((input, index) => ({
              sourceItemId: input.sourceItemId,
              label: input.label.trim() || `AI Output ${index + 1}`,
              description: 'Fallback output captured from a non-standard OpenRouter response.',
              contentText: [
                '# Provider Response',
                '',
                'OpenRouter returned a successful HTTP status, but no standard assistant text content was extracted.',
                '',
                `http_status: ${upstreamResponse.status}${upstreamResponse.statusText ? ` ${upstreamResponse.statusText}` : ''}`,
                contentType ? `content_type: ${contentType}` : '',
                firstChoice?.message?.role ? `role: ${String(firstChoice.message.role)}` : '',
                typeof firstChoice?.finish_reason === 'string'
                  ? `finish_reason: ${firstChoice.finish_reason}`
                  : '',
                typeof firstChoice?.native_finish_reason === 'string'
                  ? `native_finish_reason: ${firstChoice.native_finish_reason}`
                  : '',
                noContentReason ? `details:${noContentReason}` : '',
                jsonParseError ? `json_parse_error: ${jsonParseError}` : '',
                '',
                bodySummary,
                '',
                payload === null
                  ? rawBodyPreview
                    ? '```text'
                    : ''
                  : '```json',
                payload === null
                  ? rawBodyPreview
                  : JSON.stringify(payload, null, 2),
                payload === null
                  ? rawBodyPreview
                    ? '```'
                    : ''
                  : '```',
              ]
                .filter(Boolean)
                .join('\n'),
            })),
    },
    null,
    2,
  );
}

function normalizeWorkerRunRequest(payload: unknown): WorkerRunRequest | null {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as { mode?: unknown }).mode !== 'string' ||
    typeof (payload as { workerLabel?: unknown }).workerLabel !== 'string' ||
    !Array.isArray((payload as { inputs?: unknown }).inputs)
  ) {
    return null;
  }

  const runMode =
    (payload as { runMode?: unknown }).runMode === 'fast' ||
    (payload as { runMode?: unknown }).runMode === 'thorough'
      ? (payload as { runMode: 'fast' | 'thorough' }).runMode
      : 'balanced';
  const runSettings = WORKER_RUN_SETTINGS[runMode];
  const outputMode =
    (payload as { outputMode?: unknown }).outputMode === 'collated'
      ? 'collated'
      : 'per-file';
  const rawInputs = (payload as { inputs: unknown[] }).inputs.flatMap((input) => {
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof (input as { sourceItemId?: unknown }).sourceItemId !== 'string' ||
      typeof (input as { label?: unknown }).label !== 'string' ||
      typeof (input as { textContent?: unknown }).textContent !== 'string'
    ) {
      return [];
    }

    const sourceItemId = (input as { sourceItemId: string }).sourceItemId.trim();
    const label = (input as { label: string }).label.trim();
    const textContent = (input as { textContent: string }).textContent.trim();

    if (!sourceItemId || !label || !textContent) {
      return [];
    }

    return [
      {
        sourceItemId,
        label,
        description:
          typeof (input as { description?: unknown }).description === 'string'
            ? (input as { description: string }).description.trim()
            : '',
        textContent,
        mimeType:
          typeof (input as { mimeType?: unknown }).mimeType === 'string' &&
          (input as { mimeType: string }).mimeType.trim().length > 0
            ? (input as { mimeType: string }).mimeType
            : null,
      },
    ];
  });
  const inputs = distributeInputCharacterBudget(rawInputs.slice(0, MAX_INPUT_FILES), {
    maxInputCharactersPerFile: runSettings.maxInputCharactersPerFile,
    maxTotalInputCharacters:
      outputMode === 'collated'
        ? runSettings.maxCollatedInputCharacters
        : runSettings.maxTotalInputCharacters,
  });

  return {
    mode: (payload as { mode: string }).mode,
    focus:
      (payload as { focus?: unknown }).focus === 'coding' ||
      (payload as { focus?: unknown }).focus === 'describing' ||
      (payload as { focus?: unknown }).focus === 'research'
        ? (payload as { focus: 'coding' | 'describing' | 'research' }).focus
        : 'general',
    runMode,
    outputMode,
    workerLabel: (payload as { workerLabel: string }).workerLabel.trim(),
    inputs: inputs.slice(0, MAX_INPUT_FILES),
  };
}

function getWorkerProviderConfig(runMode: WorkerRunMode): WorkerProviderConfig | null {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (openRouterApiKey) {
    return {
      provider: 'openrouter',
      apiKey: openRouterApiKey,
      model: getOpenRouterModelForRunMode(runMode),
    };
  }

  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();

  if (openAiApiKey) {
    return {
      provider: 'openai',
      apiKey: openAiApiKey,
      model: getOpenAiModelForRunMode(runMode),
    };
  }

  return null;
}

function getWorkerOutputJsonSchema(requestBody: WorkerRunRequest) {
  const expectedSourceItemIds =
    requestBody.outputMode === 'collated'
      ? [COLLATED_WORKER_SOURCE_ITEM_ID]
      : requestBody.inputs.map((input) => input.sourceItemId);
  const fileSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      sourceItemId: {
        type: 'string',
        enum: expectedSourceItemIds,
      },
      label: { type: 'string' },
      description: { type: 'string' },
      contentText: { type: 'string' },
    },
    required: ['sourceItemId', 'label', 'description', 'contentText'],
  } as const;

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      files: {
        type: 'array',
        items: fileSchema,
        minItems: expectedSourceItemIds.length,
        maxItems: expectedSourceItemIds.length,
      },
    },
    required: ['files'],
  } as const;
}

function getWorkerOutputJsonExample(outputMode: WorkerRunRequest['outputMode']) {
  return outputMode === 'collated'
    ? {
        files: [
          {
            sourceItemId: COLLATED_WORKER_SOURCE_ITEM_ID,
            label: 'Collated Source Pack',
            description: 'Combined AI-ready source pack covering all connected inputs.',
            contentText: '# Summary\n\nSingle combined markdown artifact here.',
          },
        ],
      }
    : {
        files: [
          {
            sourceItemId: 'source-file-1',
            label: 'Source Pack 1',
            description: 'Short description of the extracted source pack.',
            contentText: '# Summary\n\nConcise markdown artifact here.',
          },
        ],
      } as const;
}

function getWorkerFocusInstructions(focus: WorkerRunRequest['focus']) {
  switch (focus) {
    case 'coding':
      return [
        'Prioritize code-facing details, interfaces, data structures, constraints, and implementation notes.',
        'Use headings like Purpose, Interfaces, Data Shape, Constraints, Risks, and Implementation Notes when useful.',
      ];
    case 'describing':
      return [
        'Prioritize plain-language explanation, terminology, context, and the clearest way to describe the source to another person.',
        'Use headings like Overview, Important Details, Terminology, and Description Notes when useful.',
      ];
    case 'research':
      return [
        'Prioritize evidence, claims, named entities, chronology, open questions, and anything that needs verification.',
        'Use headings like Summary, Evidence, Entities, Open Questions, and Follow-ups when useful.',
      ];
    default:
      return [
        'Create a balanced AI-ready pack with summary, key facts, entities, and next-useful details.',
        'Optimize for fast orientation by another downstream model.',
      ];
  }
}

function getWorkerRunModeInstructions(runMode: WorkerRunRequest['runMode']) {
  switch (runMode) {
    case 'fast':
      return [
        'Optimize for speed. Keep the output compact and skip lower-value detail.',
        'Prefer shorter sections and tighter summaries.',
      ];
    case 'thorough':
      return [
        'Be more comprehensive when the input supports it. Keep the result structured, but include more useful detail.',
        'Preserve important nuance that may matter to downstream reasoning.',
      ];
    default:
      return [
        'Balance speed and completeness.',
      ];
  }
}

function buildWorkerMessages(requestBody: WorkerRunRequest) {
  const collatedMode = requestBody.outputMode === 'collated';
  const taskLine = collatedMode
    ? 'Combine all inputs into one concise markdown source pack for downstream AI use.'
    : `Create ${requestBody.inputs.length} concise markdown source packs, one for each input.`;
  const mappingLine = collatedMode
    ? `Return one file using sourceItemId "${COLLATED_WORKER_SOURCE_ITEM_ID}".`
    : 'Use each input sourceItemId in the matching output file.';

  return [
    {
      role: 'system',
      content: [
        'You convert source files into concise markdown packs optimized for downstream AI use.',
        taskLine,
        mappingLine,
        'Preserve critical facts and remove fluff.',
        'Prefer compact, useful sections instead of long prose.',
        ...getWorkerRunModeInstructions(requestBody.runMode),
        ...getWorkerFocusInstructions(requestBody.focus),
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        workerLabel: requestBody.workerLabel || 'AI Worker',
        focus: requestBody.focus,
        runMode: requestBody.runMode,
        outputMode: requestBody.outputMode,
        instructions: [
          'Return JSON only.',
          collatedMode
            ? 'Cover every input in the combined output.'
            : 'Do not merge multiple inputs into one output and do not omit any input.',
          'Keep labels and descriptions short and practical.',
          'Use headings only when they add signal.',
          `Example shape: ${JSON.stringify(getWorkerOutputJsonExample(requestBody.outputMode))}`,
        ],
        inputs: requestBody.inputs,
      }),
    },
  ] as const;
}

function extractJsonPayload(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '';
  }

  const fencedMatch = trimmedValue.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstObjectIndex = trimmedValue.indexOf('{');
  const lastObjectIndex = trimmedValue.lastIndexOf('}');

  if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
    return trimmedValue.slice(firstObjectIndex, lastObjectIndex + 1).trim();
  }

  return trimmedValue;
}

function stringifyProviderRawError(value: unknown) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return '';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readProviderErrorMessage(payload: unknown, fallbackMessage: string) {
  const errorPayload = (payload as {
    error?: {
      code?: unknown;
      message?: unknown;
      metadata?: {
        provider_name?: unknown;
        raw?: unknown;
      };
    };
  })?.error;

  const directMessage =
    typeof errorPayload?.message === 'string'
      ? errorPayload.message.trim()
      : '';

  const providerName =
    typeof errorPayload?.metadata?.provider_name === 'string'
      ? errorPayload.metadata.provider_name.trim()
      : '';
  const rawMessage = stringifyProviderRawError(errorPayload?.metadata?.raw);
  const errorCode =
    typeof errorPayload?.code === 'number' || typeof errorPayload?.code === 'string'
      ? String(errorPayload.code)
      : '';
  const baseMessage = directMessage || rawMessage || fallbackMessage;
  const details = [
    providerName ? `provider: ${providerName}` : '',
    errorCode ? `code: ${errorCode}` : '',
    rawMessage && rawMessage !== directMessage
      ? `raw: ${rawMessage.slice(0, 220)}${rawMessage.length > 220 ? '...' : ''}`
      : '',
  ].filter(Boolean);

  return details.length > 0 ? `${baseMessage} (${details.join('; ')})` : baseMessage;
}

function createWorkerRunCacheKey(
  providerConfig: WorkerProviderConfig,
  requestBody: WorkerRunRequest,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        provider: providerConfig.provider,
        model: providerConfig.model,
        requestBody,
      }),
    )
    .digest('hex');
}

async function sendOpenRouterRequest(
  providerConfig: Extract<WorkerProviderConfig, { provider: 'openrouter' }>,
  runSettings: (typeof WORKER_RUN_SETTINGS)[WorkerRunMode],
  body: Record<string, unknown>,
) {
  const {
    response: upstreamResponse,
    payload: upstreamPayload,
    rawText,
    contentType,
    jsonParseError,
    didParseJson,
  } = await fetchJsonWithTimeout(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'nskog-weave',
      },
      body: JSON.stringify(body),
    },
    runSettings.providerTimeoutMs,
  );

  return {
    upstreamResponse,
    upstreamPayload,
    rawText,
    contentType,
    jsonParseError,
    didParseJson,
  };
}

function getOpenRouterProviderOptions(runMode: WorkerRunMode) {
  const providerPreferences = OPENROUTER_PROVIDER_PREFERENCES[runMode];

  return {
    sort: providerPreferences.sort,
    allow_fallbacks: true,
    require_parameters: true,
    preferred_max_latency: {
      p90: providerPreferences.preferredMaxLatencySeconds,
    },
    preferred_min_throughput: {
      p50: providerPreferences.preferredMinThroughputTokensPerSecond,
    },
  } as const;
}

function shouldRetryOpenRouterWithBasicPayload(payload: unknown, rawText: string) {
  const errorMessage = readProviderErrorMessage(payload, rawText).toLowerCase();

  return [
    'response_format',
    'json_schema',
    'reasoning',
    'require_parameters',
    'unsupported',
    'not supported',
    'invalid provider route',
    'no endpoints found',
    'requested parameters',
    'provider routing',
    'codes/routing',
    'plugin',
  ].some((token) => errorMessage.includes(token));
}

function shouldRetryOpenRouterSuccessfulButUnusableResponse(
  payload: unknown,
  rawText: string,
) {
  if (rawText.trim().length === 0) {
    return true;
  }

  return extractOpenRouterResponseText(payload).trim().length === 0;
}

async function runOpenRouterWorker(
  providerConfig: Extract<WorkerProviderConfig, { provider: 'openrouter' }>,
  requestBody: WorkerRunRequest,
) {
  const runSettings = WORKER_RUN_SETTINGS[requestBody.runMode];
  const baseRequestBodyPayload = {
    model: providerConfig.model,
    messages: buildWorkerMessages(requestBody),
    max_tokens: getOpenRouterOutputTokenBudget(requestBody),
    temperature: 0,
    top_p: 1,
    stream: false,
  } satisfies Record<string, unknown>;
  const requestBodyPayload = {
    ...baseRequestBodyPayload,
    reasoning: {
      effort: 'none',
      exclude: true,
    },
    provider: getOpenRouterProviderOptions(requestBody.runMode),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'worker_output_bundle',
        strict: true,
        schema: getWorkerOutputJsonSchema(requestBody),
      },
    },
    plugins: [
      {
        id: 'response-healing',
      },
    ],
  } satisfies Record<string, unknown>;
  const basicRequestBodyPayload = {
    ...baseRequestBodyPayload,
  } satisfies Record<string, unknown>;
  let emptyBodyAttempts = 0;

  const sendWithGuardedRetry = async (body: Record<string, unknown>) => {
    let responseResult: Awaited<ReturnType<typeof sendOpenRouterRequest>> | null = null;
    emptyBodyAttempts = 0;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      responseResult = await sendOpenRouterRequest(providerConfig, runSettings, body);

      if (
        responseResult.upstreamResponse.ok &&
        responseResult.rawText.trim().length === 0
      ) {
        emptyBodyAttempts += 1;

        if (attempt === 0) {
          await delay(OPENROUTER_EMPTY_BODY_RETRY_DELAY_MS);
          continue;
        }
      }

      break;
    }

    return responseResult;
  };

  let lastResponse = await sendWithGuardedRetry(requestBodyPayload);

  if (
    lastResponse &&
    !lastResponse.upstreamResponse.ok &&
    shouldRetryOpenRouterWithBasicPayload(lastResponse.upstreamPayload, lastResponse.rawText)
  ) {
    lastResponse = await sendWithGuardedRetry(basicRequestBodyPayload);
  }

  if (
    lastResponse &&
    lastResponse.upstreamResponse.ok &&
    shouldRetryOpenRouterSuccessfulButUnusableResponse(
      lastResponse.upstreamPayload,
      lastResponse.rawText,
    )
  ) {
    lastResponse = await sendWithGuardedRetry(basicRequestBodyPayload);
  }

  if (!lastResponse) {
    throw new Error('The OpenRouter API request did not return a response.');
  }

  const {
    upstreamResponse,
    upstreamPayload,
    rawText,
    contentType,
    jsonParseError,
    didParseJson,
  } = lastResponse;

  if (!upstreamResponse.ok) {
    if (upstreamPayload !== null) {
      throw new Error(
        readProviderErrorMessage(upstreamPayload, 'The OpenRouter API request failed.'),
      );
    }

    const rawBodySummary = rawText.trim().slice(0, 220);
    throw new Error(
      [
        `The OpenRouter API request failed with status ${upstreamResponse.status}.`,
        contentType ? `content-type: ${contentType}.` : '',
        jsonParseError ? `json_parse_error: ${jsonParseError}.` : '',
        rawBodySummary ? `raw body: ${rawBodySummary}${rawText.trim().length > 220 ? '...' : ''}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  const choiceError = readOpenRouterChoiceError(upstreamPayload);

  if (choiceError) {
    throw new Error(choiceError);
  }

  const responseText = extractOpenRouterResponseText(upstreamPayload);

  if (!responseText.trim()) {
    const fallbackResponseText = buildOpenRouterFallbackResponseText(
      upstreamPayload,
      upstreamResponse,
      rawText,
      contentType,
      jsonParseError,
      didParseJson,
      requestBody,
    );

    if (emptyBodyAttempts > 1) {
      const parsedFallbackPayload = JSON.parse(fallbackResponseText) as {
        files?: Array<{
          contentText?: string;
        }>;
      };

      if (Array.isArray(parsedFallbackPayload.files)) {
        parsedFallbackPayload.files = parsedFallbackPayload.files.map((file) => ({
          ...file,
          contentText: [
            typeof file?.contentText === 'string' ? file.contentText : '',
            '',
            'OpenRouter returned an empty HTTP 200 body twice, so the worker stopped after one guarded retry.',
          ]
            .filter(Boolean)
            .join('\n'),
        }));
      }

      return JSON.stringify(parsedFallbackPayload, null, 2);
    }

    return fallbackResponseText;
  }

  if (isOpenRouterLengthTruncated(upstreamPayload)) {
    const truncatedFiles = parseWorkerOutputFiles(responseText);

    if (truncatedFiles.length > 0) {
      return JSON.stringify(
        {
          files: annotateTruncatedWorkerOutputFiles(truncatedFiles),
        },
        null,
        2,
      );
    }
  }

  return responseText;
}

async function runOpenAiWorker(
  providerConfig: Extract<WorkerProviderConfig, { provider: 'openai' }>,
  requestBody: WorkerRunRequest,
) {
  const runSettings = WORKER_RUN_SETTINGS[requestBody.runMode];
  const { response: upstreamResponse, payload: upstreamPayload } = await fetchJsonWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: providerConfig.model,
        input: buildWorkerMessages(requestBody).map((message) => ({
          role: message.role,
          content: [
            {
              type: 'input_text',
              text: message.content,
            },
          ],
        })),
        max_output_tokens: getOpenAiOutputTokenBudget(requestBody),
        text: {
          format: {
            type: 'json_schema',
            name: 'worker_output_bundle',
            strict: true,
            schema: getWorkerOutputJsonSchema(requestBody),
          },
        },
      }),
    },
    runSettings.providerTimeoutMs,
  );

  if (!upstreamResponse.ok) {
    throw new Error(
      typeof (upstreamPayload as { error?: { message?: unknown } })?.error?.message === 'string'
        ? (upstreamPayload as { error: { message: string } }).error.message
        : 'The OpenAI API request failed.',
    );
  }

  return extractResponseText(upstreamPayload);
}

function parseWorkerOutputFiles(responseText: string): WorkerOutputFile[] {
  let parsedPayload: {
    files?: Array<{
      sourceItemId?: unknown;
      label?: unknown;
      description?: unknown;
      contentText?: unknown;
      content?: unknown;
      markdown?: unknown;
      text?: unknown;
    }>;
  };

  try {
    parsedPayload = JSON.parse(extractJsonPayload(responseText)) as {
      files?: Array<{
        sourceItemId?: unknown;
        label?: unknown;
        description?: unknown;
        contentText?: unknown;
        content?: unknown;
        markdown?: unknown;
        text?: unknown;
      }>;
    };
  } catch {
    return [];
  }

  return Array.isArray(parsedPayload.files)
    ? parsedPayload.files.flatMap((file) => {
        if (
          typeof file?.sourceItemId !== 'string' ||
          typeof file?.label !== 'string'
        ) {
          return [];
        }

        const sourceItemId = file.sourceItemId.trim();
        const label = file.label.trim();
        const description =
          typeof file.description === 'string'
            ? file.description.trim()
            : '';
        const rawContent =
          typeof file.contentText === 'string'
            ? file.contentText
            : typeof file.content === 'string'
              ? file.content
              : typeof file.markdown === 'string'
                ? file.markdown
                : typeof file.text === 'string'
                  ? file.text
                  : '';
        const contentText = rawContent.trim();

        if (!sourceItemId || !label || !contentText) {
          return [];
        }

        return [
          {
            sourceItemId,
            label,
            description,
            contentText,
          },
        ];
      })
    : [];
}

function buildFallbackWorkerOutputFiles(
  responseText: string,
  requestBody: WorkerRunRequest,
): WorkerOutputFile[] {
  const trimmedResponseText = extractJsonPayload(responseText).trim() || responseText.trim();

  if (!trimmedResponseText) {
    return [];
  }

  return requestBody.outputMode === 'collated'
    ? [
        {
          sourceItemId: COLLATED_WORKER_SOURCE_ITEM_ID,
          label: 'Collated AI Output',
          description: 'Fallback output captured from the raw model response.',
          contentText: trimmedResponseText,
        },
      ]
    : requestBody.inputs.map((input, index) => ({
        sourceItemId: input.sourceItemId,
        label: input.label.trim() || `AI Output ${index + 1}`,
        description: 'Fallback output captured from the raw model response.',
        contentText: trimmedResponseText,
      }));
}

function annotateTruncatedWorkerOutputFiles(files: WorkerOutputFile[]) {
  return files.map((file) => ({
    ...file,
    description:
      file.description.trim().length > 0
        ? `${file.description.trim()} Partial output captured before the model hit its response limit.`
        : 'Partial output captured before the model hit its response limit.',
    contentText: `${file.contentText.trim()}\n\n> Note: The model hit its response limit before finishing this output. Try Thorough mode or fewer files if you need a longer result.`,
  }));
}

async function handleWorkerRun(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    sendJson(response, 405, {
      error: 'Use POST for /api/worker/run.',
    });
    return;
  }

  let parsedRequestBody: unknown;

  try {
    parsedRequestBody = JSON.parse((await readRequestBody(request)) || '{}');
  } catch {
    sendJson(response, 400, {
      error: 'The AI worker request body could not be parsed as JSON.',
    });
    return;
  }

  const requestBody = normalizeWorkerRunRequest(parsedRequestBody);

  if (!requestBody) {
    sendJson(response, 400, {
      error: 'The AI worker request body is invalid.',
    });
    return;
  }

  if (requestBody.mode !== 'ai-ready') {
    sendJson(response, 400, {
      error: 'Only ai-ready workers use the API route.',
    });
    return;
  }

  if (requestBody.inputs.length === 0) {
    sendJson(response, 400, {
      error: 'At least one text-bearing input file is required.',
    });
    return;
  }

  const providerConfig = getWorkerProviderConfig(requestBody.runMode);

  if (!providerConfig) {
    sendJson(response, 500, {
      error: 'OPENROUTER_API_KEY or OPENAI_API_KEY is missing. Add one to your local environment before running the AI worker.',
    });
    return;
  }

  let responseText = '';
  const workerRunCacheKey = createWorkerRunCacheKey(providerConfig, requestBody);

  try {
    const inFlightRun = inFlightWorkerRuns.get(workerRunCacheKey);

    if (inFlightRun) {
      responseText = await inFlightRun;
    } else {
      const nextRun =
        providerConfig.provider === 'openrouter'
          ? runOpenRouterWorker(providerConfig, requestBody)
          : runOpenAiWorker(providerConfig, requestBody);

      inFlightWorkerRuns.set(workerRunCacheKey, nextRun);

      try {
        responseText = await nextRun;
      } finally {
        if (inFlightWorkerRuns.get(workerRunCacheKey) === nextRun) {
          inFlightWorkerRuns.delete(workerRunCacheKey);
        }
      }
    }
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'The model provider request failed.',
    });
    return;
  }

  try {
    const files = parseWorkerOutputFiles(responseText);
    const resolvedFiles =
      files.length > 0 ? files : buildFallbackWorkerOutputFiles(responseText, requestBody);

    if (resolvedFiles.length === 0) {
      sendJson(response, 500, {
        error: 'The model returned no usable worker files.',
      });
      return;
    }

    sendJson(response, 200, { files: resolvedFiles });
  } catch {
    sendJson(response, 500, {
      error:
        providerConfig.provider === 'openrouter'
          ? 'OpenRouter returned a response that could not be parsed as worker output.'
          : 'The OpenAI API returned a response that could not be parsed as worker output.',
    });
  }
}

function createWorkerMiddleware() {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url?.startsWith('/api/worker/run')) {
      next();
      return;
    }

    try {
      await handleWorkerRun(request, response);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'The AI worker failed unexpectedly.',
      });
    }
  };
}

export function openAiWorkerApiPlugin(): Plugin {
  return {
    name: 'openai-worker-api',
    configureServer(server) {
      server.middlewares.use(createWorkerMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createWorkerMiddleware());
    },
  };
}
