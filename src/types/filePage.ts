import type { Point } from './geometry';

export const FILE_PAGE_VIEWS = ['canvas', 'explorer'] as const;
export type FilePageView = (typeof FILE_PAGE_VIEWS)[number];

export const FILE_PAGE_NODE_KINDS = ['folder', 'file', 'element', 'group', 'worker'] as const;
export type FilePageNodeKind = (typeof FILE_PAGE_NODE_KINDS)[number];
export const FILE_PAGE_ELEMENT_ICONS = [
  'sparkles',
  'lightbulb',
  'shapes',
  'message-square',
  'target',
] as const;
export type FilePageElementIcon = (typeof FILE_PAGE_ELEMENT_ICONS)[number];
export const FILE_PAGE_CONTENT_ITEM_KINDS = ['folder', 'file'] as const;
export type FilePageContentItemKind = (typeof FILE_PAGE_CONTENT_ITEM_KINDS)[number];
export const FILE_PAGE_WORKER_MODES = ['ai-ready', 'sort-data'] as const;
export type FilePageWorkerMode = (typeof FILE_PAGE_WORKER_MODES)[number];
export const FILE_PAGE_WORKER_FOCUSES = ['general', 'coding', 'describing', 'research'] as const;
export type FilePageWorkerFocus = (typeof FILE_PAGE_WORKER_FOCUSES)[number];
export const FILE_PAGE_WORKER_RUN_MODES = ['fast', 'balanced', 'thorough'] as const;
export type FilePageWorkerRunMode = (typeof FILE_PAGE_WORKER_RUN_MODES)[number];
export const FILE_PAGE_WORKER_OUTPUT_MODES = ['per-file', 'collated'] as const;
export type FilePageWorkerOutputMode = (typeof FILE_PAGE_WORKER_OUTPUT_MODES)[number];
export const FILE_PAGE_WORKER_STATUSES = ['idle', 'processing', 'complete', 'error'] as const;
export type FilePageWorkerStatus = (typeof FILE_PAGE_WORKER_STATUSES)[number];

export interface FilePageNodeSize {
  widthUnits: number;
  heightUnits: number;
}

export interface FilePageContentItem {
  id: string;
  kind: FilePageContentItemKind;
  label: string;
  description?: string | null;
  textContent?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sourceItemId?: string | null;
  sourceSignature?: string | null;
  outputVersion?: number | null;
  generatedAt?: string | null;
}

export interface FilePageNode {
  id: string;
  label: string;
  description: string;
  groupId?: string | null;
  parentNodeId?: string | null;
  contentItems?: FilePageContentItem[];
  generatedByWorkerId?: string | null;
  kind: FilePageNodeKind;
  icon: FilePageElementIcon;
  position: Point;
  size: FilePageNodeSize;
  workerMode?: FilePageWorkerMode | null;
  workerFocus?: FilePageWorkerFocus | null;
  workerRunMode?: FilePageWorkerRunMode | null;
  workerOutputMode?: FilePageWorkerOutputMode | null;
  workerStatus?: FilePageWorkerStatus | null;
  workerProgress?: number | null;
  workerOutputFolderId?: string | null;
  workerInputSignature?: string | null;
  workerLastError?: string | null;
}

export type FilePageNodeUpdates = Partial<
  Pick<
    FilePageNode,
    | 'label'
    | 'description'
    | 'icon'
    | 'size'
    | 'groupId'
    | 'parentNodeId'
    | 'contentItems'
    | 'generatedByWorkerId'
    | 'workerMode'
    | 'workerFocus'
    | 'workerRunMode'
    | 'workerOutputMode'
    | 'workerStatus'
    | 'workerProgress'
    | 'workerOutputFolderId'
    | 'workerInputSignature'
    | 'workerLastError'
  >
>;

export interface FilePageState {
  view: FilePageView;
  nodes: FilePageNode[];
}
