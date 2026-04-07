import type {
  FilePageNode,
  FilePageWorkerFocus,
  FilePageWorkerMode,
  FilePageWorkerOutputMode,
  FilePageWorkerRunMode,
} from '@/types/filePage';

export const DEFAULT_FILE_PAGE_WORKER_MODE: FilePageWorkerMode = 'ai-ready';
export const DEFAULT_FILE_PAGE_WORKER_FOCUS: FilePageWorkerFocus = 'general';
export const DEFAULT_FILE_PAGE_WORKER_RUN_MODE: FilePageWorkerRunMode = 'balanced';
export const DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE: FilePageWorkerOutputMode = 'per-file';

type WorkerFocusMeta = {
  label: string;
  promptLabel: string;
  promptInstructions: string[];
};

type WorkerOutputModeMeta = {
  label: string;
  shortLabel: string;
};

type WorkerRunModeMeta = {
  label: string;
  shortLabel: string;
  timeoutLabel: string;
  clientTimeoutMs: number;
};

type WorkerModeMeta = {
  badgeLabel: string;
  defaultNodeLabel: string;
  defaultNodeDescription: string;
  outputFolderLabel: string;
  outputFolderDescription: string;
  runActionLabel: string;
  requiresManualRun: boolean;
  idleStatusMessage: string;
  completeStatusMessage: string;
  outputPlacementMessage: string;
  transformOutputLabel: (label: string, index: number, total: number) => string;
};

const WORKER_MODE_META: Record<FilePageWorkerMode, WorkerModeMeta> = {
  'ai-ready': {
    badgeLabel: 'AI Ready',
    defaultNodeLabel: 'AI Worker',
    defaultNodeDescription: 'Transforms connected files and folders into AI-ready source packs.',
    outputFolderLabel: 'AI Ready Files',
    outputFolderDescription: 'Generated output from the connected worker.',
    runActionLabel: 'Run AI',
    requiresManualRun: true,
    idleStatusMessage: 'Connect inputs',
    completeStatusMessage: 'Output ready',
    outputPlacementMessage: 'Output on right',
    transformOutputLabel: (label) => `${label} AI Ready`,
  },
  'sort-data': {
    badgeLabel: 'Sort Data',
    defaultNodeLabel: 'Sort Worker',
    defaultNodeDescription: 'Orders connected files and folders into a sorted output set.',
    outputFolderLabel: 'Sorted Data',
    outputFolderDescription: 'Generated sorted output from the connected worker.',
    runActionLabel: 'Run sort',
    requiresManualRun: false,
    idleStatusMessage: 'Connect inputs',
    completeStatusMessage: 'Sorted output ready',
    outputPlacementMessage: 'Output on right',
    transformOutputLabel: (label, index, total) =>
      `${String(index + 1).padStart(String(total).length, '0')}. ${label}`,
  },
};

const WORKER_FOCUS_META: Record<FilePageWorkerFocus, WorkerFocusMeta> = {
  general: {
    label: 'General',
    promptLabel: 'general AI-ready source pack',
    promptInstructions: [
      'Create a balanced AI-ready pack with concise summary, key facts, entities, and next-useful details.',
      'Optimize for a downstream model that needs quick orientation without reading the full source.',
    ],
  },
  coding: {
    label: 'Coding',
    promptLabel: 'coding-oriented AI-ready source pack',
    promptInstructions: [
      'Preserve implementation details, APIs, data structures, file formats, constraints, and actionable code-facing notes.',
      'Prefer headings like Purpose, Interfaces, Data Shape, Constraints, Risks, and Implementation Notes.',
    ],
  },
  describing: {
    label: 'Describing',
    promptLabel: 'descriptive AI-ready source pack',
    promptInstructions: [
      'Emphasize plain-language explanation, context, terminology, and the clearest way to describe the source to another person.',
      'Prefer headings like Overview, Important Details, Terminology, and Description Notes.',
    ],
  },
  research: {
    label: 'Research',
    promptLabel: 'research-oriented AI-ready source pack',
    promptInstructions: [
      'Emphasize evidence, claims, entities, chronology, open questions, and anything that needs verification.',
      'Prefer headings like Summary, Evidence, Entities, Open Questions, and Follow-ups.',
    ],
  },
};

