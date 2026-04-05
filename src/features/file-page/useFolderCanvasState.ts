import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  findFileById,
  findFolderById,
  folderHasContents,
  type WorkspaceFile,
  type WorkspaceFolder,
} from '@/data/sidebarNavigation';
import { SLOT_STEP_X, SLOT_STEP_Y } from './canvas/constants';
import { clampToCanvas, resolveSnapPositions } from './canvas/utils';
import type { FilePageNode, FilePageNodeSize, FilePageNodeUpdates } from '@/types/filePage';
import type { Point } from '@/types/geometry';

type FolderExpandState = 'hidden' | 'expand' | 'collapse';

const FOLDER_NODE_PREFIX = 'folder:';
const FILE_NODE_PREFIX = 'file:';

function buildDefaultPosition(index: number) {
  return {
    x: 72 + (index % 3) * 224,
    y: 104 + Math.floor(index / 3) * 112,
  };
}

function buildFolderDescription(folder: WorkspaceFolder) {
  return `${folder.children.length} folders · ${folder.files.length} files`;
}

function createFolderNode(
  folder: WorkspaceFolder,
  position: Point,
  parentNodeId: string | null = null,
): FilePageNode {
  return {
    id: `${FOLDER_NODE_PREFIX}${folder.id}`,
    label: folder.label,
    description: buildFolderDescription(folder),
    parentNodeId,
    kind: 'folder',
    icon: 'shapes',
    position,
    size: {
      widthUnits: 1,
      heightUnits: 1,
    },
  };
}

function createFileNode(
  file: WorkspaceFile,
  position: Point,
  parentNodeId: string | null = null,
): FilePageNode {
  return {
    id: `${FILE_NODE_PREFIX}${file.id}`,
    label: file.label,
    description: file.description,
    parentNodeId,
    kind: 'file',
    icon: 'message-square',
    position,
    size: {
      widthUnits: 2,
      heightUnits: 1,
    },
  };
}

function getWorkspaceFolderId(nodeId: string) {
  return nodeId.startsWith(FOLDER_NODE_PREFIX)
    ? nodeId.slice(FOLDER_NODE_PREFIX.length)
    : null;
}

function getWorkspaceNodeSource(
  activeFolder: WorkspaceFolder,
  nodeId: string,
):
  | {
      kind: 'folder';
      label: string;
      description: string;
    }
  | {
      kind: 'file';
      label: string;
      description: string;
    }
  | null {
  if (nodeId.startsWith(FOLDER_NODE_PREFIX)) {
    const folder = findFolderById([activeFolder], nodeId.slice(FOLDER_NODE_PREFIX.length));

    return folder
      ? {
          kind: 'folder',
          label: folder.label,
          description: buildFolderDescription(folder),
        }
      : null;
  }

  if (nodeId.startsWith(FILE_NODE_PREFIX)) {
    const fileMatch = findFileById([activeFolder], nodeId.slice(FILE_NODE_PREFIX.length));

    return fileMatch
      ? {
          kind: 'file',
          label: fileMatch.file.label,
          description: fileMatch.file.description,
        }
      : null;
  }

  return null;
}

function collectDescendantNodeIds(nodes: FilePageNode[], rootNodeId: string) {
  const descendantIds = new Set<string>();
  const queue = [rootNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift();

    if (!nodeId) {
      continue;
    }

    nodes
      .filter((node) => node.parentNodeId === nodeId)
      .forEach((node) => {
        if (descendantIds.has(node.id)) {
          return;
        }

        descendantIds.add(node.id);
        queue.push(node.id);
      });
  }

  return descendantIds;
}

