import type { Point } from './geometry';

export const FILE_PAGE_VIEWS = ['canvas', 'explorer'] as const;
export type FilePageView = (typeof FILE_PAGE_VIEWS)[number];

export const FILE_PAGE_NODE_KINDS = ['folder', 'file', 'element', 'group'] as const;
export type FilePageNodeKind = (typeof FILE_PAGE_NODE_KINDS)[number];
export const FILE_PAGE_ELEMENT_ICONS = [
  'sparkles',
  'lightbulb',
  'shapes',
  'message-square',
  'target',
] as const;
export type FilePageElementIcon = (typeof FILE_PAGE_ELEMENT_ICONS)[number];

export interface FilePageNodeSize {
  widthUnits: number;
  heightUnits: number;
}

export interface FilePageNode {
  id: string;
  label: string;
  description: string;
  groupId?: string | null;
  kind: FilePageNodeKind;
  icon: FilePageElementIcon;
  position: Point;
  size: FilePageNodeSize;
}

export interface FilePageState {
  view: FilePageView;
  nodes: FilePageNode[];
}