const WORKER_OUTPUT_MODE_META: Record<FilePageWorkerOutputMode, WorkerOutputModeMeta> = {
  'per-file': {
    label: 'One for each file',
    shortLabel: 'Per file',
  },
  collated: {
    label: 'Collated in one file',
    shortLabel: 'Collated',
  },
};

const WORKER_RUN_MODE_META: Record<FilePageWorkerRunMode, WorkerRunModeMeta> = {
  fast: {
    label: 'Fast (30s)',
    shortLabel: 'Fast',
    timeoutLabel: '30s',
    clientTimeoutMs: 30_000,
  },
  balanced: {
    label: 'Balanced (50s)',
    shortLabel: 'Balanced',
    timeoutLabel: '50s',
    clientTimeoutMs: 50_000,
  },
  thorough: {
    label: 'Thorough (75s)',
    shortLabel: 'Thorough',
    timeoutLabel: '75s',
    clientTimeoutMs: 75_000,
  },
};

export function resolveWorkerMode(mode: FilePageNode['workerMode']): FilePageWorkerMode {
  return mode ?? DEFAULT_FILE_PAGE_WORKER_MODE;
}

export function getWorkerModeMeta(mode: FilePageNode['workerMode']) {
  return WORKER_MODE_META[resolveWorkerMode(mode)];
}

export function resolveWorkerFocus(focus: FilePageNode['workerFocus']): FilePageWorkerFocus {
  return focus ?? DEFAULT_FILE_PAGE_WORKER_FOCUS;
}

export function getWorkerFocusMeta(focus: FilePageNode['workerFocus']) {
  return WORKER_FOCUS_META[resolveWorkerFocus(focus)];
}

export function getWorkerFocusOptions() {
  return Object.entries(WORKER_FOCUS_META).map(([value, meta]) => ({
    value: value as FilePageWorkerFocus,
    label: meta.label,
  }));
}

export function resolveWorkerRunMode(
  runMode: FilePageNode['workerRunMode'],
): FilePageWorkerRunMode {
  return runMode ?? DEFAULT_FILE_PAGE_WORKER_RUN_MODE;
}

export function getWorkerRunModeMeta(runMode: FilePageNode['workerRunMode']) {
  return WORKER_RUN_MODE_META[resolveWorkerRunMode(runMode)];
}

export function getWorkerRunModeOptions() {
  return Object.entries(WORKER_RUN_MODE_META).map(([value, meta]) => ({
    value: value as FilePageWorkerRunMode,
    label: meta.label,
  }));
}

export function resolveWorkerOutputMode(
  outputMode: FilePageNode['workerOutputMode'],
): FilePageWorkerOutputMode {
  return outputMode ?? DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE;
}

export function getWorkerOutputModeMeta(outputMode: FilePageNode['workerOutputMode']) {
  return WORKER_OUTPUT_MODE_META[resolveWorkerOutputMode(outputMode)];
}

export function getWorkerOutputModeOptions() {
  return Object.entries(WORKER_OUTPUT_MODE_META).map(([value, meta]) => ({
    value: value as FilePageWorkerOutputMode,
    label: meta.label,
  }));
}

export function getWorkerClientTimeoutMs(runMode: FilePageNode['workerRunMode']) {
  return getWorkerRunModeMeta(runMode).clientTimeoutMs;
}

export function getWorkerStatusMessage(
  mode: FilePageNode['workerMode'],
  status: FilePageNode['workerStatus'],
  progress: number,
  errorMessage?: string | null,
) {
  const workerMode = resolveWorkerMode(mode);
  const workerMeta = getWorkerModeMeta(workerMode);

  if (status === 'error') {
    return errorMessage?.trim() || 'Worker run failed.';
  }

  if (status === 'processing') {
    if (workerMode === 'sort-data') {
      if (progress < 34) {
        return 'Loading...';
      }

      if (progress < 72) {
        return 'Sorting...';
      }

      return 'Preparing output...';
    }

    if (progress < 34) {
      return 'Loading...';
    }

    if (progress < 72) {
      return 'Processing...';
    }

    return 'Preparing output...';
  }

  if (status === 'complete') {
    return workerMeta.completeStatusMessage;
  }

  return workerMeta.idleStatusMessage;
}

export function getWorkerOutputItemLabel(
  mode: FilePageNode['workerMode'],
  label: string,
  index: number,
  total: number,
) {
  return getWorkerModeMeta(mode).transformOutputLabel(label, index, total);
}