export function useFolderCanvasState(activeFolder: WorkspaceFolder | null) {
  const baseNodes = useMemo<FilePageNode[]>(() => {
    if (!activeFolder) {
      return [];
    }

    const childFolderNodes = activeFolder.children.map((folder, index) =>
      createFolderNode(folder, buildDefaultPosition(index)),
    );
    const fileNodes = activeFolder.files.map((file, index) =>
      createFileNode(file, buildDefaultPosition(childFolderNodes.length + index)),
    );

    return [...childFolderNodes, ...fileNodes];
  }, [activeFolder]);

  const [folderCanvasNodes, setFolderCanvasNodes] = useState<Record<string, FilePageNode[]>>({});
  const [folderSelectedNodeIds, setFolderSelectedNodeIds] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!activeFolder) {
      return;
    }

    setFolderCanvasNodes((current) => {
      const existingNodes = current[activeFolder.id];

      if (!existingNodes) {
        return {
          ...current,
          [activeFolder.id]: baseNodes,
        };
      }

      const existingById = new Map(existingNodes.map((node) => [node.id, node]));
      const baseNodeIds = new Set(baseNodes.map((node) => node.id));
      const mergedBaseNodes = baseNodes.map((node) => {
        const existingNode = existingById.get(node.id);

        return existingNode
          ? {
              ...node,
              groupId: existingNode.groupId ?? null,
              parentNodeId: null,
              position: existingNode.position,
              size: existingNode.size,
              icon: existingNode.icon,
            }
          : node;
      });
      const extraNodes = existingNodes.flatMap((node) => {
        if (baseNodeIds.has(node.id)) {
          return [];
        }

        const sourceNode = getWorkspaceNodeSource(activeFolder, node.id);

        if (sourceNode) {
          return [
            {
              ...node,
              label: sourceNode.label,
              description: sourceNode.description,
              kind: sourceNode.kind,
            },
          ];
        }

        if (
          node.kind === 'folder' ||
          node.kind === 'file' ||
          node.id.startsWith(FOLDER_NODE_PREFIX) ||
          node.id.startsWith(FILE_NODE_PREFIX)
        ) {
          return [];
        }

        return [node];
      });

      return {
        ...current,
        [activeFolder.id]: [...mergedBaseNodes, ...extraNodes],
      };
    });
  }, [activeFolder, baseNodes]);

  const activeNodes = activeFolder ? folderCanvasNodes[activeFolder.id] ?? baseNodes : [];
  const activeSelectedNodeIds = activeFolder ? folderSelectedNodeIds[activeFolder.id] ?? [] : [];

  const moveNodes = useCallback((positions: Record<string, Point>) => {
    if (!activeFolder) {
      return;
    }

    setFolderCanvasNodes((current) => ({
      ...current,
      [activeFolder.id]: (current[activeFolder.id] ?? baseNodes).map((node) =>
        positions[node.id]
          ? {
              ...node,
              position: positions[node.id],
            }
          : node,
      ),
    }));
  }, [activeFolder, baseNodes]);

  const resizeNode = useCallback((nodeId: string, size: FilePageNodeSize) => {
    if (!activeFolder) {
      return;
    }

    setFolderCanvasNodes((current) => ({
      ...current,
      [activeFolder.id]: (current[activeFolder.id] ?? baseNodes).map((node) =>
        node.id === nodeId
          ? {
              ...node,
              size,
            }
          : node,
      ),
    }));
  }, [activeFolder, baseNodes]);

  const addNode = useCallback((node: FilePageNode) => {
    if (!activeFolder) {
      return;
    }

    setFolderCanvasNodes((current) => ({
      ...current,
      [activeFolder.id]: [
        ...(current[activeFolder.id] ?? baseNodes),
        {
          ...node,
          parentNodeId: node.parentNodeId ?? null,
        },
      ],
    }));
  }, [activeFolder, baseNodes]);

  const updateNode = useCallback((nodeId: string, updates: FilePageNodeUpdates) => {
    if (!activeFolder) {
      return;
    }

    setFolderCanvasNodes((current) => ({
      ...current,
      [activeFolder.id]: (current[activeFolder.id] ?? baseNodes).map((node) =>
        node.id === nodeId
          ? {
              ...node,
              ...updates,
            }
          : node,
      ),
    }));
  }, [activeFolder, baseNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    if (!activeFolder) {
      return;
    }

    const existingNodes = activeNodes;
    const descendantIds = collectDescendantNodeIds(existingNodes, nodeId);
    const idsToDelete = new Set([nodeId, ...descendantIds]);

    setFolderCanvasNodes((current) => {
      return {
        ...current,
        [activeFolder.id]: (current[activeFolder.id] ?? baseNodes).filter(
          (node) => !idsToDelete.has(node.id),
        ),
      };
    });
    setFolderSelectedNodeIds((current) => {
      return {
        ...current,
        [activeFolder.id]: (current[activeFolder.id] ?? []).filter((id) => !idsToDelete.has(id)),
      };
    });
  }, [activeFolder, activeNodes, baseNodes]);

  const selectNodes = useCallback((nodeIds: string[]) => {
    if (!activeFolder) {
      return;
    }

    setFolderSelectedNodeIds((current) => ({
      ...current,
      [activeFolder.id]: nodeIds,
    }));
  }, [activeFolder]);

  const getFolderExpandState = useCallback((node: FilePageNode): FolderExpandState => {
    if (!activeFolder || node.kind !== 'folder') {
      return 'hidden';
    }

    const folderId = getWorkspaceFolderId(node.id);

    if (!folderId) {
      return 'hidden';
    }

    const sourceFolder = findFolderById([activeFolder], folderId);

    if (!sourceFolder || !folderHasContents(sourceFolder)) {
      return 'hidden';
    }

    const hasExpandedChild = activeNodes.some((activeNode) => activeNode.parentNodeId === node.id);

    if (hasExpandedChild) {
      return 'collapse';
    }

    const missingChildExists = [
      ...sourceFolder.children.map((folder) => `${FOLDER_NODE_PREFIX}${folder.id}`),
      ...sourceFolder.files.map((file) => `${FILE_NODE_PREFIX}${file.id}`),
    ].some(
      (childNodeId) =>
        !activeNodes.some(
          (activeNode) => activeNode.id === childNodeId && activeNode.parentNodeId === node.id,
        ),
    );

    return missingChildExists ? 'expand' : 'hidden';
  }, [activeFolder, activeNodes]);

  const expandFolderNode = useCallback((node: FilePageNode) => {
    if (!activeFolder || node.kind !== 'folder') {
      return;
    }

    const folderId = getWorkspaceFolderId(node.id);

    if (!folderId) {
      return;
    }

    const sourceFolder = findFolderById([activeFolder], folderId);

    if (!sourceFolder || !folderHasContents(sourceFolder)) {
      return;
    }

    setFolderCanvasNodes((current) => {
      const existingNodes = current[activeFolder.id] ?? baseNodes;
      const existingById = new Map(existingNodes.map((entry) => [entry.id, entry]));
      const parentNode = existingById.get(node.id) ?? node;
      const nextNodes = [
        ...sourceFolder.children.map((folder) =>
          createFolderNode(folder, { x: 0, y: 0 }, parentNode.id),
        ),
        ...sourceFolder.files.map((file) =>
          createFileNode(file, { x: 0, y: 0 }, parentNode.id),
        ),
      ].filter((childNode) => !existingById.has(childNode.id));

      if (nextNodes.length === 0) {
        return current;
      }

      const desiredPositions = nextNodes.reduce<Record<string, Point>>((positions, childNode, index) => {
        positions[childNode.id] = {
          x: parentNode.position.x + SLOT_STEP_X * (1 + (index % 2)),
          y: parentNode.position.y + SLOT_STEP_Y * Math.floor(index / 2),
        };
        return positions;
      }, {});
      const resolvedPositions = resolveSnapPositions(
        desiredPositions,
        nextNodes.map((childNode) => childNode.id),
        existingNodes,
        desiredPositions,
        Object.fromEntries(nextNodes.map((childNode) => [childNode.id, childNode.size])),
        undefined,
        {
          anchorGridOrigin: parentNode.position,
          constrainPosition: (position) => ({
            x: clampToCanvas(position.x),
            y: clampToCanvas(position.y),
          }),
          getNodeKind: (nodeId) =>
            nextNodes.find((childNode) => childNode.id === nodeId)?.kind ??
            existingById.get(nodeId)?.kind,
        },
      );
      const positionedNodes = nextNodes.map((childNode) => ({
        ...childNode,
        position: resolvedPositions[childNode.id] ?? desiredPositions[childNode.id],
      }));

      return {
        ...current,
        [activeFolder.id]: [...existingNodes, ...positionedNodes],
      };
    });
  }, [activeFolder, baseNodes]);

  const collapseFolderNode = useCallback((node: FilePageNode) => {
    if (!activeFolder || node.kind !== 'folder') {
      return;
    }

    const descendantIds = collectDescendantNodeIds(activeNodes, node.id);

    if (descendantIds.size === 0) {
      return;
    }

    setFolderCanvasNodes((current) => ({
      ...current,
      [activeFolder.id]: (current[activeFolder.id] ?? baseNodes).filter(
        (candidate) => !descendantIds.has(candidate.id),
      ),
    }));
    setFolderSelectedNodeIds((current) => ({
      ...current,
      [activeFolder.id]: (current[activeFolder.id] ?? []).filter((id) => !descendantIds.has(id)),
    }));
  }, [activeFolder, activeNodes, baseNodes]);

  return {
    activeNodes,
    activeSelectedNodeIds,
    moveNodes,
    resizeNode,
    addNode,
    updateNode,
    deleteNode,
    selectNodes,
    getFolderExpandState,
    expandFolderNode,
    collapseFolderNode,
  };
}
