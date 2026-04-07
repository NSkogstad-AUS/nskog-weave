import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type WorkerRunInput = {
  label: string;
  description: string;
  textContent: string;
  mimeType: string | null;
};

type WorkerRunRequest = {
  mode: string;
  workerLabel: string;
  inputs: WorkerRunInput[];
};

type WorkerOutputFile = {
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
const MAX_INPUT_CHARACTERS_PER_FILE = 24_000;

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
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
  const content = (payload as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  })?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .flatMap((item) =>
      typeof item?.text === 'string' ? [item.text] : [],
    )
    .join('\n');
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

  const inputs = (payload as { inputs: unknown[] }).inputs.flatMap((input) => {
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof (input as { label?: unknown }).label !== 'string' ||
      typeof (input as { textContent?: unknown }).textContent !== 'string'
    ) {
      return [];
    }

    const label = (input as { label: string }).label.trim();
    const textContent = (input as { textContent: string }).textContent.trim();

    if (!label || !textContent) {
      return [];
    }

    return [
      {
        label,
        description:
          typeof (input as { description?: unknown }).description === 'string'
            ? (input as { description: string }).description.trim()
            : '',
        textContent: textContent.slice(0, MAX_INPUT_CHARACTERS_PER_FILE),
        mimeType:
          typeof (input as { mimeType?: unknown }).mimeType === 'string' &&
          (input as { mimeType: string }).mimeType.trim().length > 0
            ? (input as { mimeType: string }).mimeType
            : null,
      },
    ];
  });

  return {
    mode: (payload as { mode: string }).mode,
    workerLabel: (payload as { workerLabel: string }).workerLabel.trim(),
    inputs: inputs.slice(0, MAX_INPUT_FILES),
  };
}

function getWorkerProviderConfig(): WorkerProviderConfig | null {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (openRouterApiKey) {
    return {
      provider: 'openrouter',
      apiKey: openRouterApiKey,
      model: process.env.OPENROUTER_MODEL?.trim() || 'qwen/qwen3-32b',
    };
  }

  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();

  if (openAiApiKey) {
    return {
      provider: 'openai',
      apiKey: openAiApiKey,
      model: process.env.OPENAI_MODEL?.trim() || 'gpt-5.4-mini',
    };
  }

  return null;
}

function getWorkerOutputJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      files: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
            contentText: { type: 'string' },
          },
          required: ['label', 'description', 'contentText'],
        },
      },
    },
    required: ['files'],
  } as const;
}

function getWorkerOutputJsonExample() {
  return {
    files: [
      {
        label: 'Source Pack 1',
        description: 'Short description of the extracted source pack.',
        contentText: '# Summary\n\nConcise markdown artifact here.',
      },
    ],
  } as const;
}

