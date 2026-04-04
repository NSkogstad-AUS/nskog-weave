import { useEffect, useMemo, useState } from 'react';

import type { WorkspaceFolder } from '@/data/sidebarNavigation';
import type { FilePageElementIcon, FilePageNode } from '@/types/filePage';

type NodeSize = {
  widthUnits: 1 | 2 | 3;
  heightUnits: 1 | 2 | 3;
};

type NodeUpdates = Partial<{
  label: string;
  description: string;
  icon: FilePageElementIcon;
  size: NodeSize;
}>;

export function useFolderCanvasState(activeFolder: WorkspaceFolder | null) {
  const baseNodes = useMemo<FilePageNode[]>(() => {
    if (!activeFolder) {
      return [];
    }

    const childFolderNodes = activeFolder.children.map((folder, index) => ({
      id: `folder:${folder.id}`,
      label: folder.label,
      description: `${folder.children.length} folders · ${folder.files.length} files`,
      kind: 'folder' as const,
      icon: 'shapes' as const,
      position: {
        x: 72 + (index % 3) * 224,
        y: 104 + Math.floor(index / 3) * 112,
      },
      size: {
        widthUnits: 1 as const,
        heightUnits: 1 as const,
      },
    }));
    const fileNodes = activeFolder.files.map((file, index) => ({
      id: `file:${file.id}`,
      label: file.label,
      description: file.description,
      kind: 'file' as const,
      icon: 'message-square' as const,
      position: {
        x: 72 + ((childFolderNodes.length + index) % 3) * 224,
        y: 104 + Math.floor((childFolderNodes.length + index) / 3) * 112,
      },
      size: {
        widthUnits: 2 as const,
        heightUnits: 1 as const,
      },
    }));

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
      const mergedNodes = baseNodes.map((node) => {
        const existingNode = existingById.get(node.id);

        return existingNode
          ? {
              ...node,
              position: existingNode.position,
              size: existingNode.size,
              icon: existingNode.icon,
            }
          : node;
      });

      return {
        ...current,
        [activeFolder.id]: mergedNodes,
      };
    });
  }, [activeFolder, baseNodes]);

  const activeNodes = activeFolder ? folderCanvasNodes[activeFolder.id] ?? baseNodes : [];
  const activeSelectedNodeIds = activeFolder ? folderSelectedNodeIds[activeFolder.id] ?? [] : [];

  function moveNodes(positions: Record<string, { x: number; y: number }>) {
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
  }

  function resizeNode(nodeId: string, size: NodeSize) {
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
  }

  function addNode(node: FilePageNode) {
    if (!activeFolder) {
      return;
    }

    setFolderCanvasNodes((current) => ({
      ...current,
      [activeFolder.id]: [...(current[activeFolder.id] ?? baseNodes), node],
    }));
  }

  function updateNode(nodeId: string, updates: NodeUpdates) {
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
  }

  function deleteNode(nodeId: string) {
    if (!activeFolder) {
      return;
    }

    setFolderCanvasNodes((current) => ({
      ...current,
      [activeFolder.id]: (current[activeFolder.id] ?? baseNodes).filter((node) => node.id !== nodeId),
    }));
    setFolderSelectedNodeIds((current) => ({
      ...current,
      [activeFolder.id]: (current[activeFolder.id] ?? []).filter((id) => id !== nodeId),
    }));
  }

  function selectNodes(nodeIds: string[]) {
    if (!activeFolder) {
      return;
    }

    setFolderSelectedNodeIds((current) => ({
      ...current,
      [activeFolder.id]: nodeIds,
    }));
  }

  return {
    activeNodes,
    activeSelectedNodeIds,
    moveNodes,
    resizeNode,
    addNode,
    updateNode,
    deleteNode,
    selectNodes,
  };
}
