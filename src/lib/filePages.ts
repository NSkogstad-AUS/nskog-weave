import type { WorkspaceFile } from '@/data/sidebarNavigation';
import type { FilePageNode, FilePageState } from '@/types/filePage';

export const FILE_PAGES_STORAGE_KEY = 'weave:file-pages:v1';

const KIND_RANK: Record<FilePageNode['kind'], number> = {
  folder: 0,
  file: 1,
  element: 2,
};

const ELEMENT_LABELS: Record<WorkspaceFile['kind'], string> = {
  canvas: 'Loose element',
  brief: 'Summary block',
  memo: 'Working note',
  outline: 'Outline point',
};

export function createDefaultFilePage(file: WorkspaceFile): FilePageState {
  const baseLabel = file.label.trim() || 'Untitled file';

  return {
    view: 'canvas',
    nodes: [
      createNode(`${file.id}-folder-context`, 'Context', 'folder', 72, 72),
      createNode(`${file.id}-folder-assets`, 'Assets', 'folder', 332, 104),
      createNode(`${file.id}-file-primary`, baseLabel, 'file', 112, 248),
      createNode(`${file.id}-file-references`, 'References', 'file', 396, 286),
      createNode(`${file.id}-element-core`, ELEMENT_LABELS[file.kind], 'element', 250, 428),
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
    kind,
    position: { x, y },
  };
}
