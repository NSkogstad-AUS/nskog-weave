/**
 * Pure factory functions for constructing canvas node objects and AI batch
 * request helpers. No React dependencies.
 */

import {
  DEFAULT_FILE_PAGE_WORKER_FOCUS,
  DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
  DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
  getWorkerModeMeta,
} from '@/lib/filePageWorkers';
import type {
  FilePageContentItem,
  FilePageNode,
  FilePageWorkerMode,
  FilePageWorkerRunMode,
} from '@/types/filePage';
import { GROUP_MIN_GRID_UNITS } from './constants';
import type { CanvasPaletteTemplateId } from './CanvasPaletteSidebar';

// ─── Size helpers ─────────────────────────────────────────────────────────────

export function areSizesEqual(
  left: FilePageNode['size'],
  right: FilePageNode['size'],
): boolean {
  return left.widthUnits === right.widthUnits && left.heightUnits === right.heightUnits;
}

export function getMinimumNodeSize(node: FilePageNode): FilePageNode['size'] {
  if (node.kind === 'group') {
    return { widthUnits: GROUP_MIN_GRID_UNITS, heightUnits: GROUP_MIN_GRID_UNITS };
  }
  if (node.kind === 'worker') {
    return { widthUnits: 2, heightUnits: 2 };
  }
  return { widthUnits: 1, heightUnits: 1 };
}

// ─── Node factories ───────────────────────────────────────────────────────────

export function buildBasicElementNode(): Omit<FilePageNode, 'position'> {
  return {
    id: `element-${Date.now()}`,
    label: 'Basic element',
    description: 'Freeform canvas object for quick thinking and placement.',
    kind: 'element',
    icon: 'sparkles',
    size: { widthUnits: 1, heightUnits: 1 },
  };
}

export function buildGroupNode(): Omit<FilePageNode, 'position'> {
  return {
    id: `group-${Date.now()}`,
    label: 'Group',
    description: 'Shared canvas region for clustering related notes and files.',
    kind: 'group',
    icon: 'shapes',
    size: { widthUnits: 3, heightUnits: 2 },
  };
}

export function buildWorkerNode(mode: FilePageWorkerMode): Omit<FilePageNode, 'position'> {
  const meta = getWorkerModeMeta(mode);
  return {
    id: `worker-${Date.now()}`,
    label: meta.defaultNodeLabel,
    description: meta.defaultNodeDescription,
    kind: 'worker',
    icon: 'target',
    size: { widthUnits: 3, heightUnits: 3 },
    contentItems: [],
    generatedByWorkerId: null,
    workerMode: mode,
    workerFocus: DEFAULT_FILE_PAGE_WORKER_FOCUS,
    workerRunMode: DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
    workerOutputMode: DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
    workerStatus: 'idle',
    workerProgress: 0,
    workerOutputFolderId: null,
    workerInputSignature: null,
    workerLastError: null,
  };
}

export function buildCanvasPaletteNode(
  templateId: CanvasPaletteTemplateId,
): Omit<FilePageNode, 'position'> {
  switch (templateId) {
    case 'ai-worker':
      return buildWorkerNode('ai-ready');
    case 'sort-worker':
      return buildWorkerNode('sort-data');
    case 'group':
      return buildGroupNode();
    case 'element':
    default:
      return buildBasicElementNode();
  }
}

// ─── AI batch request helpers ─────────────────────────────────────────────────

export const AI_WORKER_REQUEST_BATCH_SETTINGS: Record<
  FilePageWorkerRunMode,
  {
    maxFilesPerRequest: number;
    targetTotalCharacters: number;
    clientTimeoutMultiplier: number;
  }
> = {
  fast: {
    maxFilesPerRequest: 4,
    targetTotalCharacters: 9_000,
    clientTimeoutMultiplier: 1.15,
  },
  balanced: {
    maxFilesPerRequest: 6,
    targetTotalCharacters: 18_000,
    clientTimeoutMultiplier: 1.3,
  },
  thorough: {
    maxFilesPerRequest: 8,
    targetTotalCharacters: 28_000,
    clientTimeoutMultiplier: 1.45,
  },
};

/** Always 2 concurrent requests regardless of run mode (reserved for future tuning). */
export function getAiWorkerRequestConcurrency(_runMode: FilePageWorkerRunMode): number {
  return 2;
}

/**
 * Splits source files into batches respecting per-request file-count and
 * character-count limits for the given run mode.
 */
export function buildAiWorkerRequestBatches<T extends { textContent?: string | null }>(
  items: T[],
  runMode: FilePageWorkerRunMode,
): T[][] {
  const { maxFilesPerRequest, targetTotalCharacters } = AI_WORKER_REQUEST_BATCH_SETTINGS[runMode];
  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentBatchCharacters = 0;

  for (const item of items) {
    const itemCharacters = (item.textContent ?? '').trim().length;
    const wouldExceedFileLimit = currentBatch.length >= maxFilesPerRequest;
    const wouldExceedCharacterTarget =
      currentBatch.length > 0 && currentBatchCharacters + itemCharacters > targetTotalCharacters;

    if ((wouldExceedFileLimit || wouldExceedCharacterTarget) && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchCharacters = 0;
    }

    currentBatch.push(item);
    currentBatchCharacters += itemCharacters;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/** Metadata about a canvas palette item for rendering the sidebar. */
export interface CanvasPaletteNodeMeta {
  id: CanvasPaletteTemplateId;
  label: string;
  description: string;
  section: 'Workers' | 'Structure';
}

/** Builds the full list of palette sidebar items in display order. */
export function buildCanvasPaletteItems(): CanvasPaletteNodeMeta[] {
  const aiWorkerMeta = getWorkerModeMeta('ai-ready');
  const sortWorkerMeta = getWorkerModeMeta('sort-data');

  return [
    {
      id: 'ai-worker',
      label: aiWorkerMeta.defaultNodeLabel,
      description: aiWorkerMeta.defaultNodeDescription,
      section: 'Workers',
    },
    {
      id: 'sort-worker',
      label: sortWorkerMeta.defaultNodeLabel,
      description: sortWorkerMeta.defaultNodeDescription,
      section: 'Workers',
    },
    {
      id: 'element',
      label: 'Basic element',
      description: 'Freeform canvas object for quick thinking and placement.',
      section: 'Structure',
    },
    {
      id: 'group',
      label: 'Group',
      description: 'Shared canvas region for clustering related notes, workers, and files.',
      section: 'Structure',
    },
  ];
}

export type { FilePageContentItem };
