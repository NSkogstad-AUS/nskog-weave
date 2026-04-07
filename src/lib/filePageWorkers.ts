import type { FilePageNode, FilePageWorkerMode } from '@/types/filePage';

export const DEFAULT_FILE_PAGE_WORKER_MODE: FilePageWorkerMode = 'ai-ready';

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

export function resolveWorkerMode(mode: FilePageNode['workerMode']): FilePageWorkerMode {
  return mode ?? DEFAULT_FILE_PAGE_WORKER_MODE;
}

export function getWorkerModeMeta(mode: FilePageNode['workerMode']) {
  return WORKER_MODE_META[resolveWorkerMode(mode)];
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
