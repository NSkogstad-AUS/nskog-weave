import { useEffect, useMemo, useRef, useState } from 'react';

import type { WorkspaceFile } from '@/data/sidebarNavigation';
import {
  createDefaultFilePage,
  FILE_PAGES_STORAGE_KEY,
} from '@/lib/filePages';
import {
  GROUP_MAX_GRID_UNITS,
  MAX_NODE_GRID_UNITS,
} from '@/features/file-page/canvas/constants';
import {
  FILE_PAGE_CONTENT_ITEM_KINDS,
  FILE_PAGE_NODE_KINDS,
  FILE_PAGE_WORKER_FOCUSES,
  FILE_PAGE_WORKER_MODES,
  FILE_PAGE_WORKER_OUTPUT_MODES,
  FILE_PAGE_WORKER_RUN_MODES,
  FILE_PAGE_WORKER_STATUSES,
  type FilePageElementIcon,
  type FilePageContentItem,
  type FilePageNode,
  type FilePageNodeKind,
  type FilePageNodeSize,
  type FilePageNodeUpdates,
  type FilePageState,
  type FilePageView,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';

type FilePagesStore = Record<string, FilePageState>;

function normalizeUnit(value: unknown, minimum = 1, maximum = MAX_NODE_GRID_UNITS) {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.max(minimum, Math.min(maximum, Math.round(Number(value))));
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

function normalizeWorkerMode(value: unknown): FilePageNode['workerMode'] {
  return FILE_PAGE_WORKER_MODES.includes(value as NonNullable<FilePageNode['workerMode']>)
    ? (value as NonNullable<FilePageNode['workerMode']>)
    : null;
}

function normalizeWorkerFocus(value: unknown): FilePageNode['workerFocus'] {
  return FILE_PAGE_WORKER_FOCUSES.includes(value as NonNullable<FilePageNode['workerFocus']>)
    ? (value as NonNullable<FilePageNode['workerFocus']>)
    : null;
}

function normalizeWorkerOutputMode(value: unknown): FilePageNode['workerOutputMode'] {
  return FILE_PAGE_WORKER_OUTPUT_MODES.includes(value as NonNullable<FilePageNode['workerOutputMode']>)
    ? (value as NonNullable<FilePageNode['workerOutputMode']>)
    : null;
}

function normalizeWorkerRunMode(value: unknown): FilePageNode['workerRunMode'] {
  return FILE_PAGE_WORKER_RUN_MODES.includes(value as NonNullable<FilePageNode['workerRunMode']>)
    ? (value as NonNullable<FilePageNode['workerRunMode']>)
    : null;
}

function normalizeWorkerStatus(value: unknown): FilePageNode['workerStatus'] {
  return FILE_PAGE_WORKER_STATUSES.includes(value as NonNullable<FilePageNode['workerStatus']>)
    ? (value as NonNullable<FilePageNode['workerStatus']>)
    : null;
}

function normalizeContentItems(value: unknown): FilePageContentItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      typeof item?.id !== 'string' ||
      typeof item?.label !== 'string' ||
      !FILE_PAGE_CONTENT_ITEM_KINDS.includes(item?.kind as FilePageContentItem['kind'])
    ) {
      return [];
    }

    return [
      {
        id: item.id,
        label: item.label,
        kind: item.kind,
        description:
          typeof item?.description === 'string' && item.description.trim().length > 0
            ? item.description
            : null,
        textContent:
          typeof item?.textContent === 'string' && item.textContent.length > 0
            ? item.textContent
            : null,
        mimeType:
          typeof item?.mimeType === 'string' && item.mimeType.trim().length > 0
            ? item.mimeType
            : null,
        sizeBytes: Number.isFinite(item?.sizeBytes) ? Math.max(0, Number(item.sizeBytes)) : null,
        sourceItemId:
          typeof item?.sourceItemId === 'string' && item.sourceItemId.trim().length > 0
            ? item.sourceItemId
            : null,
        sourceSignature:
          typeof item?.sourceSignature === 'string' && item.sourceSignature.trim().length > 0
            ? item.sourceSignature
            : null,
        outputVersion: Number.isFinite(item?.outputVersion)
          ? Math.max(1, Math.round(Number(item.outputVersion)))
          : null,
        generatedAt:
          typeof item?.generatedAt === 'string' && item.generatedAt.trim().length > 0
            ? item.generatedAt
            : null,
      },
    ];
  });
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
          const position = node?.position;
          const groupId =
            typeof node?.groupId === 'string' && node.groupId.trim().length > 0
              ? node.groupId
              : null;
          const parentNodeId =
            typeof node?.parentNodeId === 'string' && node.parentNodeId.trim().length > 0
              ? node.parentNodeId
              : null;
          const generatedByWorkerId =
            typeof node?.generatedByWorkerId === 'string' &&
            node.generatedByWorkerId.trim().length > 0
              ? node.generatedByWorkerId
              : null;

          if (
            typeof node?.id !== 'string' ||
            typeof node?.label !== 'string' ||
            !kind ||
            !Number.isFinite(position?.x) ||
            !Number.isFinite(position?.y)
          ) {
            return [];
          }

          return [
            {
              id: node.id,
              label: node.label,
              description: typeof node.description === 'string' ? node.description : '',
              groupId,
              parentNodeId,
              contentItems: normalizeContentItems(node?.contentItems),
              generatedByWorkerId,
              kind,
              icon: normalizeIcon(node.icon),
              position: {
                x: position.x,
                y: position.y,
              },
              size: {
                widthUnits: normalizeUnit(
                  node?.size?.widthUnits,
                  1,
                  kind === 'group' ? GROUP_MAX_GRID_UNITS : MAX_NODE_GRID_UNITS,
                ),
                heightUnits: normalizeUnit(
                  node?.size?.heightUnits,
                  1,
                  kind === 'group' ? GROUP_MAX_GRID_UNITS : MAX_NODE_GRID_UNITS,
                ),
              },
              workerMode: normalizeWorkerMode(node?.workerMode),
              workerFocus: normalizeWorkerFocus(node?.workerFocus),
              workerRunMode: normalizeWorkerRunMode(node?.workerRunMode),
              workerOutputMode: normalizeWorkerOutputMode(node?.workerOutputMode),
              workerStatus: normalizeWorkerStatus(node?.workerStatus),
              workerProgress: Number.isFinite(node?.workerProgress)
                ? Math.max(0, Math.min(100, Math.round(Number(node.workerProgress))))
                : null,
              workerOutputFolderId:
                typeof node?.workerOutputFolderId === 'string' &&
                node.workerOutputFolderId.trim().length > 0
                  ? node.workerOutputFolderId
                  : null,
              workerInputSignature:
                typeof node?.workerInputSignature === 'string' &&
                node.workerInputSignature.trim().length > 0
                  ? node.workerInputSignature
                  : null,
              workerLastError:
                typeof node?.workerLastError === 'string' &&
                node.workerLastError.trim().length > 0
                  ? node.workerLastError
                  : null,
            },
          ];
        });

        return [
          [
            fileId,
            {
              view:
                page.view === 'explorer'
                  ? 'explorer'
                  : page.view === 'document'
                    ? 'document'
                    : 'canvas',
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
  const persistTimeoutRef = useRef<number | null>(null);
  const latestPagesRef = useRef(pages);
  const lastPersistedPagesRef = useRef('');

  useEffect(() => {
    latestPagesRef.current = pages;

    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current);
    }

    persistTimeoutRef.current = window.setTimeout(() => {
      const serializedPages = JSON.stringify(latestPagesRef.current);

      if (serializedPages !== lastPersistedPagesRef.current) {
        window.localStorage.setItem(FILE_PAGES_STORAGE_KEY, serializedPages);
        lastPersistedPagesRef.current = serializedPages;
      }

      persistTimeoutRef.current = null;
    }, 180);

    return () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }
    };
  }, [pages]);

  useEffect(() => () => {
    if (persistTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(persistTimeoutRef.current);

    const serializedPages = JSON.stringify(latestPagesRef.current);

    if (serializedPages !== lastPersistedPagesRef.current) {
      window.localStorage.setItem(FILE_PAGES_STORAGE_KEY, serializedPages);
      lastPersistedPagesRef.current = serializedPages;
    }
  }, []);

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

  function updatePageByFileId(
    fileId: string,
    recipe: (page: FilePageState) => FilePageState,
  ) {
    setPages((current) => {
      const seedFile =
        activeFile && activeFile.id === fileId
          ? activeFile
          : null;
      const currentPage =
        current[fileId] ??
        (seedFile ? createDefaultFilePage(seedFile) : null);

      if (!currentPage) {
        return current;
      }

      return {
        ...current,
        [fileId]: recipe(currentPage),
      };
    });
  }

  function setView(view: FilePageView) {
    updateActivePage((page) => ({
      ...page,
      view,
    }));
  }

  function setViewForFile(file: WorkspaceFile, view: FilePageView) {
    setPages((current) => {
      const currentPage = current[file.id] ?? createDefaultFilePage(file);

      return {
        ...current,
        [file.id]: {
          ...currentPage,
          view,
        },
      };
    });
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
          ? node.kind === 'worker'
            ? {
                ...node,
                size: {
                  widthUnits: 3,
                  heightUnits: 3,
                },
              }
            : {
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
    updates: FilePageNodeUpdates,
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
    pages,
    selectedNodeIds,
    setSelectedNodeIds,
    setView,
    setViewForFile,
    moveNodes,
    resizeNode,
    addNode,
    updateNode,
    updatePageByFileId,
    deleteNode,
    removeFilePage,
  };
}
