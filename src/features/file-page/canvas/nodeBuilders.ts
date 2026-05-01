/**
 * Pure factory functions for constructing canvas node objects.
 * No React dependencies.
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
    case 'sort-worker':
      return buildWorkerNode('sort-data');
    case 'group':
      return buildGroupNode();
    case 'element':
    default:
      return buildBasicElementNode();
  }
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
  const sortWorkerMeta = getWorkerModeMeta('sort-data');

  return [
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
      description: 'Shared canvas region for clustering related notes and files.',
      section: 'Structure',
    },
  ];
}

export type { FilePageContentItem };