function buildWorkerMessages(requestBody: WorkerRunRequest) {
  return [
    {
      role: 'system',
      content:
        'You are an AI worker that converts source files into concise markdown files optimized for downstream AI use. Produce one output file per input file. Each output should preserve critical facts while removing fluff.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        workerLabel: requestBody.workerLabel || 'AI Worker',
        instructions: [
          'Return JSON only.',
          'For each input, create a concise markdown artifact.',
          'Use sections when useful: Summary, Key Facts, Entities, Open Questions, Follow-ups.',
          'Keep each output focused and practical.',
          'Always return an object with a top-level "files" array.',
          'Each file must include: "label", "description", and "contentText".',
          `Example shape: ${JSON.stringify(getWorkerOutputJsonExample())}`,
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

function readProviderErrorMessage(payload: unknown, fallbackMessage: string) {
  const directMessage =
    typeof (payload as { error?: { message?: unknown } })?.error?.message === 'string'
      ? (payload as { error: { message: string } }).error.message.trim()
      : '';

  if (directMessage) {
    return directMessage;
  }

  const metadataMessage =
    typeof (payload as { metadata?: { raw?: string } })?.metadata?.raw === 'string'
      ? (payload as { metadata: { raw: string } }).metadata.raw.trim()
      : '';

  if (metadataMessage) {
    return metadataMessage;
  }

  return fallbackMessage;
}

async function sendOpenRouterRequest(
  providerConfig: Extract<WorkerProviderConfig, { provider: 'openrouter' }>,
  body: Record<string, unknown>,
) {
  const upstreamResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${providerConfig.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:5173',
      'X-OpenRouter-Title': 'nskog-weave',
    },
    body: JSON.stringify(body),
  });
  const upstreamPayload = await upstreamResponse.json().catch(() => null);

  return {
    upstreamResponse,
    upstreamPayload,
  };
}

async function runOpenRouterWorker(
  providerConfig: Extract<WorkerProviderConfig, { provider: 'openrouter' }>,
  requestBody: WorkerRunRequest,
) {
  const baseRequestBody = {
    model: providerConfig.model,
    messages: buildWorkerMessages(requestBody),
    temperature: 0.2,
    stream: false,
  } satisfies Record<string, unknown>;

  const strictAttempt = await sendOpenRouterRequest(providerConfig, {
    ...baseRequestBody,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'worker_output_bundle',
        strict: true,
        schema: getWorkerOutputJsonSchema(),
      },
    },
    provider: {
      require_parameters: true,
    },
  });

  if (strictAttempt.upstreamResponse.ok) {
    return extractOpenRouterResponseText(strictAttempt.upstreamPayload);
  }

  const fallbackAttempt = await sendOpenRouterRequest(providerConfig, {
    ...baseRequestBody,
    response_format: {
      type: 'json_object',
    },
    plugins: [{ id: 'response-healing' }],
  });

  if (!fallbackAttempt.upstreamResponse.ok) {
    const strictErrorMessage = readProviderErrorMessage(
      strictAttempt.upstreamPayload,
      'The OpenRouter API request failed.',
    );
    const fallbackErrorMessage = readProviderErrorMessage(
      fallbackAttempt.upstreamPayload,
      'The OpenRouter API request failed.',
    );

    throw new Error(
      strictErrorMessage === fallbackErrorMessage
        ? fallbackErrorMessage
        : `${fallbackErrorMessage} (fallback after structured-output failure: ${strictErrorMessage})`,
    );
  }

  return extractOpenRouterResponseText(fallbackAttempt.upstreamPayload);
}

async function runOpenAiWorker(
  providerConfig: Extract<WorkerProviderConfig, { provider: 'openai' }>,
  requestBody: WorkerRunRequest,
) {
  const upstreamResponse = await fetch('https://api.openai.com/v1/responses', {
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
      text: {
        format: {
          type: 'json_schema',
          name: 'worker_output_bundle',
          strict: true,
          schema: getWorkerOutputJsonSchema(),
        },
      },
    }),
  });
  const upstreamPayload = await upstreamResponse.json().catch(() => null);

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
  const parsedPayload = JSON.parse(extractJsonPayload(responseText)) as {
    files?: Array<{ label?: unknown; description?: unknown; contentText?: unknown }>;
  };

  return Array.isArray(parsedPayload.files)
    ? parsedPayload.files.flatMap((file) => {
        if (
          typeof file?.label !== 'string' ||
          typeof file?.description !== 'string' ||
          typeof file?.contentText !== 'string'
        ) {
          return [];
        }

        const label = file.label.trim();
        const description = file.description.trim();
        const contentText = file.contentText.trim();

        if (!label || !contentText) {
          return [];
        }

        return [
          {
            label,
            description,
            contentText,
          },
        ];
      })
    : [];
}

async function handleWorkerRun(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    sendJson(response, 405, {
      error: 'Use POST for /api/worker/run.',
    });
    return;
  }

  const providerConfig = getWorkerProviderConfig();

  if (!providerConfig) {
    sendJson(response, 500, {
      error: 'OPENROUTER_API_KEY or OPENAI_API_KEY is missing. Add one to your local environment before running the AI worker.',
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

  let responseText = '';

  try {
    responseText =
      providerConfig.provider === 'openrouter'
        ? await runOpenRouterWorker(providerConfig, requestBody)
        : await runOpenAiWorker(providerConfig, requestBody);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'The model provider request failed.',
    });
    return;
  }

  try {
    const files = parseWorkerOutputFiles(responseText);

    sendJson(response, 200, { files });
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
