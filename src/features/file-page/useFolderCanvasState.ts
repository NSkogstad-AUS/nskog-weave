import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  findFileById,
  findFolderById,
  folderHasContents,
  type WorkspaceFile,
  type WorkspaceFolder,
} from '@/data/sidebarNavigation';
import {
  GROUP_CONTENT_INSET_BOTTOM,
  GROUP_CONTENT_INSET_LEFT,
  GROUP_CONTENT_INSET_RIGHT,
  GROUP_CONTENT_INSET_TOP,
  GROUP_MIN_GRID_UNITS,
  SLOT_STEP_X,
  SLOT_STEP_Y,
} from './canvas/constants';
import {
  clampNodePositionToBounds,
  clampToCanvas,
  getGroupContentBounds,
  getNodeDimensionsForKind,
  getUnitsForDimension,
  resolveSnapPositions,
} from './canvas/utils';
import { workspaceFileToContentItem } from '@/lib/workspaceFiles';
import {
  FILE_PAGE_CONTENT_ITEM_KINDS,
  FILE_PAGE_NODE_KINDS,
  FILE_PAGE_WORKER_FOCUSES,
  FILE_PAGE_WORKER_MODES,
  FILE_PAGE_WORKER_OUTPUT_MODES,
  FILE_PAGE_WORKER_STATUSES,
  type FilePageContentItem,
  type FilePageNode,
  type FilePageNodeKind,
  type FilePageNodeSize,
  type FilePageNodeUpdates,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';

type FolderExpandState = 'hidden' | 'expand' | 'collapse';
export type FolderCanvasStore = Record<string, FilePageNode[]>;

const FOLDER_NODE_PREFIX = 'folder:';
const FILE_NODE_PREFIX = 'file:';
export const FOLDER_CANVAS_STORAGE_KEY = 'weave:folder-canvas:v1';
export const FOLDER_CANVAS_UPDATED_EVENT = 'weave:folder-canvas:updated';
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

function normalizeIcon(value: unknown): FilePageNode['icon'] {
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

function normalizeStoredFolderCanvasNodes(raw: string | null): FolderCanvasStore {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<FilePageNode>[]>;

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([folderId, nodes]) => {
        if (!Array.isArray(nodes)) {
          return [];
        }

        const normalizedNodes = nodes.flatMap((node) => {
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
                x: position!.x,
                y: position!.y,
              },
              size: {
                widthUnits: normalizeUnit(node?.size?.widthUnits),
                heightUnits: normalizeUnit(node?.size?.heightUnits),
              },
              workerMode: normalizeWorkerMode(node?.workerMode),
              workerFocus: normalizeWorkerFocus(node?.workerFocus),
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

        return normalizedNodes.length > 0 ? [[folderId, normalizedNodes]] : [];
      }),
    );
  } catch {
    return {};
  }
}

export function readStoredFolderCanvasNodes(): FolderCanvasStore {
  if (typeof window === 'undefined') {
    return {};
  }

  return normalizeStoredFolderCanvasNodes(window.localStorage.getItem(FOLDER_CANVAS_STORAGE_KEY));
}

function hydrateFolderCanvasNodes(): FolderCanvasStore {
  return readStoredFolderCanvasNodes();
}

function writeStoredFolderCanvasNodes(store: FolderCanvasStore) {
  if (typeof window === 'undefined') {
    return;
  }

  const serializedStore = JSON.stringify(store);
  window.localStorage.setItem(FOLDER_CANVAS_STORAGE_KEY, serializedStore);
  window.dispatchEvent(
    new CustomEvent(FOLDER_CANVAS_UPDATED_EVENT, {
      detail: serializedStore,
    }),
  );
}

export function updateStoredFolderCanvasNodes(
  folderId: string,
  recipe: (nodes: FilePageNode[]) => FilePageNode[],
) {
  const currentStore = readStoredFolderCanvasNodes();
  const nextStore = {
    ...currentStore,
    [folderId]: recipe(currentStore[folderId] ?? []),
  };

  writeStoredFolderCanvasNodes(nextStore);
  return nextStore;
}

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

function canNodesShareGroupSpace(leftNode: FilePageNode | undefined, rightNode: FilePageNode | undefined) {
  if (!leftNode || !rightNode || leftNode.id === rightNode.id) {
    return false;
  }

  if (leftNode.kind === 'group' && rightNode.kind !== 'group') {
    return rightNode.groupId === leftNode.id;
  }

  if (rightNode.kind === 'group' && leftNode.kind !== 'group') {
    return leftNode.groupId === rightNode.id;
  }

  return false;
}

