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
export const FILE_PAGE_WORKER_MODES = ['ai-ready'] as const;
export type FilePageWorkerMode = (typeof FILE_PAGE_WORKER_MODES)[number];
export const FILE_PAGE_WORKER_STATUSES = ['idle', 'processing', 'complete'] as const;
export type FilePageWorkerStatus = (typeof FILE_PAGE_WORKER_STATUSES)[number];

export interface FilePageNodeSize {
  widthUnits: number;
  heightUnits: number;
}

export interface FilePageContentItem {
  id: string;
  kind: FilePageContentItemKind;
  label: string;
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
  workerStatus?: FilePageWorkerStatus | null;
  workerProgress?: number | null;
  workerOutputFolderId?: string | null;
  workerInputSignature?: string | null;
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
    | 'workerStatus'
    | 'workerProgress'
    | 'workerOutputFolderId'
    | 'workerInputSignature'
  >
>;

export interface FilePageState {
  view: FilePageView;
  nodes: FilePageNode[];
}
