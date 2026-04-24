import type { WorkspaceFile } from '@/data/sidebarNavigation';
import type { FilePageNode, FilePageState } from '@/types/filePage';
import {
  DEFAULT_FILE_PAGE_WORKER_FOCUS,
  DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
  DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
} from './filePageWorkers';

export const FILE_PAGES_STORAGE_KEY = 'weave:file-pages:v1';

const KIND_RANK: Record<FilePageNode['kind'], number> = {
  folder: 0,
  file: 1,
  group: 2,
  worker: 3,
  element: 4,
};

const ELEMENT_LABELS: Record<WorkspaceFile['kind'], string> = {
  canvas: 'Loose element',
  brief: 'Summary block',
  memo: 'Working note',
  outline: 'Outline point',
};

const ELEMENT_DESCRIPTIONS: Record<WorkspaceFile['kind'], string> = {
  canvas: 'Freeform canvas object for quick thinking and placement.',
  brief: 'Condensed block for key points, framing, and takeaways.',
  memo: 'Short-form working note for capturing context and decisions.',
  outline: 'Structured outline item for sequencing ideas and sections.',
};

export function createDefaultFilePage(file: WorkspaceFile): FilePageState {
  const baseLabel = file.label.trim() || 'Untitled file';
  const elementNode = createNode(`${file.id}-element-core`, ELEMENT_LABELS[file.kind], 'element', 250, 428);

  elementNode.description = ELEMENT_DESCRIPTIONS[file.kind];

  return {
    view: file.contentText ? 'document' : 'canvas',
    nodes: [
      createNode(`${file.id}-folder-context`, 'Context', 'folder', 72, 72),
      createNode(`${file.id}-folder-assets`, 'Assets', 'folder', 332, 104),
      createNode(`${file.id}-file-primary`, baseLabel, 'file', 112, 248),
      createNode(`${file.id}-file-references`, 'References', 'file', 396, 286),
      elementNode,
    ],
  };
}

export function sortFilePageNodes(nodes: FilePageNode[]) {
  return [...nodes].sort(
    (left, right) =>
      KIND_RANK[left.kind] - KIND_RANK[right.kind] || left.label.localeCompare(right.label),
  );
}

function createNode(
  id: string,
  label: string,
  kind: FilePageNode['kind'],
  x: number,
  y: number,
): FilePageNode {
  return {
    id,
    label,
    description:
      kind === 'element'
        ? 'Freeform canvas object.'
        : kind === 'group'
          ? 'Shared region for clustering related canvas items.'
          : kind === 'worker'
            ? 'Automates transformations across connected canvas files.'
          : '',
    kind,
    icon:
      kind === 'folder' || kind === 'group'
        ? 'shapes'
        : kind === 'worker'
          ? 'target'
        : kind === 'file'
          ? 'message-square'
          : 'sparkles',
    groupId: null,
    parentNodeId: null,
    contentItems: [],
    generatedByWorkerId: null,
    position: { x, y },
    size: {
      widthUnits: kind === 'worker' ? 3 : 1,
      heightUnits: kind === 'worker' ? 3 : 1,
    },
    workerMode: kind === 'worker' ? 'ai-ready' : null,
    workerFocus: kind === 'worker' ? DEFAULT_FILE_PAGE_WORKER_FOCUS : null,
    workerRunMode: kind === 'worker' ? DEFAULT_FILE_PAGE_WORKER_RUN_MODE : null,
    workerOutputMode: kind === 'worker' ? DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE : null,
    workerStatus: kind === 'worker' ? 'idle' : null,
    workerProgress: kind === 'worker' ? 0 : null,
    workerOutputFolderId: null,
    workerInputSignature: null,
    workerLastError: null,
  };
}
