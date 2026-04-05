import { useEffect, useMemo, useState } from 'react';

import type { WorkspaceFile } from '@/data/sidebarNavigation';
import {
  createDefaultFilePage,
  FILE_PAGES_STORAGE_KEY,
} from '@/lib/filePages';
import {
  FILE_PAGE_NODE_KINDS,
  type FilePageElementIcon,
  type FilePageNode,
  type FilePageNodeKind,
  type FilePageNodeSize,
  type FilePageState,
  type FilePageView,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';

type FilePagesStore = Record<string, FilePageState>;

const MAX_STORED_GRID_UNITS = 12;

function normalizeUnit(value: unknown, minimum = 1) {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.max(minimum, Math.min(MAX_STORED_GRID_UNITS, Math.round(Number(value))));
}

function normalizeNodeKind(value: unknown): FilePageNodeKind | null {
  return FILE_PAGE_NODE_KINDS.includes(value as FilePageNodeKind)
    ? (value as FilePageNodeKind)
    : null;
}

function normalizeIcon(value: unknown): FilePageElementIcon {
  return value === 'lightbulb' ||
    value === 'shapes' ||
    value === 'message-square' ||
    value === 'target'
    ? value
    : 'sparkles';
}

function hydrateFilePages(): FilePagesStore {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(FILE_PAGES_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, Partial<FilePageState>>;

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([fileId, page]) => {
        if (!page || !Array.isArray(page.nodes)) {
          return [];
        }

        const nodes = page.nodes.flatMap((node) => {
          const kind = normalizeNodeKind(node?.kind);
          const groupId =
            typeof node?.groupId === 'string' && node.groupId.trim().length > 0
              ? node.groupId
              : null;

          if (
            typeof node?.id !== 'string' ||
            typeof node?.label !== 'string' ||
            !kind ||
            !Number.isFinite(node?.position?.x) ||
            !Number.isFinite(node?.position?.y)
          ) {
            return [];
          }

          return [
            {
              id: node.id,
              label: node.label,
              description: typeof node.description === 'string' ? node.description : '',
              groupId,
              kind,
              icon: normalizeIcon(node.icon),
              position: {
                x: node.position.x,
                y: node.position.y,
              },
              size: {
                widthUnits: normalizeUnit(node?.size?.widthUnits),
                heightUnits: normalizeUnit(node?.size?.heightUnits),
              },
            },
          ];
        });

        return [
          [
            fileId,
            {
              view: page.view === 'explorer' ? 'explorer' : 'canvas',
              nodes,
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

export function useFilePages(activeFile: WorkspaceFile | null) {
  const [pages, setPages] = useState<FilePagesStore>(hydrateFilePages);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);

  useEffect(() => {
    window.localStorage.setItem(FILE_PAGES_STORAGE_KEY, JSON.stringify(pages));
  }, [pages]);

  useEffect(() => {
    if (!activeFile) {
      setSelectedNodeIds([]);
      return;
    }

    setPages((current) =>
      current[activeFile.id]
        ? current
        : {
            ...current,
            [activeFile.id]: createDefaultFilePage(activeFile),
          },
    );
    setSelectedNodeIds([]);
  }, [activeFile?.id]);

  const activePage = useMemo(() => {
    if (!activeFile) {
      return null;
    }

    return pages[activeFile.id] ?? createDefaultFilePage(activeFile);
  }, [activeFile, pages]);

  function updateActivePage(recipe: (page: FilePageState) => FilePageState) {
    if (!activeFile) {
      return;
    }

    setPages((current) => {
      const currentPage = current[activeFile.id] ?? createDefaultFilePage(activeFile);

      return {
        ...current,
        [activeFile.id]: recipe(currentPage),
      };
    });
  }

  function setView(view: FilePageView) {
    updateActivePage((page) => ({
      ...page,
      view,
    }));
  }

  function moveNodes(positions: Record<string, Point>) {
    updateActivePage((page) => ({
      ...page,
      nodes: page.nodes.map((node) =>
        positions[node.id]
          ? {
              ...node,
              position: positions[node.id],
            }
          : node,
      ),
    }));
  }

  function resizeNode(
    nodeId: string,
    size: FilePageNodeSize,
  ) {
    updateActivePage((page) => ({
      ...page,
      nodes: page.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              size,
            }
          : node,
      ),
    }));
  }

  function addNode(
    node: FilePageState['nodes'][number],
  ) {
    updateActivePage((page) => ({
      ...page,
      nodes: [...page.nodes, node],
    }));
  }

  function updateNode(
    nodeId: string,
    updates: Partial<Pick<FilePageNode, 'label' | 'description' | 'icon' | 'size' | 'groupId'>>,
  ) {
    updateActivePage((page) => ({
      ...page,
      nodes: page.nodes.map((node) =>
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
    updateActivePage((page) => ({
      ...page,
      nodes: page.nodes.filter((node) => node.id !== nodeId),
    }));
    setSelectedNodeIds((current) => current.filter((id) => id !== nodeId));
  }

  function removeFilePage(fileId: string) {
    setPages((current) => {
      if (!current[fileId]) {
        return current;
      }

      const next = { ...current };

      delete next[fileId];
      return next;
    });
  }

  return {
    activePage,
    selectedNodeIds,
    setSelectedNodeIds,
    setView,
    moveNodes,
    resizeNode,
    addNode,
    updateNode,
    deleteNode,
    removeFilePage,
  };
}
