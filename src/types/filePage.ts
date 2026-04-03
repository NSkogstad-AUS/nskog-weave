import type { Point } from './workspace';

export const FILE_PAGE_VIEWS = ['canvas', 'explorer'] as const;
export type FilePageView = (typeof FILE_PAGE_VIEWS)[number];

export const FILE_PAGE_NODE_KINDS = ['folder', 'file', 'element'] as const;
export type FilePageNodeKind = (typeof FILE_PAGE_NODE_KINDS)[number];

export interface FilePageNode {
  id: string;
  label: string;
  kind: FilePageNodeKind;
  position: Point;
  size: {
    widthUnits: 1 | 2 | 3;
    heightUnits: 1 | 2 | 3;
  };
}

export interface FilePageState {
  view: FilePageView;
  nodes: FilePageNode[];
}