function getExpandedGroupSize(
  groupNode: FilePageNode,
  memberNodes: FilePageNode[],
) {
  const basePosition = groupNode.position;
  const currentSize = groupNode.size;

  const requiredDimensions = memberNodes.reduce(
    (dimensions, memberNode) => {
      const memberDimensions = getNodeDimensionsForKind(memberNode.size, memberNode.kind);

      return {
        width: Math.max(
          dimensions.width,
          memberNode.position.x - basePosition.x + memberDimensions.width,
        ),
        height: Math.max(
          dimensions.height,
          memberNode.position.y - basePosition.y + memberDimensions.height,
        ),
      };
    },
    (() => {
      const currentContentBounds = getGroupContentBounds(basePosition, currentSize);

      return {
        width: currentContentBounds.right - currentContentBounds.left,
        height: currentContentBounds.bottom - currentContentBounds.top,
      };
    })(),
  );

  return {
    widthUnits: Math.max(
      currentSize.widthUnits,
      getUnitsForDimension(
        requiredDimensions.width + GROUP_CONTENT_INSET_LEFT + GROUP_CONTENT_INSET_RIGHT,
        SLOT_STEP_X,
        GROUP_MIN_GRID_UNITS,
      ),
    ),
    heightUnits: Math.max(
      currentSize.heightUnits,
      getUnitsForDimension(
        requiredDimensions.height + GROUP_CONTENT_INSET_TOP + GROUP_CONTENT_INSET_BOTTOM,
        SLOT_STEP_Y,
        GROUP_MIN_GRID_UNITS,
      ),
    ),
  };
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

  const [folderCanvasNodes, setFolderCanvasNodes] =
    useState<FolderCanvasStore>(hydrateFolderCanvasNodes);
  const [folderSelectedNodeIds, setFolderSelectedNodeIds] = useState<Record<string, string[]>>({});
  const lastPersistedStoreRef = useRef('');

  useEffect(() => {
    const serializedStore = JSON.stringify(folderCanvasNodes);

    lastPersistedStoreRef.current = serializedStore;
    writeStoredFolderCanvasNodes(folderCanvasNodes);
  }, [folderCanvasNodes]);

  useEffect(() => {
    const syncFromStorage = () => {
      const nextRaw = window.localStorage.getItem(FOLDER_CANVAS_STORAGE_KEY) ?? '';

      if (nextRaw === lastPersistedStoreRef.current) {
        return;
      }

      const nextStore = normalizeStoredFolderCanvasNodes(nextRaw);
      const serializedNextStore = JSON.stringify(nextStore);

      if (serializedNextStore === lastPersistedStoreRef.current) {
        return;
      }

      lastPersistedStoreRef.current = serializedNextStore;
      setFolderCanvasNodes(nextStore);
    };

    window.addEventListener(FOLDER_CANVAS_UPDATED_EVENT, syncFromStorage);
    window.addEventListener('storage', syncFromStorage);

    return () => {
      window.removeEventListener(FOLDER_CANVAS_UPDATED_EVENT, syncFromStorage);
      window.removeEventListener('storage', syncFromStorage);
    };
  }, []);

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

  const getFolderContents = useCallback((node: FilePageNode): FilePageContentItem[] => {
    if (!activeFolder || node.kind !== 'folder') {
      return [];
    }

    const folderId = getWorkspaceFolderId(node.id);

    if (!folderId) {
      return [];
    }

    const sourceFolder = findFolderById([activeFolder], folderId);

    if (!sourceFolder) {
      return [];
    }

    return [
      ...sourceFolder.children.map((folder) => ({
        id: `${FOLDER_NODE_PREFIX}${folder.id}`,
        kind: 'folder' as const,
        label: folder.label,
        description: buildFolderDescription(folder),
      })),
      ...sourceFolder.files.map((file) =>
        workspaceFileToContentItem(file, `${FILE_NODE_PREFIX}${file.id}`),
      ),
    ];
  }, [activeFolder]);

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
      const parentGroupId = parentNode.groupId ?? null;
      const parentGroupNode =
        parentGroupId ? existingById.get(parentGroupId) ?? null : null;
      const nextNodes = [
        ...sourceFolder.children.map((folder) =>
          ({
            ...createFolderNode(folder, { x: 0, y: 0 }, parentNode.id),
            groupId: parentGroupId,
          }) satisfies FilePageNode,
        ),
        ...sourceFolder.files.map((file) =>
          ({
            ...createFileNode(file, { x: 0, y: 0 }, parentNode.id),
            groupId: parentGroupId,
          }) satisfies FilePageNode,
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
      const positionedSeedNodes = nextNodes.map((childNode) => ({
        ...childNode,
        position: desiredPositions[childNode.id],
      }));
      const nextGroupSize =
        parentGroupNode && parentGroupNode.kind === 'group'
          ? getExpandedGroupSize(
              parentGroupNode,
              [
                ...existingNodes.filter((entry) => entry.groupId === parentGroupNode.id),
                ...positionedSeedNodes,
              ],
            )
          : null;
      const groupBounds =
        parentGroupNode && parentGroupNode.kind === 'group'
          ? getGroupContentBounds(parentGroupNode.position, nextGroupSize ?? parentGroupNode.size)
          : null;
      const resolvedPositions = resolveSnapPositions(
        desiredPositions,
        nextNodes.map((childNode) => childNode.id),
        existingNodes.filter((entry) => entry.id !== parentGroupId),
        desiredPositions,
        Object.fromEntries(nextNodes.map((childNode) => [childNode.id, childNode.size])),
        (leftNodeId, rightNodeId) => {
          const leftNode =
            nextNodes.find((childNode) => childNode.id === leftNodeId) ?? existingById.get(leftNodeId);
          const rightNode =
            nextNodes.find((childNode) => childNode.id === rightNodeId) ?? existingById.get(rightNodeId);

          return canNodesShareGroupSpace(leftNode, rightNode);
        },
        {
          anchorGridOrigin: groupBounds
            ? { x: groupBounds.left, y: groupBounds.top }
            : parentNode.position,
          constrainPosition: (position, nodeId) => {
            const candidateNode = nextNodes.find((childNode) => childNode.id === nodeId);

            if (candidateNode && groupBounds) {
              return clampNodePositionToBounds(position, candidateNode.size, groupBounds);
            }

            return {
              x: clampToCanvas(position.x),
              y: clampToCanvas(position.y),
            };
          },
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
        [activeFolder.id]: [
          ...existingNodes.map((entry) =>
            nextGroupSize && entry.id === parentGroupId
              ? {
                  ...entry,
                  size: nextGroupSize,
                }
              : entry,
          ),
          ...positionedNodes,
        ],
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
    getFolderContents,
    expandFolderNode,
    collapseFolderNode,
  };
}
