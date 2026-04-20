import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { ArrowUpDownIcon, BotIcon, PlusIcon, ShapesIcon } from 'lucide-react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DEFAULT_FILE_PAGE_WORKER_FOCUS,
  DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
  DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
  getWorkerClientTimeoutMs,
  getWorkerModeMeta,
  getWorkerOutputItemLabel,
  resolveWorkerMode,
  resolveWorkerOutputMode,
  resolveWorkerRunMode,
} from '@/lib/filePageWorkers';
import { buildContentSnippet } from '@/lib/workspaceFiles';
import { cn } from '@/lib/utils';
import {
  CANVAS_PADDING,
  CANVAS_WORLD_LIMIT,
  GRID_SIZE,
  GROUP_CONTENT_INSET_LEFT,
  GROUP_CONTENT_INSET_TOP,
  GROUP_MIN_GRID_UNITS,
  NODE_CARD_CLASS,
  SLOT_GAP_X,
  SLOT_GAP_Y,
  SLOT_STEP_X,
  SLOT_STEP_Y,
} from './canvas/constants';
import {
  type CanvasPaletteSidebarItem,
  type CanvasPaletteTemplateId,
} from './canvas/CanvasPaletteSidebar';
import {
  FileCanvasFloatingInspector,
  type CanvasFloatingInspectorRect,
  type CanvasFloatingInspectorTarget,
} from './canvas/FileCanvasFloatingInspector';
import { FileCanvasFloatingToolbar } from './canvas/FileCanvasFloatingToolbar';
import { FileCanvasNode } from './canvas/FileCanvasNode';
import type { GroupResizeAxis } from './canvas/groupChrome';
import { ELEMENT_ICON_META, NODE_META } from './canvas/meta';
import {
  boundsOverlap,
  clampNodePositionToBounds,
  clampToCanvas,
  getGroupContentBounds,
  getNodeBoundsWithSize,
  getNodeDimensionsForKind,
  getUnitsForDimension,
  normalizeRectangle,
  rectanglesIntersect,
  resolveSnapPositions,
  snapToSlotX,
  snapToSlotY,
} from './canvas/utils';
import type {
  FilePageContentItem,
  FilePageElementIcon,
  FilePageNode,
  FilePageNodeSize,
  FilePageNodeUpdates,
  FilePageWorkerFocus,
  FilePageWorkerMode,
  FilePageWorkerOutputMode,
  FilePageWorkerRunMode,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';

interface FileCanvasViewProps {
  nodes: FilePageNode[];
  selectedNodeIds: string[];
  onMoveNodes: (positions: Record<string, Point>) => void;
  onResizeNode: (nodeId: string, size: FilePageNodeSize) => void;
  onAddNode: (node: FilePageNode) => void;
  onUpdateNode: (nodeId: string, updates: FilePageNodeUpdates) => void;
  onDeleteNode: (nodeId: string) => void;
  onHoverNodeChange: (node: FilePageNode | null) => void;
  onSelectNodes: (nodeIds: string[]) => void;
  getFolderExpandState?: (node: FilePageNode) => 'hidden' | 'expand' | 'collapse';
  getFolderContents?: (node: FilePageNode) => FilePageContentItem[];
  onExpandFolder?: (node: FilePageNode) => void;
  onCollapseFolder?: (node: FilePageNode) => void;
  resolveCanvasFileItem?: (node: FilePageNode) => FilePageContentItem | null;
  resolveCanvasFileId?: (node: FilePageNode) => string | null;
  resolveCanvasFolderSourceFiles?: (node: FilePageNode) => FilePageContentItem[];
  onPreviewContentItemChange?: (item: FilePageContentItem | null) => void;
  onDownloadFileNode?: (node: FilePageNode) => void;
  onRequestDownloadFolderNode?: (node: FilePageNode) => void;
  onUpdateWorkspaceFileContent?: (fileId: string, contentText: string) => void;
}

type DragState = {
  nodeIds: string[];
  selectedNodeIds: string[];
  origin: Point;
  basePositions: Record<string, Point>;
};

type MarqueeState = {
  origin: Point;
  current: Point;
  additive: boolean;
  initialSelection: string[];
};

type PanState = {
  origin: Point;
  baseViewport: Point;
};

type OuterSnapTarget = {
  nodeId: string;
  origin: Point;
};

type SharedOuterSnapTarget = {
  gridOrigin: Point;
  preferredAnchorCandidates?: Point[];
};

type ResizeState = {
  nodeId: string;
  axis: GroupResizeAxis;
  origin: Point;
  basePosition: Point;
  baseSize: FilePageNode['size'];
  minimumSize: FilePageNode['size'];
};

type WorkerConnectionDragState = {
  workerId: string;
  current: Point;
  targetNodeId: string | null;
};

type ConnectorPath = {
  id: string;
  parentNodeId: string;
  childNodeId: string;
  path: string;
  layer: 'below-group' | 'above-group';
  deletable: boolean;
};

type FloatingInspectorWindowState = {
  rect: CanvasFloatingInspectorRect;
  minimized: boolean;
  maximized: boolean;
  restoreRect: CanvasFloatingInspectorRect | null;
};

type FloatingInspectorState = {
  target: CanvasFloatingInspectorTarget;
  window: FloatingInspectorWindowState;
  fileId: string | null;
  phase: 'opening' | 'open' | 'closing';
};

type FloatingInspectorDragState = {
  origin: Point;
  baseRect: CanvasFloatingInspectorRect;
};

type FloatingInspectorResizeState = {
  origin: Point;
  baseRect: CanvasFloatingInspectorRect;
};

const OUTER_WIDGET_SNAP_THRESHOLD = 4;
const GROUP_SNAP_TOLERANCE = Math.round(Math.min(SLOT_STEP_X, SLOT_STEP_Y) * 0.25);
const WORKER_CONNECTION_THRESHOLD_X = SLOT_STEP_X * 1.25;
const WORKER_CONNECTION_THRESHOLD_Y = SLOT_STEP_Y * 1.25;
const FLOATING_INSPECTOR_MIN_WIDTH = 360;
const FLOATING_INSPECTOR_MIN_HEIGHT = 240;
const FLOATING_INSPECTOR_MIN_FILE_HEIGHT = 168;
const FLOATING_INSPECTOR_HEADER_HEIGHT = 60;
const FLOATING_INSPECTOR_TRANSITION_MS = 280;
const CANVAS_PALETTE_DATA_TRANSFER_TYPE = 'application/x-weave-canvas-palette-template';
const CANVAS_PALETTE_TEXT_PREFIX = 'weave-canvas-palette-template:';

function isCanvasPaletteTemplateId(value: string): value is CanvasPaletteTemplateId {
  return (
    value === 'ai-worker' ||
    value === 'sort-worker' ||
    value === 'group' ||
    value === 'element'
  );
}

function hasCanvasPaletteTemplate(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(CANVAS_PALETTE_DATA_TRANSFER_TYPE);
}

function setTransparentDragImage(dataTransfer: DataTransfer) {
  const dragImage = document.createElement('div');
  dragImage.style.position = 'fixed';
  dragImage.style.left = '-9999px';
  dragImage.style.top = '-9999px';
  dragImage.style.width = '1px';
  dragImage.style.height = '1px';
  dragImage.style.opacity = '0';
  dragImage.style.pointerEvents = 'none';
  document.body.appendChild(dragImage);
  dataTransfer.setDragImage(dragImage, 0, 0);

  window.requestAnimationFrame(() => {
    dragImage.remove();
  });
}

function readCanvasPaletteTemplate(dataTransfer: DataTransfer): CanvasPaletteTemplateId | null {
  const directTemplate = dataTransfer.getData(CANVAS_PALETTE_DATA_TRANSFER_TYPE);

  if (isCanvasPaletteTemplateId(directTemplate)) {
    return directTemplate;
  }

  const fallbackTemplate = dataTransfer.getData('text/plain');

  if (!fallbackTemplate.startsWith(CANVAS_PALETTE_TEXT_PREFIX)) {
    return null;
  }

  const candidateTemplateId = fallbackTemplate.slice(CANVAS_PALETTE_TEXT_PREFIX.length);

  return isCanvasPaletteTemplateId(candidateTemplateId) ? candidateTemplateId : null;
}

function sortCanvasContentItems(items: FilePageContentItem[]) {
  return [...items].sort((left, right) =>
    left.kind === right.kind
      ? left.label.localeCompare(right.label)
      : left.kind === 'folder'
        ? -1
        : 1,
  );
}

function getContentItemDedupKey(item: FilePageContentItem) {
  return item.id || `${item.kind}:${item.label.trim().toLowerCase()}`;
}

function createContentHash(value: string | null | undefined) {
  const input = value ?? '';
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }

  return hash.toString(16);
}

function sanitizeFileNameSegment(value: string, fallback: string) {
  const normalizedValue = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return normalizedValue.length > 0 ? normalizedValue : fallback;
}

function formatOutputTimestampParts(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      datePart: 'unknown-date',
      timePart: 'unknown-time',
    };
  }

  const year = date.getFullYear().toString().padStart(4, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');

  return {
    datePart: `${year}${month}${day}`,
    timePart: `${hours}${minutes}${seconds}`,
  };
}

function buildAiOutputItemId(workerId: string, sourceItemId: string) {
  return `${workerId}:ai:${sourceItemId}`;
}

function buildAiOutputFileLabel(
  workerLabel: string,
  sourceLabel: string,
  version: number,
  generatedAt: string,
) {
  const workerSegment = sanitizeFileNameSegment(workerLabel, 'AI-Worker');
  const sourceSegment = sanitizeFileNameSegment(sourceLabel, 'Output');
  const { datePart, timePart } = formatOutputTimestampParts(generatedAt);

  return `${workerSegment}_${sourceSegment}_v${version}_${datePart}_${timePart}.md`;
}

const AI_WORKER_REQUEST_BATCH_SETTINGS: Record<
  FilePageWorkerRunMode,
  {
    maxFilesPerRequest: number;
    targetTotalCharacters: number;
    clientTimeoutMultiplier: number;
  }
> = {
  fast: {
    maxFilesPerRequest: 4,
    targetTotalCharacters: 9_000,
    clientTimeoutMultiplier: 1.15,
  },
  balanced: {
    maxFilesPerRequest: 6,
    targetTotalCharacters: 18_000,
    clientTimeoutMultiplier: 1.3,
  },
  thorough: {
    maxFilesPerRequest: 8,
    targetTotalCharacters: 28_000,
    clientTimeoutMultiplier: 1.45,
  },
};

function getAiWorkerRequestConcurrency(_runMode: FilePageWorkerRunMode) {
  return 2;
}

function buildAiWorkerRequestBatches<T extends { textContent?: string | null }>(
  items: T[],
  runMode: FilePageWorkerRunMode,
) {
  const { maxFilesPerRequest, targetTotalCharacters } = AI_WORKER_REQUEST_BATCH_SETTINGS[runMode];
  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentBatchCharacters = 0;

  items.forEach((item) => {
    const itemCharacters = (item.textContent ?? '').trim().length;
    const wouldExceedFileLimit = currentBatch.length >= maxFilesPerRequest;
    const wouldExceedCharacterTarget =
      currentBatch.length > 0 &&
      currentBatchCharacters + itemCharacters > targetTotalCharacters;

    if ((wouldExceedFileLimit || wouldExceedCharacterTarget) && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchCharacters = 0;
    }

    currentBatch.push(item);
    currentBatchCharacters += itemCharacters;
  });

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function createFallbackFileItem(node: FilePageNode): FilePageContentItem {
  return {
    id: node.id,
    kind: 'file',
    label: node.label,
    description: node.description,
    textContent: null,
    mimeType: null,
    sizeBytes: null,
  };
}

function getPointBounds(point: Point) {
  return {
    left: point.x,
    top: point.y,
    right: point.x,
    bottom: point.y,
  };
}

function arePointsEqual(left?: Point, right?: Point) {
  return left?.x === right?.x && left?.y === right?.y;
}

function pointIsWithinBounds(
  point: Point,
  bounds: ReturnType<typeof getNodeBoundsWithSize>,
) {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function getConnectorPath(
  parentBounds: ReturnType<typeof getNodeBoundsWithSize>,
  childBounds: ReturnType<typeof getNodeBoundsWithSize>,
) {
  const parentCenter = {
    x: (parentBounds.left + parentBounds.right) / 2,
    y: (parentBounds.top + parentBounds.bottom) / 2,
  };
  const childCenter = {
    x: (childBounds.left + childBounds.right) / 2,
    y: (childBounds.top + childBounds.bottom) / 2,
  };
  const deltaX = childCenter.x - parentCenter.x;
  const deltaY = childCenter.y - parentCenter.y;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    const direction = deltaX >= 0 ? 1 : -1;
    const start = {
      x: direction > 0 ? parentBounds.right : parentBounds.left,
      y: parentCenter.y,
    };
    const end = {
      x: direction > 0 ? childBounds.left : childBounds.right,
      y: childCenter.y,
    };
    const controlOffset = Math.max(32, Math.abs(end.x - start.x) * 0.45);

    return `M ${start.x} ${start.y} C ${start.x + controlOffset * direction} ${start.y}, ${end.x - controlOffset * direction} ${end.y}, ${end.x} ${end.y}`;
  }

  const direction = deltaY >= 0 ? 1 : -1;
  const start = {
    x: parentCenter.x,
    y: direction > 0 ? parentBounds.bottom : parentBounds.top,
  };
  const end = {
    x: childCenter.x,
    y: direction > 0 ? childBounds.top : childBounds.bottom,
  };
  const controlOffset = Math.max(28, Math.abs(end.y - start.y) * 0.45);

  return `M ${start.x} ${start.y} C ${start.x} ${start.y + controlOffset * direction}, ${end.x} ${end.y - controlOffset * direction}, ${end.x} ${end.y}`;
}

const COLLATED_WORKER_SOURCE_ITEM_ID = '__collated__';

function formatTimeoutLabel(milliseconds: number) {
  return `${Math.max(1, Math.round(milliseconds / 1000))}s`;
}

export function FileCanvasView({
  nodes,
  selectedNodeIds,
  onMoveNodes,
  onResizeNode,
  onAddNode,
  onUpdateNode,
  onDeleteNode,
  onHoverNodeChange,
  onSelectNodes,
  getFolderExpandState,
  getFolderContents,
  onExpandFolder,
  onCollapseFolder,
  resolveCanvasFileItem,
  resolveCanvasFileId,
  resolveCanvasFolderSourceFiles,
  onPreviewContentItemChange,
  onDownloadFileNode,
  onRequestDownloadFolderNode,
  onUpdateWorkspaceFileContent,
}: FileCanvasViewProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const marqueeStateRef = useRef<MarqueeState | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const workerConnectionDragStateRef = useRef<WorkerConnectionDragState | null>(null);
  const floatingInspectorDragStateRef = useRef<FloatingInspectorDragState | null>(null);
  const floatingInspectorResizeStateRef = useRef<FloatingInspectorResizeState | null>(null);
  const floatingInspectorCloseTimerRef = useRef<number | null>(null);
  const nodeDragMovedRef = useRef(false);
  const suppressPreviewOpenUntilRef = useRef(0);
  const paletteDragDepthRef = useRef(0);
  const rawDragPositionsRef = useRef<Record<string, Point>>({});
  const draftPositionsRef = useRef<Record<string, Point>>({});
  const snapPreviewPositionsRef = useRef<Record<string, Point>>({});
  const activeSnapPreviewIdsRef = useRef<Record<string, boolean>>({});
  const draftSelectedNodeIdsRef = useRef<string[] | null>(null);
  const contextMenuPointRef = useRef<Point | null>(null);
  const workerProcessTimersRef = useRef<Record<string, number>>({});
  const workerRequestControllersRef = useRef<Record<string, AbortController>>({});
  const workerRequestTimeoutsRef = useRef<Record<string, number>>({});
  const workerRequestSignaturesRef = useRef<Record<string, string>>({});
  const nodesRef = useRef(nodes);
  const nodeMapRef = useRef(new Map(nodes.map((node) => [node.id, node])));
  const viewportRef = useRef<Point>({ x: 0, y: 0 });
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const contextMenuNodeIdRef = useRef<string | null>(null);
  const draftSizesRef = useRef<Record<string, FilePageNode['size']>>({});
  const editingNodeIdRef = useRef<string | null>(null);
  const editingLabelRef = useRef('');
  const onMoveNodesRef = useRef(onMoveNodes);
  const onResizeNodeRef = useRef(onResizeNode);
  const onAddNodeRef = useRef(onAddNode);
  const onUpdateNodeRef = useRef(onUpdateNode);
  const onDeleteNodeRef = useRef(onDeleteNode);
  const onHoverNodeChangeRef = useRef(onHoverNodeChange);
  const onSelectNodesRef = useRef(onSelectNodes);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [workerConnectionDragState, setWorkerConnectionDragState] =
    useState<WorkerConnectionDragState | null>(null);
  const [viewport, setViewport] = useState<Point>({ x: 0, y: 0 });
  const [draftPositions, setDraftPositions] = useState<Record<string, Point>>({});
  const [snapPreviewPositions, setSnapPreviewPositions] = useState<Record<string, Point>>({});
  const [activeSnapPreviewIds, setActiveSnapPreviewIds] = useState<Record<string, boolean>>({});
  const [draftSizes, setDraftSizes] = useState<Record<string, FilePageNode['size']>>({});
  const [draftIcons, setDraftIcons] = useState<Record<string, FilePageElementIcon>>({});
  const [draftSelectedNodeIds, setDraftSelectedNodeIds] = useState<string[] | null>(null);
  const [contextMenuNodeId, setContextMenuNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [hoveredConnectorId, setHoveredConnectorId] = useState<string | null>(null);
  const [draggedPaletteTemplateId, setDraggedPaletteTemplateId] =
    useState<CanvasPaletteTemplateId | null>(null);
  const [paletteDragPreviewPoint, setPaletteDragPreviewPoint] = useState<Point | null>(null);
  const [isPaletteDragOverCanvas, setIsPaletteDragOverCanvas] = useState(false);
  const [floatingInspector, setFloatingInspector] = useState<FloatingInspectorState | null>(null);

  useEffect(() => {
    if (!floatingInspector || floatingInspector.phase !== 'opening') {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      setFloatingInspector((current) =>
        current && current.phase === 'opening'
          ? {
              ...current,
              phase: 'open',
            }
          : current,
      );
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [floatingInspector]);

  useEffect(() => {
    if (!floatingInspector || floatingInspector.phase !== 'closing') {
      if (floatingInspectorCloseTimerRef.current !== null) {
        window.clearTimeout(floatingInspectorCloseTimerRef.current);
        floatingInspectorCloseTimerRef.current = null;
      }
      return undefined;
    }

    floatingInspectorCloseTimerRef.current = window.setTimeout(() => {
      setFloatingInspector((current) => (current?.phase === 'closing' ? null : current));
      floatingInspectorCloseTimerRef.current = null;
    }, FLOATING_INSPECTOR_TRANSITION_MS);

    return () => {
      if (floatingInspectorCloseTimerRef.current !== null) {
        window.clearTimeout(floatingInspectorCloseTimerRef.current);
        floatingInspectorCloseTimerRef.current = null;
      }
    };
  }, [floatingInspector]);
  const renderedNodes = useMemo(
    () =>
      [...nodes].sort((left, right) => {
        const leftRank = left.kind === 'group' ? 0 : 1;
        const rightRank = right.kind === 'group' ? 0 : 1;

        return leftRank - rightRank;
      }),
    [nodes],
  );
  const displaySelectedNodeIds = draftSelectedNodeIds ?? selectedNodeIds;
  const selectedIdSet = useMemo(() => new Set(displaySelectedNodeIds), [displaySelectedNodeIds]);
  const dragNodeIdSet = useMemo(() => new Set(dragState?.nodeIds ?? []), [dragState?.nodeIds]);
  const groupNodes = useMemo(
    () => renderedNodes.filter((node) => node.kind === 'group'),
    [renderedNodes],
  );
  const contentNodes = useMemo(
    () => renderedNodes.filter((node) => node.kind !== 'group'),
    [renderedNodes],
  );
  const folderContentsById = useMemo(
    () => {
      const entries = renderedNodes.reduce<Record<string, FilePageContentItem[]>>(
        (accumulator, node) => {
          if (!node.parentNodeId || (node.kind !== 'folder' && node.kind !== 'file')) {
            return accumulator;
          }

          const existingEntries = accumulator[node.parentNodeId] ?? [];
          existingEntries.push({
            id: node.id,
            kind: node.kind,
            label: node.label,
          });
          accumulator[node.parentNodeId] = existingEntries;
          return accumulator;
        },
        {},
      );

      renderedNodes.forEach((node) => {
        if (!node.contentItems || node.contentItems.length === 0) {
          return;
        }

        const existingEntries = entries[node.id] ?? [];
        const dedupedById = new Map(existingEntries.map((item) => [item.id, item]));

        node.contentItems.forEach((item) => {
          if (!dedupedById.has(item.id)) {
            dedupedById.set(item.id, item);
          }
        });

        entries[node.id] = sortCanvasContentItems([...dedupedById.values()]);
      });

      Object.keys(entries).forEach((nodeId) => {
        entries[nodeId] = sortCanvasContentItems(entries[nodeId]);
      });

      return entries;
    },
    [renderedNodes],
  );
  const workerInputContentsById = useMemo(
    () =>
      renderedNodes.reduce<Record<string, FilePageContentItem[]>>((accumulator, node) => {
        if (
          !node.parentNodeId ||
          (node.kind !== 'folder' && node.kind !== 'file') ||
          node.generatedByWorkerId === node.parentNodeId
        ) {
          return accumulator;
        }

        const parentNode = renderedNodes.find((candidate) => candidate.id === node.parentNodeId);

        if (!parentNode || parentNode.kind !== 'worker') {
          return accumulator;
        }

        const existingEntries = accumulator[node.parentNodeId] ?? [];
        existingEntries.push({
          id: node.id,
          kind: node.kind,
          label: node.label,
        });
        accumulator[node.parentNodeId] = sortCanvasContentItems(existingEntries);
        return accumulator;
      }, {}),
    [renderedNodes],
  );
  const connectorPaths = useMemo(() => {
    const nodeMap = new Map(renderedNodes.map((node) => [node.id, node]));

    return renderedNodes.flatMap((node): ConnectorPath[] => {
      if (!node.parentNodeId) {
        return [];
      }

      const parentNode = nodeMap.get(node.parentNodeId);

      if (!parentNode) {
        return [];
      }

      const parentBounds = getNodeBoundsWithSize(
        draftPositions[node.parentNodeId] ?? parentNode.position,
        draftSizes[node.parentNodeId] ?? parentNode.size,
        parentNode.kind,
      );
      const childBounds = getNodeBoundsWithSize(
        draftPositions[node.id] ?? node.position,
        draftSizes[node.id] ?? node.size,
        node.kind,
      );

      return [
        {
          id: `${node.parentNodeId}->${node.id}`,
          parentNodeId: node.parentNodeId,
          childNodeId: node.id,
          path: getConnectorPath(parentBounds, childBounds),
          layer:
            node.groupId && parentNode.groupId === node.groupId
              ? 'above-group'
              : 'below-group',
          deletable: node.generatedByWorkerId !== node.parentNodeId,
        },
      ];
    });
  }, [draftPositions, draftSizes, renderedNodes]);
  const belowGroupConnectorPaths = useMemo(
    () => connectorPaths.filter((connector) => connector.layer === 'below-group'),
    [connectorPaths],
  );
  const aboveGroupConnectorPaths = useMemo(
    () => connectorPaths.filter((connector) => connector.layer === 'above-group'),
    [connectorPaths],
  );
  const outerCanvasFields = useMemo(() => {
    const baseFieldPadding = GRID_SIZE * 1.5;
    const activeFieldPadding = GRID_SIZE * 2.5;
    const activationRadius = GRID_SIZE * 4;
    const outerNodes = contentNodes
      .filter((node) => !node.groupId)
      .map((node) => {
        const position = draftPositions[node.id] ?? node.position;
        const size = draftSizes[node.id] ?? node.size;
        const bounds = getNodeBoundsWithSize(position, size, node.kind);

        return {
          node,
          bounds,
          center: {
            x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2,
          },
        };
      });
    const stationaryNodes = outerNodes.filter(({ node }) => !dragNodeIdSet.has(node.id));
    const activeNodes = outerNodes.filter(({ node }) => dragNodeIdSet.has(node.id));

    return stationaryNodes.map(({ node, bounds, center }) => {
      const isDragged = dragNodeIdSet.has(node.id);
      const isNearActiveNode =
        !isDragged &&
        activeNodes.some((activeNode) => {
          const deltaX = activeNode.center.x - center.x;
          const deltaY = activeNode.center.y - center.y;

          return Math.hypot(deltaX, deltaY) <= activationRadius;
        });
      const isActive = isDragged || isNearActiveNode;
      const fieldPadding = isActive ? activeFieldPadding : baseFieldPadding;

      return {
        id: `${node.id}-field`,
        left: bounds.left - fieldPadding,
        top: bounds.top - fieldPadding,
        width: bounds.right - bounds.left + fieldPadding * 2,
        height: bounds.bottom - bounds.top + fieldPadding * 2,
        isActive,
        };
      });
  }, [contentNodes, draftPositions, draftSizes, dragNodeIdSet]);
  const groupCanvasFields = useMemo(() => {
    const baseFieldPadding = GRID_SIZE * 1.5;
    const activeFieldPadding = GRID_SIZE * 2.5;
    const activationRadius = GRID_SIZE * 4;

    return groupNodes.flatMap((groupNode) => {
      const contentBounds = getGroupContentBounds(
        draftPositions[groupNode.id] ?? groupNode.position,
        draftSizes[groupNode.id] ?? groupNode.size,
      );
      const groupedNodes = contentNodes
        .filter((node) => node.groupId === groupNode.id)
        .map((node) => {
          const position = draftPositions[node.id] ?? node.position;
          const size = draftSizes[node.id] ?? node.size;
          const bounds = getNodeBoundsWithSize(position, size, node.kind);

          return {
            node,
            bounds,
            center: {
              x: (bounds.left + bounds.right) / 2,
              y: (bounds.top + bounds.bottom) / 2,
            },
          };
        });
      const stationaryNodes = groupedNodes.filter(({ node }) => !dragNodeIdSet.has(node.id));
      const activeNodes = groupedNodes.filter(({ node }) => dragNodeIdSet.has(node.id));

      return stationaryNodes.flatMap(({ node, bounds, center }) => {
        const isNearActiveNode = activeNodes.some((activeNode) => {
          const deltaX = activeNode.center.x - center.x;
          const deltaY = activeNode.center.y - center.y;

          return Math.hypot(deltaX, deltaY) <= activationRadius;
        });
        const fieldPadding = isNearActiveNode ? activeFieldPadding : baseFieldPadding;
        const left = Math.max(contentBounds.left, bounds.left - fieldPadding);
        const top = Math.max(contentBounds.top, bounds.top - fieldPadding);
        const right = Math.min(contentBounds.right, bounds.right + fieldPadding);
        const bottom = Math.min(contentBounds.bottom, bounds.bottom + fieldPadding);

        if (right <= left || bottom <= top) {
          return [];
        }

        return [
          {
            id: `${groupNode.id}:${node.id}-field`,
            left,
            top,
            width: right - left,
            height: bottom - top,
            isActive: isNearActiveNode,
          },
        ];
      });
    });
  }, [contentNodes, draftPositions, draftSizes, dragNodeIdSet, groupNodes]);

  useEffect(() => {
    nodesRef.current = nodes;
    nodeMapRef.current = new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

  useEffect(() => {
    editingNodeIdRef.current = editingNodeId;
  }, [editingNodeId]);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    marqueeStateRef.current = marqueeState;
  }, [marqueeState]);

  useEffect(() => {
    panStateRef.current = panState;
  }, [panState]);

  useEffect(() => {
    resizeStateRef.current = resizeState;
  }, [resizeState]);

  useEffect(() => {
    workerConnectionDragStateRef.current = workerConnectionDragState;
  }, [workerConnectionDragState]);

  useEffect(() => {
    draftPositionsRef.current = draftPositions;
  }, [draftPositions]);

  useEffect(() => {
    draftSizesRef.current = draftSizes;
  }, [draftSizes]);

  useEffect(() => {
    snapPreviewPositionsRef.current = snapPreviewPositions;
  }, [snapPreviewPositions]);

  useEffect(() => {
    activeSnapPreviewIdsRef.current = activeSnapPreviewIds;
  }, [activeSnapPreviewIds]);

  useEffect(() => {
    draftSelectedNodeIdsRef.current = draftSelectedNodeIds;
  }, [draftSelectedNodeIds]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    contextMenuNodeIdRef.current = contextMenuNodeId;
  }, [contextMenuNodeId]);

  useEffect(() => {
    editingLabelRef.current = editingLabel;
  }, [editingLabel]);

  useEffect(() => {
    onMoveNodesRef.current = onMoveNodes;
    onResizeNodeRef.current = onResizeNode;
    onAddNodeRef.current = onAddNode;
    onUpdateNodeRef.current = onUpdateNode;
    onDeleteNodeRef.current = onDeleteNode;
    onHoverNodeChangeRef.current = onHoverNodeChange;
    onSelectNodesRef.current = onSelectNodes;
  }, [
    onAddNode,
    onDeleteNode,
    onHoverNodeChange,
    onMoveNodes,
    onResizeNode,
    onSelectNodes,
    onUpdateNode,
  ]);

  useEffect(() => {
    if (!editingNodeId) {
      return;
    }

    const node = nodes.find((entry) => entry.id === editingNodeId);

    if (!node) {
      setEditingNodeId(null);
      setEditingLabel('');
    }
  }, [editingNodeId, nodes]);

  useEffect(() => {
    return () => {
      onHoverNodeChange(null);
      Object.values(workerProcessTimersRef.current).forEach((timerId) => {
        window.clearInterval(timerId);
      });
      workerProcessTimersRef.current = {};
      Object.values(workerRequestControllersRef.current).forEach((controller) => {
        controller.abort();
      });
      workerRequestControllersRef.current = {};
      Object.values(workerRequestTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      workerRequestTimeoutsRef.current = {};
      workerRequestSignaturesRef.current = {};
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
      }
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [onHoverNodeChange]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const liveDragState = dragStateRef.current;
      const liveMarqueeState = marqueeStateRef.current;
      const livePanState = panStateRef.current;
      const liveResizeState = resizeStateRef.current;
      const liveWorkerConnectionDragState = workerConnectionDragStateRef.current;

      if (
        !liveDragState &&
        !liveMarqueeState &&
        !livePanState &&
        !liveResizeState &&
        !liveWorkerConnectionDragState
      ) {
        return;
      }

      if (liveResizeState) {
        const resizingNode = getNodeById(liveResizeState.nodeId);
        const localPoint = getLocalPoint(event.clientX, event.clientY);

        if (!resizingNode || !localPoint) {
          return;
        }

        const baseDimensions = getNodeDimensionsForKind(
          liveResizeState.baseSize,
          resizingNode.kind,
        );
        const widthChromeInset = 0;
        const heightChromeInset = 0;
        const currentSize = draftSizesRef.current[resizingNode.id] ?? resizingNode.size;
        const resizesWidth =
          liveResizeState.axis === 'left' ||
          liveResizeState.axis === 'right' ||
          liveResizeState.axis === 'top-left' ||
          liveResizeState.axis === 'bottom-right';
        const resizesHeight =
          liveResizeState.axis === 'top' ||
          liveResizeState.axis === 'bottom' ||
          liveResizeState.axis === 'top-left' ||
          liveResizeState.axis === 'bottom-right';
        const resizeFromLeft =
          liveResizeState.axis === 'left' || liveResizeState.axis === 'top-left';
        const resizeFromTop =
          liveResizeState.axis === 'top' || liveResizeState.axis === 'top-left';
        const getResizePosition = (size: FilePageNode['size']) => {
          const nextDimensions = getNodeDimensionsForKind(size, resizingNode.kind);

          return {
            x:
              liveResizeState.basePosition.x +
              (resizeFromLeft ? baseDimensions.width - nextDimensions.width : 0),
            y:
              liveResizeState.basePosition.y +
              (resizeFromTop ? baseDimensions.height - nextDimensions.height : 0),
          };
        };
        const candidateSize = {
          widthUnits:
            !resizesWidth
              ? currentSize.widthUnits
              : getUnitsForDimension(
                  baseDimensions.width -
                    widthChromeInset +
                    (resizeFromLeft
                      ? liveResizeState.origin.x - localPoint.x
                      : localPoint.x - liveResizeState.origin.x),
                  SLOT_STEP_X,
                  liveResizeState.minimumSize.widthUnits,
                ),
          heightUnits:
            !resizesHeight
              ? currentSize.heightUnits
              : getUnitsForDimension(
                  baseDimensions.height -
                    heightChromeInset +
                    (resizeFromTop
                      ? liveResizeState.origin.y - localPoint.y
                      : localPoint.y - liveResizeState.origin.y),
                  SLOT_STEP_Y,
                  liveResizeState.minimumSize.heightUnits,
                ),
        };
        const fallbackSizes = [
          candidateSize,
          ...(resizesWidth && resizesHeight
            ? [
                {
                  widthUnits: candidateSize.widthUnits,
                  heightUnits: currentSize.heightUnits,
                },
                {
                  widthUnits: currentSize.widthUnits,
                  heightUnits: candidateSize.heightUnits,
                },
              ]
            : []),
        ];
        const nextSize = fallbackSizes.find((size) => {
          const nextPosition = getResizePosition(size);

          return (
            areSizesEqual(size, currentSize) ||
            canResizeNode(resizingNode.id, size, nextPosition)
          );
        });

        if (!nextSize || areSizesEqual(nextSize, currentSize)) {
          return;
        }

        const nextPosition = getResizePosition(nextSize);

        setDraftSizes((current) => ({
          ...current,
          [resizingNode.id]: nextSize,
        }));
        setDraftPositions((current) => ({
          ...current,
          [resizingNode.id]: nextPosition,
        }));
        return;
      }

      if (livePanState) {
        setViewport({
          x: livePanState.baseViewport.x + (event.clientX - livePanState.origin.x),
          y: livePanState.baseViewport.y + (event.clientY - livePanState.origin.y),
        });
        return;
      }

      const localPoint = getLocalPoint(event.clientX, event.clientY);

      if (!localPoint) {
        return;
      }

      if (liveWorkerConnectionDragState) {
        const nextWorkerConnectionState = {
          workerId: liveWorkerConnectionDragState.workerId,
          current: localPoint,
          targetNodeId: getWorkerInputDropTarget(liveWorkerConnectionDragState.workerId, localPoint),
        };

        workerConnectionDragStateRef.current = nextWorkerConnectionState;
        setWorkerConnectionDragState(nextWorkerConnectionState);
        return;
      }

      if (liveDragState) {
        if (
          !nodeDragMovedRef.current &&
          (Math.abs(localPoint.x - liveDragState.origin.x) > 3 ||
            Math.abs(localPoint.y - liveDragState.origin.y) > 3)
        ) {
          nodeDragMovedRef.current = true;
        }

        let rawNextPositions = liveDragState.nodeIds.reduce<Record<string, Point>>(
          (positions, nodeId) => {
            const basePosition = liveDragState.basePositions[nodeId];
            const nextX = basePosition.x + (localPoint.x - liveDragState.origin.x);
            const nextY = basePosition.y + (localPoint.y - liveDragState.origin.y);

            positions[nodeId] = {
              x: clampToCanvas(nextX),
              y: clampToCanvas(nextY),
            };

            return positions;
          },
          {},
        );
        const dragNodeIdSet = new Set(liveDragState.nodeIds);
        const draggedBranchNodeIds = liveDragState.nodeIds.reduce<Map<string, string[]>>(
          (branches, nodeId) => {
            let currentNode = getNodeById(nodeId);
            let branchRootId = nodeId;

            while (currentNode?.parentNodeId && dragNodeIdSet.has(currentNode.parentNodeId)) {
              branchRootId = currentNode.parentNodeId;
              currentNode = getNodeById(currentNode.parentNodeId);
            }

            const existingNodeIds = branches.get(branchRootId) ?? [];
            existingNodeIds.push(nodeId);
            branches.set(branchRootId, existingNodeIds);
            return branches;
          },
          new Map(),
        );

        draggedBranchNodeIds.forEach((branchNodeIds) => {
          const branchGroupId = branchNodeIds.reduce<string | null>((groupId, nodeId) => {
            if (groupId) {
              return groupId;
            }

            return getNodeById(nodeId)?.groupId ?? null;
          }, null);

          if (!branchGroupId) {
            return;
          }

          const groupNode = getNodeById(branchGroupId);
          const groupContentBounds = getGroupBounds(branchGroupId, rawNextPositions);

          if (!groupNode || !groupContentBounds) {
            return;
          }

          const groupOuterBounds = getNodeBoundsWithSize(
            rawNextPositions[groupNode.id] ?? groupNode.position,
            draftSizesRef.current[groupNode.id] ?? groupNode.size,
            groupNode.kind,
          );
          const layoutBounds = getLayoutBounds(rawNextPositions, branchNodeIds);

          if (!layoutBounds || !rectanglesIntersect(layoutBounds, groupOuterBounds)) {
            return;
          }

          rawNextPositions = constrainNodeLayoutToBounds(
            rawNextPositions,
            branchNodeIds,
            groupContentBounds,
          );
        });
        const nextDraftPositions = { ...rawNextPositions };
        const candidateGroupIds = new Map<string, string | null>();

        liveDragState.nodeIds.forEach((nodeId) => {
          const movingNode = getNodeById(nodeId);

          if (
            !movingNode ||
            movingNode.kind === 'group' ||
            (movingNode.groupId && liveDragState.nodeIds.includes(movingNode.groupId))
          ) {
            return;
          }

          const nextSize = draftSizesRef.current[nodeId] ?? movingNode.size;
          const lockedConnectedGroupId = getLockedConnectedGroupId(
            movingNode,
            candidateGroupIds,
          );
          const detectedGroupId = findContainingGroupId(
            movingNode,
            rawNextPositions[nodeId],
            nextSize,
            rawNextPositions,
          );
          let nextGroupId =
            lockedConnectedGroupId !== undefined ? lockedConnectedGroupId : detectedGroupId;

          if (
            lockedConnectedGroupId === undefined &&
            !detectedGroupId &&
            movingNode.groupId
          ) {
            const currentGroupBounds = getGroupBounds(movingNode.groupId, rawNextPositions);

            if (currentGroupBounds) {
              const releaseThreshold = Math.min(SLOT_STEP_X, SLOT_STEP_Y) / 2;
              const distanceFromBoundary = Math.max(
                Math.max(currentGroupBounds.left - rawNextPositions[nodeId].x, 0),
                Math.max(
                  rawNextPositions[nodeId].x +
                    getNodeDimensionsForKind(nextSize, movingNode.kind).width -
                    currentGroupBounds.right,
                  0,
                ),
                Math.max(currentGroupBounds.top - rawNextPositions[nodeId].y, 0),
                Math.max(
                  rawNextPositions[nodeId].y +
                    getNodeDimensionsForKind(nextSize, movingNode.kind).height -
                    currentGroupBounds.bottom,
                  0,
                ),
              );

              if (distanceFromBoundary <= releaseThreshold) {
                nextGroupId = movingNode.groupId;
              }
            }
          }

          candidateGroupIds.set(nodeId, nextGroupId);

        });
        const draggedBranchNodeIdsByGroup = liveDragState.nodeIds.reduce<Map<string, string[]>>(
          (branches, nodeId) => {
            let currentNode = getNodeById(nodeId);
            let branchRootId = nodeId;

            while (currentNode?.parentNodeId && dragNodeIdSet.has(currentNode.parentNodeId)) {
              branchRootId = currentNode.parentNodeId;
              currentNode = getNodeById(currentNode.parentNodeId);
            }

            const existingNodeIds = branches.get(branchRootId) ?? [];
            existingNodeIds.push(nodeId);
            branches.set(branchRootId, existingNodeIds);
            return branches;
          },
          new Map(),
        );

        draggedBranchNodeIdsByGroup.forEach((branchNodeIds) => {
          const branchGroupId = branchNodeIds.reduce<string | null>((groupId, nodeId) => {
            if (groupId) {
              return groupId;
            }

            const movingNode = getNodeById(nodeId);
            if (candidateGroupIds.has(nodeId)) {
              return candidateGroupIds.get(nodeId) ?? null;
            }

            return movingNode?.groupId ?? null;
          }, null);

          if (!branchGroupId) {
            return;
          }

          const groupBounds = getGroupBounds(branchGroupId, rawNextPositions);
          const layoutBounds = getLayoutBounds(rawNextPositions, branchNodeIds);

          if (!groupBounds || !layoutBounds || !rectanglesIntersect(layoutBounds, groupBounds)) {
            return;
          }

          branchNodeIds.forEach((nodeId) => {
            candidateGroupIds.set(nodeId, branchGroupId);
          });
        });
        const constrainedGroupResult = constrainDraggedLayoutsToTargetGroups(
          nextDraftPositions,
          liveDragState.nodeIds,
          candidateGroupIds,
        );
        const constrainedCandidateGroupIds = constrainedGroupResult.candidateGroupIds;
        const constrainedDraftPositions = constrainedGroupResult.positions;
        const desiredSnapPositions = liveDragState.nodeIds.reduce<Record<string, Point>>(
          (positions, nodeId) => {
            positions[nodeId] = constrainedDraftPositions[nodeId];

            return positions;
          },
          {},
        );
        const dragTargetGroupIds = liveDragState.nodeIds.map((nodeId) =>
          constrainedCandidateGroupIds.get(nodeId),
        );
        const firstDragTargetGroupId = dragTargetGroupIds[0];
        const sharedDragTargetGroupId =
          typeof firstDragTargetGroupId === 'string' &&
          dragTargetGroupIds.every((groupId) => groupId === firstDragTargetGroupId)
            ? firstDragTargetGroupId
            : null;
        const sharedDragTargetBounds =
          typeof sharedDragTargetGroupId === 'string'
            ? getGroupBounds(sharedDragTargetGroupId, constrainedDraftPositions)
            : null;
        const sharedGroupSnapOrigin = sharedDragTargetBounds
          ? getSharedGroupSnapOrigin(
              liveDragState.nodeIds,
              desiredSnapPositions,
              liveDragState.basePositions,
              constrainedCandidateGroupIds,
              sharedDragTargetGroupId!,
            )
          : null;
        const sharedOuterSnapTarget =
          sharedDragTargetBounds || sharedGroupSnapOrigin
            ? null
            : getSharedOuterSnapOrigin(
                liveDragState.nodeIds,
                desiredSnapPositions,
                liveDragState.basePositions,
                constrainedCandidateGroupIds,
              );
        const nextActiveSnapPreviewIds = liveDragState.nodeIds.reduce<Record<string, boolean>>(
          (accumulator, nodeId) => {
            accumulator[nodeId] = Boolean(sharedGroupSnapOrigin || sharedOuterSnapTarget);
            return accumulator;
          },
          {},
        );
        const nextSnapPositions = sharedDragTargetBounds && sharedGroupSnapOrigin
          ? resolveSnapPositions(
              desiredSnapPositions,
              liveDragState.nodeIds,
              nodesRef.current.filter((node) => !liveDragState.nodeIds.includes(node.id)),
              liveDragState.basePositions,
              Object.fromEntries(
                nodesRef.current.map((node) => [node.id, draftSizesRef.current[node.id] ?? node.size]),
              ),
              (leftNodeId, rightNodeId) =>
                canNodesShareSpace(
                  getNodeById(leftNodeId),
                  getNodeById(rightNodeId),
                  constrainedCandidateGroupIds,
                ),
              {
                anchorGridOrigin: sharedGroupSnapOrigin,
                constrainPosition: (position, nodeId) => {
                  const movingNode = getNodeById(nodeId);

                  if (!movingNode) {
                    return {
                      x: clampToCanvas(position.x),
                      y: clampToCanvas(position.y),
                    };
                  }

                  if (
                    (constrainedCandidateGroupIds.get(nodeId) ?? null) !==
                    sharedDragTargetGroupId
                  ) {
                    return null;
                  }

                  const nextSize = draftSizesRef.current[nodeId] ?? movingNode.size;
                  const clampedPosition = clampNodePositionToBounds(
                    position,
                    nextSize,
                    sharedDragTargetBounds,
                  );

                  return clampedPosition.x === position.x && clampedPosition.y === position.y
                    ? clampedPosition
                    : null;
                },
                getNodeKind: (nodeId) => getNodeById(nodeId)?.kind,
              },
            )
          : sharedDragTargetBounds
            ? desiredSnapPositions
          : sharedOuterSnapTarget
            ? resolveSnapPositions(
                desiredSnapPositions,
                liveDragState.nodeIds,
                nodesRef.current.filter((node) => !liveDragState.nodeIds.includes(node.id)),
                liveDragState.basePositions,
                Object.fromEntries(
                  nodesRef.current.map((node) => [node.id, draftSizesRef.current[node.id] ?? node.size]),
                ),
                (leftNodeId, rightNodeId) =>
                canNodesShareSpace(
                  getNodeById(leftNodeId),
                  getNodeById(rightNodeId),
                  constrainedCandidateGroupIds,
                ),
                {
                  anchorGridOrigin: sharedOuterSnapTarget.gridOrigin,
                  preferredAnchorCandidates: sharedOuterSnapTarget.preferredAnchorCandidates,
                  toSnapPosition: (position, nodeId) => {
                    const node = getNodeById(nodeId);

                    return node?.kind === 'group'
                      ? {
                          x: position.x - GROUP_CONTENT_INSET_LEFT,
                          y: position.y - GROUP_CONTENT_INSET_TOP,
                        }
                      : position;
                  },
                  fromSnapPosition: (position, nodeId) => {
                    const node = getNodeById(nodeId);

                    return node?.kind === 'group'
                      ? {
                          x: position.x + GROUP_CONTENT_INSET_LEFT,
                          y: position.y + GROUP_CONTENT_INSET_TOP,
                        }
                      : position;
                  },
                  constrainPosition: (position) => ({
                    x: clampToCanvas(position.x),
                    y: clampToCanvas(position.y),
                  }),
                  getNodeKind: (nodeId) => getNodeById(nodeId)?.kind,
                },
              )
          : desiredSnapPositions;
        const predictiveLandingPositions = pushDraggedLayoutsOutsideGroups(
          nextSnapPositions,
          liveDragState.nodeIds,
          constrainedCandidateGroupIds,
        );
        rawDragPositionsRef.current = rawNextPositions;
        draftPositionsRef.current = constrainedDraftPositions;
        snapPreviewPositionsRef.current = predictiveLandingPositions;
        activeSnapPreviewIdsRef.current = nextActiveSnapPreviewIds;

        if (frameRef.current === null) {
          frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            setDraftPositions(draftPositionsRef.current);
            setSnapPreviewPositions(snapPreviewPositionsRef.current);
            setActiveSnapPreviewIds(activeSnapPreviewIdsRef.current);
          });
        }
        return;
      }

      if (!liveMarqueeState) {
        return;
      }

      const nextMarquee = {
        ...liveMarqueeState,
        current: localPoint,
      };
      const marqueeRect = normalizeRectangle(liveMarqueeState.origin, localPoint);
      const intersectingIds = nodesRef.current
        .filter((node) => {
          const position = draftPositionsRef.current[node.id] ?? node.position;
          const size = draftSizesRef.current[node.id] ?? node.size;
          const bounds = getNodeBoundsWithSize(position, size, node.kind);

          return rectanglesIntersect(marqueeRect, bounds);
        })
        .map((node) => node.id);

      marqueeStateRef.current = nextMarquee;
      draftSelectedNodeIdsRef.current =
        liveMarqueeState.additive
          ? Array.from(new Set([...liveMarqueeState.initialSelection, ...intersectingIds]))
          : intersectingIds;

      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null;
          setMarqueeState(marqueeStateRef.current);
          setDraftSelectedNodeIds(draftSelectedNodeIdsRef.current);
        });
      }
    };

    const handlePointerUp = () => {
      const liveDragState = dragStateRef.current;
      const liveMarqueeState = marqueeStateRef.current;
      const liveSnapPreviewPositions = snapPreviewPositionsRef.current;
      const liveResizeState = resizeStateRef.current;
      const liveWorkerConnectionDragState = workerConnectionDragStateRef.current;

      if (liveWorkerConnectionDragState?.targetNodeId) {
        const targetNode = getNodeById(liveWorkerConnectionDragState.targetNodeId);

        if (targetNode && (targetNode.parentNodeId ?? null) !== liveWorkerConnectionDragState.workerId) {
          onUpdateNodeRef.current(targetNode.id, {
            parentNodeId: liveWorkerConnectionDragState.workerId,
          });
        }
      }

      if (liveDragState && Object.keys(liveSnapPreviewPositions).length > 0) {
        const finalSnapPositions = { ...liveSnapPreviewPositions };
        const nextGroupIds = new Map<string, string | null>();
        const rawNextPositions = rawDragPositionsRef.current;
        const nextPositions = nodesRef.current.reduce<Record<string, Point>>((positions, node) => {
          positions[node.id] = finalSnapPositions[node.id] ?? node.position;
          return positions;
        }, {});

        liveDragState.nodeIds.forEach((nodeId) => {
          const node = getNodeById(nodeId);

          if (!node || node.kind === 'group') {
            return;
          }

          const rawPosition = rawNextPositions[nodeId] ?? nextPositions[nodeId];
          const previewPosition = finalSnapPositions[nodeId] ?? nextPositions[nodeId];
          const lockedConnectedGroupId = getLockedConnectedGroupId(node, nextGroupIds);
          const previewGroupId = findContainingGroupId(
            node,
            previewPosition,
            draftSizesRef.current[node.id] ?? node.size,
            {
              ...nextPositions,
              [nodeId]: previewPosition,
            },
          );
          const nextGroupId =
            lockedConnectedGroupId !== undefined
              ? lockedConnectedGroupId
              : previewGroupId ??
                findContainingGroupId(node, rawPosition, draftSizesRef.current[node.id] ?? node.size, {
                  ...nextPositions,
                  [nodeId]: rawPosition,
                });

          nextGroupIds.set(node.id, nextGroupId);

          const parentBounds =
            typeof nextGroupId === 'string' ? getGroupBounds(nextGroupId, nextPositions) : null;
          const desiredPosition =
            nextGroupId && parentBounds
              ? clampNodePositionToBounds(
                  previewPosition,
                  draftSizesRef.current[node.id] ?? node.size,
                  parentBounds,
                )
              : previewPosition;

          if (!nextGroupId || !parentBounds) {
            finalSnapPositions[node.id] = desiredPosition;
            nextPositions[node.id] = desiredPosition;
            return;
          }

          finalSnapPositions[node.id] = desiredPosition;
          nextPositions[node.id] = desiredPosition;
        });
        const constrainedFinalResult = constrainDraggedLayoutsToTargetGroups(
          finalSnapPositions,
          liveDragState.nodeIds,
          nextGroupIds,
        );
        const constrainedFinalPositions = pushDraggedLayoutsOutsideGroups(
          constrainedFinalResult.positions,
          liveDragState.nodeIds,
          constrainedFinalResult.candidateGroupIds,
        );

        onMoveNodesRef.current(constrainedFinalPositions);
        draftPositionsRef.current = constrainedFinalPositions;
        setDraftPositions(constrainedFinalPositions);

        constrainedFinalResult.candidateGroupIds.forEach((nextGroupId, nodeId) => {
          const node = getNodeById(nodeId);

          if (node && (node.groupId ?? null) !== nextGroupId) {
            onUpdateNodeRef.current(node.id, {
              groupId: nextGroupId,
            });
          }
        });

        const workerConnectionAssignments = getDraggedWorkerConnectionAssignments(
          liveDragState.nodeIds,
          constrainedFinalPositions,
        );

        workerConnectionAssignments.forEach((nextParentId, nodeId) => {
          const node = getNodeById(nodeId);

          if (node && (node.parentNodeId ?? null) !== nextParentId) {
            onUpdateNodeRef.current(node.id, {
              parentNodeId: nextParentId,
            });
          }
        });
      }

      if (liveDragState && nodeDragMovedRef.current) {
        suppressPreviewOpenUntilRef.current = Date.now() + 180;
      }

      if (liveResizeState) {
        const nextSize = draftSizesRef.current[liveResizeState.nodeId] ?? liveResizeState.baseSize;
        const nextPosition =
          draftPositionsRef.current[liveResizeState.nodeId] ?? liveResizeState.basePosition;

        if (!areSizesEqual(nextSize, liveResizeState.baseSize)) {
          if (!arePointsEqual(nextPosition, liveResizeState.basePosition)) {
            onMoveNodesRef.current({
              [liveResizeState.nodeId]: nextPosition,
            });
          }

          onResizeNodeRef.current(liveResizeState.nodeId, nextSize);
        }

        onSelectNodesRef.current([liveResizeState.nodeId]);
      }

      if (liveMarqueeState) {
        onSelectNodesRef.current(
          draftSelectedNodeIdsRef.current ??
            (liveMarqueeState.additive ? liveMarqueeState.initialSelection : []),
        );
      }

      panStateRef.current = null;
      resizeStateRef.current = null;
      workerConnectionDragStateRef.current = null;
      setPanState(null);
      setResizeState(null);
      setWorkerConnectionDragState(null);
      dragStateRef.current = null;
      nodeDragMovedRef.current = false;
      marqueeStateRef.current = null;
      draftSelectedNodeIdsRef.current = null;
      setDragState(null);
      setMarqueeState(null);
      setDraftSelectedNodeIds(null);

      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
      }

      releaseTimerRef.current = window.setTimeout(() => {
        rawDragPositionsRef.current = {};
        draftPositionsRef.current = {};
        snapPreviewPositionsRef.current = {};
        activeSnapPreviewIdsRef.current = {};
        setDraftPositions({});
        setSnapPreviewPositions({});
        setActiveSnapPreviewIds({});
        setDraftSizes({});
        releaseTimerRef.current = null;
      }, 120);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  const closeFloatingInspector = useCallback(() => {
    floatingInspectorDragStateRef.current = null;
    floatingInspectorResizeStateRef.current = null;
    setFloatingInspector((current) =>
      current
        ? {
            ...current,
            phase: 'closing',
          }
        : null,
    );
  }, []);

  const toggleFloatingInspectorMinimize = useCallback(() => {
    setFloatingInspector((current) =>
      current
        ? {
            ...current,
            window: {
              ...current.window,
              minimized: !current.window.minimized,
            },
          }
        : current,
    );
  }, []);

  const toggleFloatingInspectorMaximize = useCallback(() => {
    setFloatingInspector((current) => {
      if (!current) {
        return current;
      }

      if (current.window.maximized) {
        return {
          ...current,
          window: {
            ...current.window,
            rect: current.window.restoreRect ?? current.window.rect,
            minimized: false,
            maximized: false,
            restoreRect: null,
          },
        };
      }

      const canvasRect = canvasRef.current?.getBoundingClientRect();

      if (!canvasRect) {
        return current;
      }

      return {
        ...current,
        window: {
          ...current.window,
          rect: {
            x: 16,
            y: 16,
            width: Math.max(FLOATING_INSPECTOR_MIN_WIDTH, canvasRect.width - 32),
            height: Math.max(FLOATING_INSPECTOR_MIN_HEIGHT, canvasRect.height - 32),
          },
          minimized: false,
          maximized: true,
          restoreRect: current.window.rect,
        },
      };
    });
  }, []);

  const handleFloatingInspectorHeaderPointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    setFloatingInspector((current) => {
      if (!current || current.window.maximized) {
        return current;
      }

      floatingInspectorDragStateRef.current = {
        origin: { x: event.clientX, y: event.clientY },
        baseRect: current.window.rect,
      };

      return current;
    });
  }, []);

  const handleFloatingInspectorResizePointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    setFloatingInspector((current) => {
      if (!current || current.window.maximized || current.window.minimized) {
        return current;
      }

      floatingInspectorResizeStateRef.current = {
        origin: { x: event.clientX, y: event.clientY },
        baseRect: current.window.rect,
      };

      return current;
    });
  }, []);

  const handleFloatingInspectorTextChange = useCallback((value: string) => {
    setFloatingInspector((current) => {
      if (!current || current.target.type !== 'file') {
        return current;
      }

      return {
        ...current,
        target: {
          ...current.target,
          textContent: value,
          sizeBytes: value.length,
        },
      };
    });

    if (floatingInspector?.fileId && onUpdateWorkspaceFileContent) {
      onUpdateWorkspaceFileContent(floatingInspector.fileId, value);
    }
  }, [floatingInspector?.fileId, onUpdateWorkspaceFileContent]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const liveDragState = floatingInspectorDragStateRef.current;
      const liveResizeState = floatingInspectorResizeStateRef.current;

      if (!liveDragState && !liveResizeState) {
        return;
      }

      if (liveDragState) {
        setFloatingInspector((current) =>
          current
            ? {
                ...current,
                window: {
                  ...current.window,
                  rect: clampFloatingInspectorRect(
                    {
                      ...liveDragState.baseRect,
                      x: liveDragState.baseRect.x + (event.clientX - liveDragState.origin.x),
                      y: liveDragState.baseRect.y + (event.clientY - liveDragState.origin.y),
                    },
                    current.target.type,
                  ),
                },
              }
            : current,
        );
        return;
      }

      if (!liveResizeState) {
        return;
      }

      setFloatingInspector((current) =>
        current
          ? {
              ...current,
              window: {
                ...current.window,
                rect: clampFloatingInspectorRect(
                  {
                    ...liveResizeState.baseRect,
                    width: liveResizeState.baseRect.width + (event.clientX - liveResizeState.origin.x),
                    height: liveResizeState.baseRect.height + (event.clientY - liveResizeState.origin.y),
                  },
                  current.target.type,
                ),
              },
            }
          : current,
      );
    };

    const handlePointerUp = () => {
      floatingInspectorDragStateRef.current = null;
      floatingInspectorResizeStateRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [clampFloatingInspectorRect]);

  useEffect(() => {
    if (dragState || marqueeState || panState || resizeState) {
      return;
    }

    const nextPositions = nodes.reduce<Record<string, Point>>((positions, node) => {
      positions[node.id] = node.position;
      return positions;
    }, {});
    const correctedPositions: Record<string, Point> = {};

    nodes
      .filter((node) => node.kind !== 'group')
      .forEach((node) => {
        const currentPosition = nextPositions[node.id] ?? node.position;
        const parentBounds = node.groupId ? getGroupBounds(node.groupId, nextPositions) : null;
        if (!parentBounds) {
          return;
        }

        const nextPosition = clampNodePositionToBounds(currentPosition, node.size, parentBounds);

        nextPositions[node.id] = nextPosition;

        if (nextPosition.x !== node.position.x || nextPosition.y !== node.position.y) {
          correctedPositions[node.id] = nextPosition;
        }
      });

    nodes
      .filter((node) => node.kind !== 'group' && !node.groupId)
      .forEach((node) => {
        const nextPosition = pushDraggedLayoutsOutsideGroups(
          {
            [node.id]: nextPositions[node.id] ?? node.position,
          },
          [node.id],
          new Map([[node.id, null]]),
        )[node.id];

        if (!nextPosition) {
          return;
        }

        nextPositions[node.id] = nextPosition;

        if (nextPosition.x !== node.position.x || nextPosition.y !== node.position.y) {
          correctedPositions[node.id] = nextPosition;
        }
      });

    if (Object.keys(correctedPositions).length > 0) {
      onMoveNodesRef.current(correctedPositions);
    }
  }, [dragState, marqueeState, nodes, panState, resizeState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || editingNodeIdRef.current) {
        return;
      }

      draftSelectedNodeIdsRef.current = null;
      onSelectNodesRef.current([]);
      setDraftSelectedNodeIds(null);
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const getNodeById = useCallback((nodeId: string) => nodeMapRef.current.get(nodeId), []);

  const getLocalPoint = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) {
      return null;
    }

    const rect = canvasRef.current.getBoundingClientRect();

    return {
      x: clientX - rect.left - viewportRef.current.x,
      y: clientY - rect.top - viewportRef.current.y,
    };
  }, []);

  const getWorkerInputHandlePoint = useCallback((workerId: string) => {
    const workerNode = getNodeById(workerId);

    if (!workerNode || workerNode.kind !== 'worker') {
      return null;
    }

    const workerBounds = getNodeBoundsWithSize(
      draftPositionsRef.current[workerId] ?? workerNode.position,
      draftSizesRef.current[workerId] ?? workerNode.size,
      workerNode.kind,
    );

    return {
      x: workerBounds.left - 8,
      y: (workerBounds.top + workerBounds.bottom) / 2,
    };
  }, [getNodeById]);

  const getWorkerInputDropTarget = useCallback((workerId: string, point: Point) => {
    const workerNode = getNodeById(workerId);

    if (!workerNode || workerNode.kind !== 'worker') {
      return null;
    }

    const workerBounds = getNodeBoundsWithSize(
      draftPositionsRef.current[workerId] ?? workerNode.position,
      draftSizesRef.current[workerId] ?? workerNode.size,
      workerNode.kind,
    );
    const workerCenterX = (workerBounds.left + workerBounds.right) / 2;
    let nextTargetId: string | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    nodesRef.current.forEach((candidate) => {
      if (
        candidate.id === workerId ||
        (candidate.kind !== 'file' && candidate.kind !== 'folder') ||
        candidate.generatedByWorkerId
      ) {
        return;
      }

      const candidateBounds = getNodeBoundsWithSize(
        draftPositionsRef.current[candidate.id] ?? candidate.position,
        draftSizesRef.current[candidate.id] ?? candidate.size,
        candidate.kind,
      );

      if (!pointIsWithinBounds(point, candidateBounds)) {
        return;
      }

      const candidateCenterX = (candidateBounds.left + candidateBounds.right) / 2;

      if (candidateCenterX > workerCenterX + SLOT_STEP_X * 0.15) {
        return;
      }

      const candidateCenter = {
        x: (candidateBounds.left + candidateBounds.right) / 2,
        y: (candidateBounds.top + candidateBounds.bottom) / 2,
      };
      const distance = Math.hypot(candidateCenter.x - point.x, candidateCenter.y - point.y);

      if (distance < closestDistance) {
        closestDistance = distance;
        nextTargetId = candidate.id;
      }
    });

    return nextTargetId;
  }, [getNodeById]);

  const beginMarqueeSelection = useCallback((localPoint: Point, additive: boolean) => {
    const initialSelection = additive
      ? draftSelectedNodeIdsRef.current ?? selectedNodeIdsRef.current
      : [];
    const nextMarqueeState = {
      origin: localPoint,
      current: localPoint,
      additive,
      initialSelection,
    } satisfies MarqueeState;

    panStateRef.current = null;
    resizeStateRef.current = null;
    dragStateRef.current = null;
    workerConnectionDragStateRef.current = null;
    setPanState(null);
    setResizeState(null);
    setDragState(null);
    setWorkerConnectionDragState(null);
    marqueeStateRef.current = nextMarqueeState;
    setMarqueeState(nextMarqueeState);
    draftSelectedNodeIdsRef.current = initialSelection;
    setDraftSelectedNodeIds(initialSelection);
  }, []);

  const handleNodePointerDown = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    node: FilePageNode,
  ) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const localPoint = getLocalPoint(event.clientX, event.clientY);

    if (!localPoint) {
      return;
    }

    if (event.shiftKey) {
      beginMarqueeSelection(localPoint, true);
      return;
    }

    const currentSelection = draftSelectedNodeIdsRef.current ?? selectedNodeIdsRef.current;
    const currentSelectionSet = new Set(currentSelection);
    const nextSelectedIds =
      currentSelectionSet.has(node.id) && currentSelection.length > 1 ? currentSelection : [node.id];
    const nextDragNodeIds = expandDragNodeIds(nextSelectedIds);

    onSelectNodesRef.current([]);
    setDraftSelectedNodeIds([]);
    draftSelectedNodeIdsRef.current = [];
    const nextDragState = {
      nodeIds: nextDragNodeIds,
      selectedNodeIds: nextSelectedIds,
      origin: localPoint,
      basePositions: nextDragNodeIds.reduce<Record<string, Point>>((positions, nodeId) => {
        const selectedNode = getNodeById(nodeId);

        if (selectedNode) {
          positions[nodeId] = selectedNode.position;
        }

        return positions;
      }, {}),
    };
    nodeDragMovedRef.current = false;
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  }, [beginMarqueeSelection, getLocalPoint, getNodeById]);

  function handleCanvasContextMenu(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      (event.target as HTMLElement).closest('[data-canvas-node="true"]') ||
      (event.target as HTMLElement).closest('[data-canvas-chrome="true"]')
    ) {
      return;
    }

    const localPoint = getLocalPoint(event.clientX, event.clientY);

    contextMenuPointRef.current = localPoint;
  }

  function areSizesEqual(left: FilePageNode['size'], right: FilePageNode['size']) {
    return left.widthUnits === right.widthUnits && left.heightUnits === right.heightUnits;
  }

  function getMinimumNodeSize(node: FilePageNode): FilePageNode['size'] {
    return node.kind === 'group'
      ? {
          widthUnits: GROUP_MIN_GRID_UNITS,
          heightUnits: GROUP_MIN_GRID_UNITS,
        }
      : node.kind === 'worker'
        ? {
            widthUnits: 2,
            heightUnits: 2,
          }
      : {
          widthUnits: 1,
          heightUnits: 1,
      };
  }

  const getGroupBounds = useCallback((groupId: string, positions?: Record<string, Point>) => {
    const groupNode = getNodeById(groupId);

    if (!groupNode || groupNode.kind !== 'group') {
      return null;
    }

    return getGroupContentBounds(
      positions?.[groupNode.id] ?? draftPositionsRef.current[groupNode.id] ?? groupNode.position,
      draftSizesRef.current[groupNode.id] ?? groupNode.size,
    );
  }, [getNodeById]);

  const canNodesShareSpace = useCallback((
    leftNode: FilePageNode | undefined,
    rightNode: FilePageNode | undefined,
    candidateGroupIds?: Map<string, string | null>,
  ) => {
    const getEffectiveGroupId = (node: FilePageNode) => {
      if (!candidateGroupIds?.has(node.id)) {
        return node.groupId ?? null;
      }

      return candidateGroupIds.get(node.id) ?? null;
    };

    if (!leftNode || !rightNode || leftNode.id === rightNode.id) {
      return false;
    }

    if (leftNode.kind === 'group' && rightNode.kind !== 'group') {
      return getEffectiveGroupId(rightNode) === leftNode.id;
    }

    if (rightNode.kind === 'group' && leftNode.kind !== 'group') {
      return getEffectiveGroupId(leftNode) === rightNode.id;
    }

    return false;
  }, []);

  const getLayoutBounds = useCallback((
    positions: Record<string, Point>,
    nodeIds: string[],
  ) => {
    return nodeIds.reduce<ReturnType<typeof getNodeBoundsWithSize> | null>((current, nodeId) => {
      const node = getNodeById(nodeId);
      const position = positions[nodeId];

      if (!node || !position) {
        return current;
      }

      const nodeBounds = getNodeBoundsWithSize(
        position,
        draftSizesRef.current[nodeId] ?? node.size,
        node.kind,
      );

      if (!current) {
        return nodeBounds;
      }

      return {
        left: Math.min(current.left, nodeBounds.left),
        top: Math.min(current.top, nodeBounds.top),
        right: Math.max(current.right, nodeBounds.right),
        bottom: Math.max(current.bottom, nodeBounds.bottom),
      };
    }, null);
  }, [getNodeById]);

  const constrainNodeLayoutToBounds = useCallback((
    positions: Record<string, Point>,
    nodeIds: string[],
    bounds: ReturnType<typeof getGroupContentBounds>,
  ) => {
    const layoutBounds = getLayoutBounds(positions, nodeIds);

    if (!layoutBounds) {
      return positions;
    }

    const minimumShiftX = bounds.left - layoutBounds.left;
    const maximumShiftX = bounds.right - layoutBounds.right;
    const minimumShiftY = bounds.top - layoutBounds.top;
    const maximumShiftY = bounds.bottom - layoutBounds.bottom;
    const resolveShift = (minimumShift: number, maximumShift: number) => {
      if (minimumShift <= maximumShift) {
        return Math.min(Math.max(0, minimumShift), maximumShift);
      }

      return (minimumShift + maximumShift) / 2;
    };
    const shiftX = resolveShift(minimumShiftX, maximumShiftX);
    const shiftY = resolveShift(minimumShiftY, maximumShiftY);

    if (shiftX === 0 && shiftY === 0) {
      return positions;
    }

    return nodeIds.reduce<Record<string, Point>>((nextPositions, nodeId) => {
      const position = nextPositions[nodeId];

      if (!position) {
        return nextPositions;
      }

      nextPositions[nodeId] = {
        x: position.x + shiftX,
        y: position.y + shiftY,
      };

      return nextPositions;
    }, { ...positions });
  }, [getLayoutBounds]);

  const constrainDraggedLayoutsToTargetGroups = useCallback((
    positions: Record<string, Point>,
    nodeIds: string[],
    candidateGroupIds: Map<string, string | null>,
  ) => {
    const nodeIdsByGroup = nodeIds.reduce<Map<string, string[]>>((groups, nodeId) => {
      const groupId = candidateGroupIds.get(nodeId);

      if (typeof groupId !== 'string') {
        return groups;
      }

      const existingNodeIds = groups.get(groupId) ?? [];
      existingNodeIds.push(nodeId);
      groups.set(groupId, existingNodeIds);
      return groups;
    }, new Map());

    let nextPositions = { ...positions };
    const nextCandidateGroupIds = new Map(candidateGroupIds);

    nodeIdsByGroup.forEach((groupNodeIds, groupId) => {
      const groupBounds = getGroupBounds(groupId, nextPositions);

      if (!groupBounds) {
        return;
      }

      const layoutBounds = getLayoutBounds(nextPositions, groupNodeIds);

      if (!layoutBounds) {
        return;
      }

      const layoutWidth = layoutBounds.right - layoutBounds.left;
      const layoutHeight = layoutBounds.bottom - layoutBounds.top;
      const boundsWidth = groupBounds.right - groupBounds.left;
      const boundsHeight = groupBounds.bottom - groupBounds.top;

      if (layoutWidth > boundsWidth || layoutHeight > boundsHeight) {
        groupNodeIds.forEach((nodeId) => {
          nextCandidateGroupIds.set(nodeId, null);
        });
        return;
      }

      nextPositions = constrainNodeLayoutToBounds(nextPositions, groupNodeIds, groupBounds);
    });

    return {
      positions: nextPositions,
      candidateGroupIds: nextCandidateGroupIds,
    };
  }, [constrainNodeLayoutToBounds, getGroupBounds, getLayoutBounds]);

  const pushDraggedLayoutsOutsideGroups = useCallback((
    positions: Record<string, Point>,
    nodeIds: string[],
    candidateGroupIds: Map<string, string | null>,
  ) => {
    const getEffectiveGroupId = (nodeId: string) => {
      const node = getNodeById(nodeId);

      if (!node) {
        return null;
      }

      if (!candidateGroupIds.has(nodeId)) {
        return node.groupId ?? null;
      }

      return candidateGroupIds.get(nodeId) ?? null;
    };
    const outsideNodeIds = nodeIds.filter((nodeId) => {
      const node = getNodeById(nodeId);
      return node && node.kind !== 'group' && getEffectiveGroupId(nodeId) === null;
    });

    if (outsideNodeIds.length === 0) {
      return positions;
    }

    let nextPositions = { ...positions };
    const stationaryNodes = nodesRef.current.filter((node) => !nodeIds.includes(node.id));
    const applySharedShift = (
      sourcePositions: Record<string, Point>,
      shiftX: number,
      shiftY: number,
    ) => {
      const layoutBounds = getLayoutBounds(sourcePositions, outsideNodeIds);

      if (!layoutBounds) {
        return null;
      }

      if (layoutBounds.left + shiftX < -CANVAS_WORLD_LIMIT) {
        return null;
      }

      if (layoutBounds.top + shiftY < -CANVAS_WORLD_LIMIT) {
        return null;
      }

      if (layoutBounds.right + shiftX > CANVAS_WORLD_LIMIT) {
        return null;
      }

      if (layoutBounds.bottom + shiftY > CANVAS_WORLD_LIMIT) {
        return null;
      }

      return outsideNodeIds.reduce<Record<string, Point>>((accumulator, nodeId) => {
        const position = accumulator[nodeId];

        if (!position) {
          return accumulator;
        }

        accumulator[nodeId] = {
          x: position.x + shiftX,
          y: position.y + shiftY,
        };

        return accumulator;
      }, { ...sourcePositions });
    };

    groupNodes.forEach((groupNode) => {
      const layoutBounds = getLayoutBounds(nextPositions, outsideNodeIds);

      if (!layoutBounds) {
        return;
      }

      const groupBounds = getNodeBoundsWithSize(
        nextPositions[groupNode.id] ?? groupNode.position,
        draftSizesRef.current[groupNode.id] ?? groupNode.size,
        groupNode.kind,
      );

      if (
        layoutBounds.right <= groupBounds.left ||
        layoutBounds.left >= groupBounds.right ||
        layoutBounds.bottom <= groupBounds.top ||
        layoutBounds.top >= groupBounds.bottom
      ) {
        return;
      }

      const candidateShifts = [
        { x: groupBounds.left - layoutBounds.right, y: 0 },
        { x: groupBounds.right - layoutBounds.left, y: 0 },
        { x: 0, y: groupBounds.top - layoutBounds.bottom },
        { x: 0, y: groupBounds.bottom - layoutBounds.top },
      ].sort((left, right) => Math.hypot(left.x, left.y) - Math.hypot(right.x, right.y));
      let resolvedPositions: Record<string, Point> | null = null;

      for (const chosenShift of candidateShifts) {
        let candidatePositions = applySharedShift(nextPositions, chosenShift.x, chosenShift.y);

        if (!candidatePositions) {
          continue;
        }

        const axis = Math.abs(chosenShift.x) > Math.abs(chosenShift.y) ? 'x' : 'y';
        const direction =
          axis === 'x' ? Math.sign(chosenShift.x || 1) : Math.sign(chosenShift.y || 1);
        let candidateValid = true;

        for (let iteration = 0; iteration < 12; iteration += 1) {
          let extraShift = 0;
          const currentCandidatePositions = candidatePositions;

          outsideNodeIds.forEach((nodeId) => {
            const movingNode = getNodeById(nodeId);
            const movingPosition = currentCandidatePositions[nodeId];

            if (!movingNode || !movingPosition) {
              return;
            }

            const movingBounds = getNodeBoundsWithSize(
              movingPosition,
              draftSizesRef.current[nodeId] ?? movingNode.size,
              movingNode.kind,
            );

            stationaryNodes.forEach((stationaryNode) => {
              if (canNodesShareSpace(movingNode, stationaryNode, candidateGroupIds)) {
                return;
              }

              const stationaryBounds = getNodeBoundsWithSize(
                currentCandidatePositions[stationaryNode.id] ?? stationaryNode.position,
                draftSizesRef.current[stationaryNode.id] ?? stationaryNode.size,
                stationaryNode.kind,
              );

              if (!boundsOverlap(movingBounds, stationaryBounds)) {
                return;
              }

              if (axis === 'x') {
                if (direction < 0) {
                  extraShift = Math.max(extraShift, movingBounds.right - stationaryBounds.left + 1);
                } else {
                  extraShift = Math.max(extraShift, stationaryBounds.right - movingBounds.left + 1);
                }
              } else if (direction < 0) {
                extraShift = Math.max(extraShift, movingBounds.bottom - stationaryBounds.top + 1);
              } else {
                extraShift = Math.max(extraShift, stationaryBounds.bottom - movingBounds.top + 1);
              }
            });
          });

          if (extraShift <= 0) {
            resolvedPositions = candidatePositions;
            break;
          }

          candidatePositions = applySharedShift(
            candidatePositions,
            axis === 'x' ? direction * extraShift : 0,
            axis === 'y' ? direction * extraShift : 0,
          );

          if (!candidatePositions) {
            candidateValid = false;
            break;
          }
        }

        if (resolvedPositions) {
          break;
        }

        if (!candidateValid) {
          continue;
        }
      }

      if (resolvedPositions) {
        nextPositions = resolvedPositions;
      }
    });

    return nextPositions;
  }, [canNodesShareSpace, getLayoutBounds, getNodeById, groupNodes]);

  const getLockedConnectedGroupId = useCallback((
    node: FilePageNode,
    candidateGroupIds?: Map<string, string | null>,
    visited = new Set<string>(),
  ): string | null | undefined => {
    if (!node.parentNodeId || visited.has(node.id)) {
      return undefined;
    }

    const parentNode = getNodeById(node.parentNodeId);

    if (!parentNode) {
      return null;
    }

    if (candidateGroupIds?.has(parentNode.id)) {
      return candidateGroupIds.get(parentNode.id) ?? null;
    }

    if (parentNode.groupId) {
      return parentNode.groupId;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(node.id);

    return getLockedConnectedGroupId(parentNode, candidateGroupIds, nextVisited) ?? null;
  }, [getNodeById]);

  const expandDragNodeIds = useCallback((selectedIds: string[]) => {
    const seen = new Set(selectedIds);
    const queue = [...selectedIds];

    while (queue.length > 0) {
      const nodeId = queue.shift();

      if (!nodeId) {
        continue;
      }

      const childIds = nodesRef.current
        .filter((node) => node.groupId === nodeId || node.parentNodeId === nodeId)
        .map((node) => node.id);

      childIds.forEach((childId) => {
        if (seen.has(childId)) {
          return;
        }

        seen.add(childId);
        queue.push(childId);
      });
    }

    return [...seen];
  }, []);

  const findContainingGroupId = useCallback((
    node: FilePageNode,
    position: Point,
    size: FilePageNode['size'],
    positions: Record<string, Point>,
  ) => {
    if (node.kind === 'group') {
      return null;
    }

    const nodeBounds = getNodeBoundsWithSize(position, size, node.kind);
    const nodeCenter = {
      x: (nodeBounds.left + nodeBounds.right) / 2,
      y: (nodeBounds.top + nodeBounds.bottom) / 2,
    };
    const containingGroups = nodesRef.current
      .filter((candidate) => candidate.kind === 'group' && candidate.id !== node.id)
      .filter((candidate) => {
        const groupBounds = getGroupBounds(candidate.id, positions);

        if (!groupBounds) {
          return false;
        }

        const expandedGroupBounds = {
          left: groupBounds.left - GROUP_SNAP_TOLERANCE,
          top: groupBounds.top - GROUP_SNAP_TOLERANCE,
          right: groupBounds.right + GROUP_SNAP_TOLERANCE,
          bottom: groupBounds.bottom + GROUP_SNAP_TOLERANCE,
        };

        const fullyContained =
          nodeBounds.left >= groupBounds.left &&
          nodeBounds.top >= groupBounds.top &&
          nodeBounds.right <= groupBounds.right &&
          nodeBounds.bottom <= groupBounds.bottom;
        const centerInside =
          nodeCenter.x >= expandedGroupBounds.left &&
          nodeCenter.x <= expandedGroupBounds.right &&
          nodeCenter.y >= expandedGroupBounds.top &&
          nodeCenter.y <= expandedGroupBounds.bottom;

        return fullyContained || centerInside;
      })
      .sort((left, right) => {
        const leftBounds = getNodeBoundsWithSize(
          positions[left.id] ?? left.position,
          draftSizesRef.current[left.id] ?? left.size,
          left.kind,
        );
        const rightBounds = getNodeBoundsWithSize(
          positions[right.id] ?? right.position,
          draftSizesRef.current[right.id] ?? right.size,
          right.kind,
        );
        const leftArea = (leftBounds.right - leftBounds.left) * (leftBounds.bottom - leftBounds.top);
        const rightArea =
          (rightBounds.right - rightBounds.left) * (rightBounds.bottom - rightBounds.top);

        return leftArea - rightArea;
      });

    return containingGroups[0]?.id ?? null;
  }, [getGroupBounds]);

  const getNearbyOuterGridOrigin = useCallback((
    anchorNodeId: string,
    desiredPositions: Record<string, Point>,
    dragNodeIds: string[],
  ): OuterSnapTarget | null => {
    const anchorNode = getNodeById(anchorNodeId);

    if (!anchorNode) {
      return null;
    }

    const anchorPosition = desiredPositions[anchorNodeId] ?? anchorNode.position;
    const anchorSize = draftSizesRef.current[anchorNodeId] ?? anchorNode.size;
    const anchorBounds = getNodeBoundsWithSize(anchorPosition, anchorSize, anchorNode.kind);
    const activationPaddingX = SLOT_STEP_X * 0.18;
    const activationPaddingY = SLOT_STEP_Y * 0.18;
    let closestTarget: OuterSnapTarget | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    nodesRef.current.forEach((candidate) => {
      if (
        candidate.id === anchorNodeId ||
        dragNodeIds.includes(candidate.id) ||
        candidate.groupId
      ) {
        return;
      }

      const origin =
        desiredPositions[candidate.id] ??
        draftPositionsRef.current[candidate.id] ??
        candidate.position;
      const candidateSize = draftSizesRef.current[candidate.id] ?? candidate.size;
      const candidateBounds = getNodeBoundsWithSize(origin, candidateSize, candidate.kind);
      const expandedBounds = {
        left: candidateBounds.left - activationPaddingX,
        top: candidateBounds.top - activationPaddingY,
        right: candidateBounds.right + activationPaddingX,
        bottom: candidateBounds.bottom + activationPaddingY,
      };
      const distanceX = Math.max(
        0,
        expandedBounds.left - anchorBounds.right,
        anchorBounds.left - expandedBounds.right,
      );
      const distanceY = Math.max(
        0,
        expandedBounds.top - anchorBounds.bottom,
        anchorBounds.top - expandedBounds.bottom,
      );
      const distance = Math.hypot(distanceX, distanceY);

      if (distance <= OUTER_WIDGET_SNAP_THRESHOLD && distance < closestDistance) {
        closestTarget = {
          nodeId: candidate.id,
          origin:
            candidate.kind === 'group'
              ? {
                  x: origin.x - GROUP_CONTENT_INSET_LEFT,
                  y: origin.y - GROUP_CONTENT_INSET_TOP,
                }
              : origin,
        };
        closestDistance = distance;
      }
    });

    return closestTarget;
  }, [getNodeById]);

  const getSharedOuterSnapOrigin = useCallback((
    dragNodeIds: string[],
    desiredPositions: Record<string, Point>,
    basePositions: Record<string, Point>,
    candidateGroupIds: Map<string, string | null>,
  ): SharedOuterSnapTarget | null => {
    if (dragNodeIds.length === 0) {
      return null;
    }

    const dragNodeIdSet = new Set(dragNodeIds);

    const canUseOuterWidgetSnap = dragNodeIds.every((nodeId) => {
      const node = getNodeById(nodeId);
      const candidateGroupId = candidateGroupIds.get(nodeId) ?? null;

      return Boolean(
        node &&
          (!candidateGroupId || dragNodeIdSet.has(candidateGroupId)),
      );
    });

    if (!canUseOuterWidgetSnap) {
      return null;
    }

    const getSnapSpacePosition = (node: FilePageNode, position: Point) =>
      node.kind === 'group'
        ? {
            x: position.x - GROUP_CONTENT_INSET_LEFT,
            y: position.y - GROUP_CONTENT_INSET_TOP,
          }
        : position;

    const getSnapSpaceBounds = (node: FilePageNode, position: Point) => {
      const snapPosition = getSnapSpacePosition(node, position);
      const size = draftSizesRef.current[node.id] ?? node.size;
      const dimensions = getNodeDimensionsForKind(size, node.kind);

      return {
        left: snapPosition.x,
        top: snapPosition.y,
        right: snapPosition.x + dimensions.width,
        bottom: snapPosition.y + dimensions.height,
      };
    };

    const baseAnchorId = dragNodeIds[0];
    const baseAnchorNode = getNodeById(baseAnchorId);
    const baseAnchorPosition =
      basePositions[baseAnchorId] ??
      desiredPositions[baseAnchorId] ??
      baseAnchorNode?.position;

    if (!baseAnchorNode || !baseAnchorPosition) {
      return null;
    }

    const baseAnchorSnapPosition = getSnapSpacePosition(baseAnchorNode, baseAnchorPosition);

    for (const triggerNodeId of dragNodeIds) {
      const nearbyTarget =
        getNearbyOuterGridOrigin(triggerNodeId, desiredPositions, dragNodeIds);

      if (!nearbyTarget) {
        continue;
      }

      const triggerNode = getNodeById(triggerNodeId);
      const triggerBasePosition =
        basePositions[triggerNodeId] ??
        desiredPositions[triggerNodeId] ??
        triggerNode?.position;

      if (!triggerNode || !triggerBasePosition) {
        continue;
      }

      const resolvedOrigin = nearbyTarget.origin;
      const targetNode = getNodeById(nearbyTarget.nodeId);
      const triggerBaseSnapPosition = getSnapSpacePosition(triggerNode, triggerBasePosition);
      const targetPosition =
        desiredPositions[nearbyTarget.nodeId] ??
        draftPositionsRef.current[nearbyTarget.nodeId] ??
        targetNode?.position;

      if (!targetNode || !targetPosition) {
        return {
          gridOrigin: {
            x: resolvedOrigin.x - (triggerBaseSnapPosition.x - baseAnchorSnapPosition.x),
            y: resolvedOrigin.y - (triggerBaseSnapPosition.y - baseAnchorSnapPosition.y),
          },
        };
      }

      const targetBounds = getSnapSpaceBounds(targetNode, targetPosition);
      const targetSnapPosition = getSnapSpacePosition(targetNode, targetPosition);
      const targetSize = draftSizesRef.current[nearbyTarget.nodeId] ?? targetNode.size;
      const triggerSize = draftSizesRef.current[triggerNodeId] ?? triggerNode.size;
      const offsetX = triggerBaseSnapPosition.x - baseAnchorSnapPosition.x;
      const offsetY = triggerBaseSnapPosition.y - baseAnchorSnapPosition.y;
      const needsEdgeCandidates =
        triggerNode.kind === 'group' || targetNode.kind === 'group';
      const outsideTopY =
        targetSnapPosition.y - triggerSize.heightUnits * SLOT_STEP_Y - offsetY;
      const outsideBottomY =
        targetSnapPosition.y + targetSize.heightUnits * SLOT_STEP_Y - offsetY;
      const outsideLeftX =
        targetSnapPosition.x - triggerSize.widthUnits * SLOT_STEP_X - offsetX;
      const outsideRightX =
        targetSnapPosition.x + targetSize.widthUnits * SLOT_STEP_X - offsetX;
      const buildSlotCandidates = (startOffset: number, endOffset: number, step: number) =>
        Array.from({ length: endOffset - startOffset + 1 }, (_, index) =>
          (startOffset + index) * step,
        );
      const horizontalAnchorCandidates = buildSlotCandidates(
        -(triggerSize.widthUnits - 1),
        targetSize.widthUnits - 1,
        SLOT_STEP_X,
      ).map((offset) => targetSnapPosition.x + offset - offsetX);
      const verticalAnchorCandidates = buildSlotCandidates(
        -(triggerSize.heightUnits - 1),
        targetSize.heightUnits - 1,
        SLOT_STEP_Y,
      ).map((offset) => targetSnapPosition.y + offset - offsetY);

      return {
        gridOrigin: {
          x: resolvedOrigin.x - offsetX,
          y: resolvedOrigin.y - offsetY,
        },
        preferredAnchorCandidates: needsEdgeCandidates
          ? [
              ...horizontalAnchorCandidates.map((x) => ({
                x,
                y: outsideTopY,
              })),
              ...horizontalAnchorCandidates.map((x) => ({
                x,
                y: outsideBottomY,
              })),
              ...verticalAnchorCandidates.map((y) => ({
                x: outsideLeftX,
                y,
              })),
              ...verticalAnchorCandidates.map((y) => ({
                x: outsideRightX,
                y,
              })),
              { x: outsideLeftX, y: outsideTopY },
              { x: outsideRightX, y: outsideTopY },
              { x: outsideLeftX, y: outsideBottomY },
              { x: outsideRightX, y: outsideBottomY },
            ]
          : undefined,
      };
    }

    return null;
  }, [getNearbyOuterGridOrigin, getNodeById]);

  const getNearbyGroupGridOrigin = useCallback((
    anchorNodeId: string,
    desiredPositions: Record<string, Point>,
    dragNodeIds: string[],
    groupId: string,
  ) => {
    const anchorNode = getNodeById(anchorNodeId);

    if (!anchorNode || anchorNode.kind === 'group') {
      return null;
    }

    const anchorPosition = desiredPositions[anchorNodeId] ?? anchorNode.position;
    const anchorSize = draftSizesRef.current[anchorNodeId] ?? anchorNode.size;
    const anchorBounds = getNodeBoundsWithSize(anchorPosition, anchorSize, anchorNode.kind);
    const activationPaddingX = SLOT_STEP_X * 0.18;
    const activationPaddingY = SLOT_STEP_Y * 0.18;
    let closestOrigin: Point | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    nodesRef.current.forEach((candidate) => {
      if (
        candidate.id === anchorNodeId ||
        dragNodeIds.includes(candidate.id) ||
        candidate.kind === 'group' ||
        candidate.groupId !== groupId
      ) {
        return;
      }

      const origin =
        desiredPositions[candidate.id] ??
        draftPositionsRef.current[candidate.id] ??
        candidate.position;
      const candidateSize = draftSizesRef.current[candidate.id] ?? candidate.size;
      const candidateBounds = getNodeBoundsWithSize(origin, candidateSize, candidate.kind);
      const expandedBounds = {
        left: candidateBounds.left - activationPaddingX,
        top: candidateBounds.top - activationPaddingY,
        right: candidateBounds.right + activationPaddingX,
        bottom: candidateBounds.bottom + activationPaddingY,
      };
      const distanceX = Math.max(
        0,
        expandedBounds.left - anchorBounds.right,
        anchorBounds.left - expandedBounds.right,
      );
      const distanceY = Math.max(
        0,
        expandedBounds.top - anchorBounds.bottom,
        anchorBounds.top - expandedBounds.bottom,
      );
      const distance = Math.hypot(distanceX, distanceY);

      if (distance <= OUTER_WIDGET_SNAP_THRESHOLD && distance < closestDistance) {
        closestOrigin = origin;
        closestDistance = distance;
      }
    });

    return closestOrigin;
  }, [getNodeById]);

  const getSharedGroupSnapOrigin = useCallback((
    dragNodeIds: string[],
    desiredPositions: Record<string, Point>,
    basePositions: Record<string, Point>,
    candidateGroupIds: Map<string, string | null>,
    groupId: string,
  ) => {
    if (dragNodeIds.length === 0) {
      return null;
    }

    const canUseGroupWidgetSnap = dragNodeIds.every((nodeId) => {
      const node = getNodeById(nodeId);

      return Boolean(
        node &&
          node.kind !== 'group' &&
          candidateGroupIds.get(nodeId) === groupId,
      );
    });

    if (!canUseGroupWidgetSnap) {
      return null;
    }

    const baseAnchorId = dragNodeIds[0];
    const baseAnchorPosition =
      basePositions[baseAnchorId] ??
      desiredPositions[baseAnchorId] ??
      getNodeById(baseAnchorId)?.position;

    if (!baseAnchorPosition) {
      return null;
    }

    for (const triggerNodeId of dragNodeIds) {
      const nearbyOrigin: Point | null = getNearbyGroupGridOrigin(
        triggerNodeId,
        desiredPositions,
        dragNodeIds,
        groupId,
      );

      if (!nearbyOrigin) {
        continue;
      }

      const triggerBasePosition =
        basePositions[triggerNodeId] ??
        desiredPositions[triggerNodeId] ??
        getNodeById(triggerNodeId)?.position;

      if (!triggerBasePosition) {
        continue;
      }

      const resolvedOrigin = nearbyOrigin as Point;

      return {
        x: resolvedOrigin.x - (triggerBasePosition.x - baseAnchorPosition.x),
        y: resolvedOrigin.y - (triggerBasePosition.y - baseAnchorPosition.y),
      };
    }

    return null;
  }, [getNearbyGroupGridOrigin, getNodeById]);

  const getWorkerInputNodes = useCallback((workerId: string) =>
    nodesRef.current.filter(
      (node) =>
        node.parentNodeId === workerId &&
        (node.kind === 'file' || node.kind === 'folder') &&
        node.generatedByWorkerId !== workerId,
    ), []);

  const resolveSourceFileItem = useCallback((node: FilePageNode): FilePageContentItem | null => {
    if (node.kind !== 'file') {
      return null;
    }

    return resolveCanvasFileItem?.(node) ?? createFallbackFileItem(node);
  }, [resolveCanvasFileItem]);

  const collectFolderSourceFiles = useCallback((
    folderId: string,
    visited = new Set<string>(),
  ): FilePageContentItem[] => {
    if (visited.has(folderId)) {
      return [];
    }

    const folderNode = getNodeById(folderId);

    if (!folderNode || folderNode.kind !== 'folder') {
      return [];
    }

    const nextVisited = new Set(visited);
    nextVisited.add(folderId);
    const resolvedFolderFiles = resolveCanvasFolderSourceFiles?.(folderNode) ?? [];
    const directChildFiles = nodesRef.current.flatMap((node) => {
      if (node.parentNodeId !== folderId) {
        return [];
      }

      if (node.kind === 'file') {
        const sourceItem = resolveSourceFileItem(node);
        return sourceItem ? [sourceItem] : [];
      }

      if (node.kind === 'folder') {
        return collectFolderSourceFiles(node.id, nextVisited);
      }

      return [];
    });
    const generatedFiles = (folderNode.contentItems ?? []).filter((item) => item.kind === 'file');
    const dedupedById = new Map<string, FilePageContentItem>();

    [...resolvedFolderFiles, ...directChildFiles, ...generatedFiles].forEach((item) => {
      dedupedById.set(getContentItemDedupKey(item), item);
    });

    return sortCanvasContentItems([...dedupedById.values()]);
  }, [getNodeById, resolveCanvasFolderSourceFiles, resolveSourceFileItem]);

  const collectWorkerSourceFiles = useCallback((workerId: string) => {
    const sourceFiles = getWorkerInputNodes(workerId).flatMap((node) =>
      node.kind === 'file'
        ? (() => {
            const sourceItem = resolveSourceFileItem(node);
            return sourceItem ? [sourceItem] : [];
          })()
        : collectFolderSourceFiles(node.id),
    );
    const dedupedByKey = new Map<string, FilePageContentItem>();

    sourceFiles.forEach((item) => {
      dedupedByKey.set(getContentItemDedupKey(item), item);
    });

    return sortCanvasContentItems([...dedupedByKey.values()]);
  }, [collectFolderSourceFiles, getWorkerInputNodes, resolveSourceFileItem]);

  function clampFloatingInspectorRect(
    rect: CanvasFloatingInspectorRect,
    targetType: CanvasFloatingInspectorTarget['type'] = 'folder',
    minimized = false,
  ) {
    const canvasRect = canvasRef.current?.getBoundingClientRect();

    if (!canvasRect) {
      return rect;
    }

    const width = Math.max(
      FLOATING_INSPECTOR_MIN_WIDTH,
      Math.min(rect.width, canvasRect.width - 24),
    );
    const minimumHeight =
      targetType === 'file' ? FLOATING_INSPECTOR_MIN_FILE_HEIGHT : FLOATING_INSPECTOR_MIN_HEIGHT;
    const height = minimized
      ? FLOATING_INSPECTOR_HEADER_HEIGHT
      : Math.max(
          minimumHeight,
          Math.min(rect.height, canvasRect.height - 24),
        );
    const maxX = Math.max(12, canvasRect.width - width - 12);
    const maxY = Math.max(12, canvasRect.height - height - 12);

    return {
      x: Math.min(Math.max(rect.x, 12), maxX),
      y: Math.min(Math.max(rect.y, 12), maxY),
      width,
      height,
    };
  }

  function estimateFloatingInspectorHeight(target: CanvasFloatingInspectorTarget) {
    const descriptionHeight = target.description.trim().length > 0 ? 54 : 0;

    if (target.type === 'folder') {
      const folderBodyHeight =
        target.items.length === 0
          ? 132
          : 28 + Math.min(6, Math.max(2, target.items.length)) * 72;

      return FLOATING_INSPECTOR_HEADER_HEIGHT + descriptionHeight + folderBodyHeight;
    }

    const wrappedLineEstimate = target.textContent
      .split(/\r?\n/g)
      .slice(0, 12)
      .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 78)), 0);
    const visibleLineCount = Math.min(6, Math.max(3, wrappedLineEstimate || 1));
    const fileBodyHeight = 32 + visibleLineCount * 24;

    return FLOATING_INSPECTOR_HEADER_HEIGHT + descriptionHeight + fileBodyHeight;
  }

  function getDefaultFloatingInspectorRectForTarget(target: CanvasFloatingInspectorTarget) {
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const defaultRect = {
      x: 72,
      y: 88,
      width: 620,
      height: estimateFloatingInspectorHeight(target),
    };

    if (!canvasRect) {
      return defaultRect;
    }

    return clampFloatingInspectorRect(
      {
        x: Math.max(24, Math.round((canvasRect.width - defaultRect.width) / 2)),
        y: Math.max(32, Math.round((canvasRect.height - defaultRect.height) / 4)),
        width: Math.min(defaultRect.width, canvasRect.width - 24),
        height: Math.min(defaultRect.height, canvasRect.height - 24),
      },
      target.type,
    );
  }

  function getFloatingInspectorRectForTarget(
    target: CanvasFloatingInspectorTarget,
    baseRect?: CanvasFloatingInspectorRect | null,
  ) {
    if (!baseRect) {
      return getDefaultFloatingInspectorRectForTarget(target);
    }

    return clampFloatingInspectorRect(
      {
        ...baseRect,
        height: estimateFloatingInspectorHeight(target),
      },
      target.type,
    );
  }

  const resolveNodeFolderContents = useCallback((node: FilePageNode) => {
    const derivedFolderContents = folderContentsById[node.id];
    const sourceFolderContents = getFolderContents?.(node);

    return node.kind === 'worker'
      ? workerInputContentsById[node.id] ?? []
      : sourceFolderContents && sourceFolderContents.length > 0
        ? sourceFolderContents
        : derivedFolderContents && derivedFolderContents.length > 0
          ? derivedFolderContents
          : node.contentItems ?? [];
  }, [folderContentsById, getFolderContents, workerInputContentsById]);

  const buildFloatingInspectorTargetFromNode = useCallback((
    node: FilePageNode,
  ): { target: CanvasFloatingInspectorTarget; fileId: string | null } | null => {
    if (node.kind === 'file') {
      const sourceItem = resolveSourceFileItem(node);

      if (!sourceItem) {
        return null;
      }

      const fileId = resolveCanvasFileId?.(node) ?? null;

      return {
        fileId,
        target: {
          type: 'file',
          label: node.label,
          description: sourceItem.description ?? node.description,
          textContent: sourceItem.textContent ?? '',
          editable: fileId !== null && typeof onUpdateWorkspaceFileContent === 'function',
          mimeType: sourceItem.mimeType ?? null,
          sizeBytes: sourceItem.sizeBytes ?? null,
        },
      };
    }

    if (node.kind === 'folder') {
      return {
        fileId: null,
        target: {
          type: 'folder',
          label: node.label,
          description: node.description,
          items: resolveNodeFolderContents(node),
        },
      };
    }

    return null;
  }, [
    onUpdateWorkspaceFileContent,
    resolveCanvasFileId,
    resolveNodeFolderContents,
    resolveSourceFileItem,
  ]);

  const buildFloatingInspectorTargetFromItem = useCallback((
    item: FilePageContentItem,
  ): { target: CanvasFloatingInspectorTarget; fileId: string | null } | null => {
    if (item.kind !== 'file') {
      return null;
    }

    const fileId = item.id.startsWith('file:') ? item.id.slice('file:'.length) : null;

    return {
      fileId,
      target: {
        type: 'file',
        label: item.label,
        description: item.description ?? '',
        textContent: item.textContent ?? '',
        editable: fileId !== null && typeof onUpdateWorkspaceFileContent === 'function',
        mimeType: item.mimeType ?? null,
        sizeBytes: item.sizeBytes ?? null,
      },
    };
  }, [onUpdateWorkspaceFileContent]);

  const openFloatingInspector = useCallback((
    nextTarget: CanvasFloatingInspectorTarget,
    fileId: string | null = null,
  ) => {
    setFloatingInspector((current) => {
      const baseRect = current
        ? current.window.maximized
          ? current.window.restoreRect ?? current.window.rect
          : current.window.rect
        : null;
      const nextRect = getFloatingInspectorRectForTarget(nextTarget, baseRect);

      return {
        fileId,
        target: nextTarget,
        phase: current ? 'open' : 'opening',
        window: {
          rect: nextRect,
          minimized: false,
          maximized: false,
          restoreRect: current?.window.restoreRect ?? null,
        },
      };
    });
  }, []);

  const openFloatingInspectorForNode = useCallback((node: FilePageNode) => {
    if (Date.now() < suppressPreviewOpenUntilRef.current) {
      return;
    }

    const previewTarget = buildFloatingInspectorTargetFromNode(node);

    if (!previewTarget) {
      return;
    }

    openFloatingInspector(previewTarget.target, previewTarget.fileId);
  }, [buildFloatingInspectorTargetFromNode, openFloatingInspector]);

  const openFloatingInspectorForItem = useCallback((item: FilePageContentItem) => {
    if (Date.now() < suppressPreviewOpenUntilRef.current) {
      return;
    }

    const nodeMatch = getNodeById(item.id);

    if (nodeMatch && (nodeMatch.kind === 'file' || nodeMatch.kind === 'folder')) {
      openFloatingInspectorForNode(nodeMatch);
      return;
    }

    const previewTarget = buildFloatingInspectorTargetFromItem(item);

    if (!previewTarget) {
      return;
    }

    openFloatingInspector(previewTarget.target, previewTarget.fileId);
  }, [
    buildFloatingInspectorTargetFromItem,
    getNodeById,
    openFloatingInspector,
    openFloatingInspectorForNode,
  ]);

  const buildWorkerSourceSignature = useCallback((
    worker: FilePageNode,
    item: FilePageContentItem,
  ) =>
    JSON.stringify({
      workerMode: resolveWorkerMode(worker.workerMode),
      workerFocus: worker.workerFocus ?? DEFAULT_FILE_PAGE_WORKER_FOCUS,
      workerRunMode: worker.workerRunMode ?? DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
      workerOutputMode: worker.workerOutputMode ?? DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
      workerLabel: worker.label,
      sourceItemId: item.id,
      sourceLabel: item.label,
      mimeType: item.mimeType ?? '',
      textHash: createContentHash(item.textContent),
    }), []);

  const buildSortWorkerOutputItems = useCallback((workerId: string) => {
    const worker = getNodeById(workerId);

    if (!worker || worker.kind !== 'worker') {
      return [];
    }

    const orderedEntries = collectWorkerSourceFiles(workerId)
      .map((item) => [item.label.trim().toLowerCase(), item] as const)
      .sort(([, left], [, right]) =>
        left.label.localeCompare(right.label, undefined, {
          sensitivity: 'base',
        }),
      );

    return sortCanvasContentItems(
      orderedEntries.map(([key, item], index, items) => ({
        id: `${workerId}:${key}`,
        kind: 'file',
        label: getWorkerOutputItemLabel(worker.workerMode, item.label, index, items.length),
        description: item.description ?? `Sorted copy of ${item.label}.`,
        textContent: item.textContent ?? null,
        mimeType: item.mimeType ?? 'text/plain',
        sizeBytes: item.sizeBytes ?? item.textContent?.length ?? null,
      })),
    );
  }, [collectWorkerSourceFiles, getNodeById]);

  const buildWorkerInputSignature = useCallback((workerId: string) => {
    const worker = getNodeById(workerId);
    const workerMode = resolveWorkerMode(worker?.workerMode ?? null);
    const inputs = getWorkerInputNodes(workerId);
    const files = collectWorkerSourceFiles(workerId);

    return JSON.stringify({
      workerMode,
      workerFocus: worker?.workerFocus ?? DEFAULT_FILE_PAGE_WORKER_FOCUS,
      workerRunMode: worker?.workerRunMode ?? DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
      workerOutputMode: worker?.workerOutputMode ?? DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
      workerLabel: worker?.label ?? '',
      inputs: inputs
        .map((node) => `${node.id}:${node.label}:${node.kind}`)
        .sort((left, right) => left.localeCompare(right)),
      files: files
        .map((item) => (worker ? buildWorkerSourceSignature(worker, item) : item.id))
        .sort((left, right) => left.localeCompare(right)),
    });
  }, [buildWorkerSourceSignature, collectWorkerSourceFiles, getNodeById, getWorkerInputNodes]);

  const clearWorkerProcessTimer = useCallback((workerId: string) => {
    const timerId = workerProcessTimersRef.current[workerId];

    if (typeof timerId === 'number') {
      window.clearInterval(timerId);
      delete workerProcessTimersRef.current[workerId];
    }
  }, []);

  const clearWorkerRequestTimeout = useCallback((workerId: string) => {
    const timeoutId = workerRequestTimeoutsRef.current[workerId];

    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
      delete workerRequestTimeoutsRef.current[workerId];
    }
  }, []);

  const cancelWorkerRequest = useCallback((workerId: string) => {
    const controller = workerRequestControllersRef.current[workerId];

    if (controller) {
      controller.abort();
      delete workerRequestControllersRef.current[workerId];
    }

    clearWorkerRequestTimeout(workerId);
    delete workerRequestSignaturesRef.current[workerId];
  }, [clearWorkerRequestTimeout]);

  const getExistingWorkerOutputFolder = useCallback((worker: FilePageNode) =>
    (worker.workerOutputFolderId ? getNodeById(worker.workerOutputFolderId) : null) ??
    nodesRef.current.find(
      (node) => node.kind === 'folder' && node.generatedByWorkerId === worker.id,
    ) ??
    null, [getNodeById]);

  const removeWorkerOutputFolder = useCallback((worker: FilePageNode) => {
    const outputFolderId = getExistingWorkerOutputFolder(worker)?.id;

    if (outputFolderId) {
      onDeleteNodeRef.current(outputFolderId);
    }
  }, [getExistingWorkerOutputFolder]);

  const commitWorkerOutput = useCallback((
    workerId: string,
    inputSignature: string,
    outputItems: FilePageContentItem[],
  ) => {
    clearWorkerProcessTimer(workerId);
    const worker = getNodeById(workerId);

    if (!worker || worker.kind !== 'worker') {
      return;
    }

    const workerMeta = getWorkerModeMeta(worker.workerMode);
    const existingOutputFolder = getExistingWorkerOutputFolder(worker);

    if (outputItems.length === 0) {
      if (existingOutputFolder) {
        onDeleteNodeRef.current(existingOutputFolder.id);
      }

      onUpdateNodeRef.current(workerId, {
        workerStatus: 'complete',
        workerProgress: 100,
        workerInputSignature: inputSignature,
        workerOutputFolderId: null,
        workerLastError: null,
      });
      return;
    }

    if (!existingOutputFolder) {
      const workerPosition = draftPositionsRef.current[workerId] ?? worker.position;
      const workerSize = draftSizesRef.current[workerId] ?? worker.size;
      const workerDimensions = getNodeDimensionsForKind(workerSize, worker.kind);
      const nextFolderId = `worker-output-${workerId}`;
      const nextFolderSize = {
        widthUnits: 3,
        heightUnits: 2,
      } satisfies FilePageNode['size'];
      const desiredPosition = {
        x: workerPosition.x + workerDimensions.width + SLOT_STEP_X,
        y: workerPosition.y,
      };
      const parentGroupBounds = worker.groupId ? getGroupBounds(worker.groupId) : null;
      const constrainedDesiredPosition = parentGroupBounds
        ? clampNodePositionToBounds(desiredPosition, nextFolderSize, parentGroupBounds)
        : {
            x: clampToCanvas(desiredPosition.x),
            y: clampToCanvas(desiredPosition.y),
          };
      const resolvedPosition =
        resolveSnapPositions(
          {
            [nextFolderId]: constrainedDesiredPosition,
          },
          [nextFolderId],
          nodesRef.current,
          {
            [nextFolderId]: constrainedDesiredPosition,
          },
          {
            [nextFolderId]: nextFolderSize,
          },
          undefined,
          {
            getNodeKind: (nodeId) => (nodeId === nextFolderId ? 'folder' : getNodeById(nodeId)?.kind),
            constrainPosition: (position) =>
              parentGroupBounds
                ? clampNodePositionToBounds(position, nextFolderSize, parentGroupBounds)
                : {
                    x: clampToCanvas(position.x),
                    y: clampToCanvas(position.y),
                  },
          },
        )[nextFolderId] ?? constrainedDesiredPosition;

      onAddNodeRef.current({
        id: nextFolderId,
        label: workerMeta.outputFolderLabel,
        description: workerMeta.outputFolderDescription,
        kind: 'folder',
        icon: 'shapes',
        groupId: worker.groupId ?? null,
        parentNodeId: worker.id,
        contentItems: outputItems,
        generatedByWorkerId: worker.id,
        position: resolvedPosition,
        size: nextFolderSize,
        workerMode: null,
        workerStatus: null,
        workerProgress: null,
        workerOutputFolderId: null,
        workerInputSignature: null,
        workerLastError: null,
      });
      onUpdateNodeRef.current(workerId, {
        workerStatus: 'complete',
        workerProgress: 100,
        workerInputSignature: inputSignature,
        workerOutputFolderId: nextFolderId,
        workerLastError: null,
      });
      return;
    }

    onUpdateNodeRef.current(existingOutputFolder.id, {
      label: workerMeta.outputFolderLabel,
      description: workerMeta.outputFolderDescription,
      groupId: worker.groupId ?? null,
      parentNodeId: worker.id,
      contentItems: outputItems,
      generatedByWorkerId: worker.id,
    });
    onUpdateNodeRef.current(workerId, {
      workerStatus: 'complete',
      workerProgress: 100,
      workerInputSignature: inputSignature,
      workerOutputFolderId: existingOutputFolder.id,
      workerLastError: null,
    });
  }, [clearWorkerProcessTimer, getExistingWorkerOutputFolder, getGroupBounds, getNodeById]);

  const failWorkerProcessing = useCallback((workerId: string, errorMessage: string) => {
    clearWorkerProcessTimer(workerId);
    onUpdateNodeRef.current(workerId, {
      workerStatus: 'error',
      workerProgress: 0,
      workerLastError: errorMessage,
    });
  }, [clearWorkerProcessTimer]);

  const startWorkerProgressLoop = useCallback((workerId: string) => {
    clearWorkerProcessTimer(workerId);
    onUpdateNodeRef.current(workerId, {
      workerStatus: 'processing',
      workerProgress: 8,
      workerLastError: null,
    });

    let progress = 8;
    const timerId = window.setInterval(() => {
      progress = Math.min(92, progress + (progress < 56 ? 14 : 6));

      onUpdateNodeRef.current(workerId, {
        workerStatus: 'processing',
        workerProgress: progress,
      });
    }, 260);

    workerProcessTimersRef.current[workerId] = timerId;
  }, [clearWorkerProcessTimer]);

  const completeSortWorkerProcessing = useCallback((workerId: string, inputSignature: string) => {
    commitWorkerOutput(workerId, inputSignature, buildSortWorkerOutputItems(workerId));
  }, [buildSortWorkerOutputItems, commitWorkerOutput]);

  const startSortWorkerProcessing = useCallback((workerId: string, inputSignature: string) => {
    clearWorkerProcessTimer(workerId);
    onUpdateNodeRef.current(workerId, {
      workerStatus: 'processing',
      workerProgress: 8,
      workerLastError: null,
    });

    let progress = 8;
    const timerId = window.setInterval(() => {
      progress = Math.min(100, progress + 14);

      if (progress >= 100) {
        completeSortWorkerProcessing(workerId, inputSignature);
        return;
      }

      onUpdateNodeRef.current(workerId, {
        workerStatus: 'processing',
        workerProgress: progress,
      });
    }, 220);

    workerProcessTimersRef.current[workerId] = timerId;
  }, [clearWorkerProcessTimer, completeSortWorkerProcessing]);

  const runAiWorker = useCallback(async (workerId: string) => {
    const worker = getNodeById(workerId);

    if (!worker || worker.kind !== 'worker') {
      return;
    }

    if (
      worker.workerStatus === 'processing' ||
      workerRequestControllersRef.current[workerId]
    ) {
      return;
    }

    const workerRunMode = resolveWorkerRunMode(worker.workerRunMode);
    const workerOutputMode = resolveWorkerOutputMode(worker.workerOutputMode);
    const baseClientTimeoutMs = getWorkerClientTimeoutMs(workerRunMode);
    const baseClientTimeoutLabel = formatTimeoutLabel(baseClientTimeoutMs);
    const inputSignature = buildWorkerInputSignature(workerId);
    const sourceFiles = collectWorkerSourceFiles(workerId);
    const existingOutputFolder = getExistingWorkerOutputFolder(worker);
    const existingOutputItems = (existingOutputFolder?.contentItems ?? []).filter(
      (item): item is FilePageContentItem => item.kind === 'file',
    );
    const outputFolderExists = Boolean(existingOutputFolder);

    if (
      worker.workerStatus === 'complete' &&
      worker.workerInputSignature === inputSignature &&
      outputFolderExists &&
      !worker.workerLastError
    ) {
      return;
    }

    if (sourceFiles.length === 0) {
      failWorkerProcessing(workerId, 'Connect at least one file or folder before running the worker.');
      return;
    }

    const sourceEntries = sourceFiles.map((item) => ({
      ...item,
      sourceItemId: item.id,
      sourceSignature: buildWorkerSourceSignature(worker, item),
    }));
    const processableSourceFiles = sourceEntries.filter(
      (item) => (item.textContent ?? '').trim().length > 0,
    );

    if (workerOutputMode === 'collated') {
      if (processableSourceFiles.length === 0) {
        failWorkerProcessing(workerId, 'No previewable text was found in the connected inputs.');
        return;
      }

      startWorkerProgressLoop(workerId);
      const controller = new AbortController();
      let didTimeout = false;

      workerRequestControllersRef.current[workerId] = controller;
      workerRequestSignaturesRef.current[workerId] = inputSignature;
      workerRequestTimeoutsRef.current[workerId] = window.setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, baseClientTimeoutMs);

      try {
        const response = await fetch('/api/worker/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            mode: resolveWorkerMode(worker.workerMode),
            focus: worker.workerFocus ?? DEFAULT_FILE_PAGE_WORKER_FOCUS,
            runMode: workerRunMode,
            outputMode: workerOutputMode,
            workerLabel: worker.label,
            inputs: processableSourceFiles.map((item) => ({
              sourceItemId: item.sourceItemId,
              label: item.label,
              description: item.description ?? '',
              textContent: item.textContent ?? '',
              mimeType: item.mimeType ?? null,
            })),
          }),
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const errorMessage =
            typeof payload?.error === 'string' && payload.error.trim().length > 0
              ? payload.error
              : 'The AI worker request failed.';
          throw new Error(errorMessage);
        }

        const generatedFile =
          Array.isArray(payload?.files)
            ? payload.files.find(
                (file: unknown) =>
                  typeof file === 'object' &&
                  file !== null &&
                  typeof (file as { contentText?: unknown }).contentText === 'string' &&
                  (file as { contentText: string }).contentText.trim().length > 0,
              ) ?? null
            : null;

        if (!generatedFile) {
          throw new Error('The AI worker returned no usable output.');
        }

        const contentText = (generatedFile as { contentText: string }).contentText.trim();
        const descriptionValue =
          typeof (generatedFile as { description?: unknown }).description === 'string'
            ? (generatedFile as { description: string }).description.trim()
            : '';
        const existingCollatedOutput =
          existingOutputItems.find((item) => item.sourceItemId === COLLATED_WORKER_SOURCE_ITEM_ID) ??
          existingOutputItems[0] ??
          null;
        const nextVersion =
          typeof existingCollatedOutput?.outputVersion === 'number' &&
          Number.isFinite(existingCollatedOutput.outputVersion)
            ? Math.max(1, existingCollatedOutput.outputVersion) + 1
            : 1;
        const generatedAt = new Date().toISOString();
        const collatedItem: FilePageContentItem = {
          id: buildAiOutputItemId(workerId, COLLATED_WORKER_SOURCE_ITEM_ID),
          kind: 'file',
          label: buildAiOutputFileLabel(worker.label, 'Collated', nextVersion, generatedAt),
          description:
            descriptionValue ||
            buildContentSnippet(contentText, 'Collated AI-ready output from the connected inputs.'),
          textContent: contentText,
          mimeType: 'text/markdown',
          sizeBytes: contentText.length,
          sourceItemId: COLLATED_WORKER_SOURCE_ITEM_ID,
          sourceSignature: inputSignature,
          outputVersion: nextVersion,
          generatedAt,
        };

        commitWorkerOutput(workerId, inputSignature, [collatedItem]);
      } catch (error) {
        if (controller.signal.aborted && !didTimeout) {
          return;
        }

        failWorkerProcessing(
          workerId,
          didTimeout
            ? `AI worker timed out locally after ${baseClientTimeoutLabel}. Try Fast mode, fewer files, or a smaller source.`
            : error instanceof Error
              ? error.message
              : 'The AI worker request failed.',
        );
      } finally {
        if (workerRequestControllersRef.current[workerId] === controller) {
          delete workerRequestControllersRef.current[workerId];
        }

        clearWorkerRequestTimeout(workerId);
        delete workerRequestSignaturesRef.current[workerId];
      }

      return;
    }

    const existingOutputsBySourceId = new Map(
      existingOutputItems.flatMap((item) =>
        typeof item.sourceItemId === 'string' && item.sourceItemId.trim().length > 0
          ? [[item.sourceItemId, item] as const]
          : [],
      ),
    );
    const reusableOutputItems = sourceEntries.flatMap((item) => {
      const existingOutput = existingOutputsBySourceId.get(item.sourceItemId);

      if (!existingOutput || existingOutput.sourceSignature !== item.sourceSignature) {
        return [];
      }

      return [
        {
          ...existingOutput,
          sourceItemId: item.sourceItemId,
          sourceSignature: item.sourceSignature,
          outputVersion:
            typeof existingOutput.outputVersion === 'number' && Number.isFinite(existingOutput.outputVersion)
              ? Math.max(1, existingOutput.outputVersion)
              : 1,
        },
      ];
    });
    const pendingSourceFiles = sourceEntries.filter(
      (item) => !reusableOutputItems.some((output) => output.sourceItemId === item.sourceItemId),
    );
    const processablePendingSourceFiles = pendingSourceFiles.filter(
      (item) => (item.textContent ?? '').trim().length > 0,
    );
    const preservedLegacyOutputItems = existingOutputItems.filter(
      (item) =>
        typeof item.sourceItemId !== 'string' ||
        item.sourceItemId.trim().length === 0 ||
        typeof item.sourceSignature !== 'string' ||
        item.sourceSignature.trim().length === 0,
    );
    const preservedOutputItems = sortCanvasContentItems([
      ...preservedLegacyOutputItems,
      ...reusableOutputItems,
    ]);

    if (
      processablePendingSourceFiles.length === 0 &&
      preservedOutputItems.length === 0 &&
      !sourceFiles.some((item) => (item.textContent ?? '').trim().length > 0)
    ) {
      failWorkerProcessing(workerId, 'No previewable text was found in the connected inputs.');
      return;
    }

    if (processablePendingSourceFiles.length === 0) {
      commitWorkerOutput(workerId, inputSignature, preservedOutputItems);
      return;
    }

    const batchSettings = AI_WORKER_REQUEST_BATCH_SETTINGS[workerRunMode];
    const pendingBatches = buildAiWorkerRequestBatches(
      processablePendingSourceFiles,
      workerRunMode,
    );
    const requestConcurrency = Math.min(
      getAiWorkerRequestConcurrency(workerRunMode),
      pendingBatches.length,
    );
    const requestWaveCount = Math.max(
      1,
      Math.ceil(pendingBatches.length / requestConcurrency),
    );
    const clientTimeoutMs = Math.max(
      baseClientTimeoutMs,
      Math.ceil(baseClientTimeoutMs * requestWaveCount * batchSettings.clientTimeoutMultiplier),
    );
    const clientTimeoutLabel = formatTimeoutLabel(clientTimeoutMs);

    startWorkerProgressLoop(workerId);
    const controller = new AbortController();
    let didTimeout = false;

    workerRequestControllersRef.current[workerId] = controller;
    workerRequestSignaturesRef.current[workerId] = inputSignature;
    workerRequestTimeoutsRef.current[workerId] = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, clientTimeoutMs);

    try {
      const generatedOutputItems: FilePageContentItem[] = [];
      let nextBatchIndex = 0;

      const runBatchWorker = async () => {
        while (nextBatchIndex < pendingBatches.length) {
          const batchIndex = nextBatchIndex;
          nextBatchIndex += 1;
          const batchItems = pendingBatches[batchIndex] ?? [];

          const response = await fetch('/api/worker/run', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              mode: resolveWorkerMode(worker.workerMode),
              focus: worker.workerFocus ?? DEFAULT_FILE_PAGE_WORKER_FOCUS,
              runMode: workerRunMode,
              outputMode: workerOutputMode,
              workerLabel: worker.label,
              inputs: batchItems.map((item) => ({
                sourceItemId: item.sourceItemId,
                label: item.label,
                description: item.description ?? '',
                textContent: item.textContent ?? '',
                mimeType: item.mimeType ?? null,
              })),
            }),
          });
          const payload = await response.json().catch(() => null);

          if (!response.ok) {
            const errorMessage =
              typeof payload?.error === 'string' && payload.error.trim().length > 0
                ? payload.error
                : 'The AI worker request failed.';
            throw new Error(errorMessage);
          }

          const claimedSourceIds = new Set<string>();
          const generatedBatchItems = Array.isArray(payload?.files)
            ? payload.files.flatMap((file: unknown, index: number) => {
                if (
                  typeof file !== 'object' ||
                  file === null ||
                  typeof (file as { contentText?: unknown }).contentText !== 'string'
                ) {
                  return [];
                }

                const contentText = (file as { contentText: string }).contentText.trim();

                if (contentText.length === 0) {
                  return [];
                }

                const explicitSourceItemId =
                  typeof (file as { sourceItemId?: unknown }).sourceItemId === 'string'
                    ? (file as { sourceItemId: string }).sourceItemId.trim()
                    : '';
                const explicitSourceMatch =
                  explicitSourceItemId.length > 0 && !claimedSourceIds.has(explicitSourceItemId)
                    ? batchItems.find((item) => item.sourceItemId === explicitSourceItemId)
                    : undefined;
                const matchedSource =
                  explicitSourceMatch ??
                  batchItems.find(
                    (item, pendingIndex) => pendingIndex === index && !claimedSourceIds.has(item.sourceItemId),
                  ) ??
                  batchItems.find((item) => !claimedSourceIds.has(item.sourceItemId));

                if (!matchedSource) {
                  return [];
                }

                claimedSourceIds.add(matchedSource.sourceItemId);

                const descriptionValue =
                  typeof (file as { description?: unknown }).description === 'string'
                    ? (file as { description: string }).description.trim()
                    : '';
                const existingOutput = existingOutputsBySourceId.get(matchedSource.sourceItemId);
                const nextVersion =
                  typeof existingOutput?.outputVersion === 'number' &&
                  Number.isFinite(existingOutput.outputVersion)
                    ? Math.max(1, existingOutput.outputVersion) + 1
                    : 1;
                const generatedAt = new Date().toISOString();
                const label = buildAiOutputFileLabel(
                  worker.label,
                  matchedSource.label,
                  nextVersion,
                  generatedAt,
                );

                return [
                  {
                    id: buildAiOutputItemId(workerId, matchedSource.sourceItemId),
                    kind: 'file' as const,
                    label,
                    description:
                      descriptionValue ||
                      buildContentSnippet(contentText, `AI-ready output for ${matchedSource.label}.`),
                    textContent: contentText,
                    mimeType: 'text/markdown',
                    sizeBytes: contentText.length,
                    sourceItemId: matchedSource.sourceItemId,
                    sourceSignature: matchedSource.sourceSignature,
                    outputVersion: nextVersion,
                    generatedAt,
                  },
                ];
              })
            : [];

          generatedOutputItems.push(...generatedBatchItems);
        }
      };

      await Promise.all(
        Array.from({ length: requestConcurrency }, () => runBatchWorker()),
      );

      if (generatedOutputItems.length === 0) {
        throw new Error('The AI worker returned no usable output.');
      }

      commitWorkerOutput(
        workerId,
        inputSignature,
        sortCanvasContentItems([...preservedOutputItems, ...generatedOutputItems]),
      );
    } catch (error) {
      if (controller.signal.aborted && !didTimeout) {
        return;
      }

      failWorkerProcessing(
        workerId,
        didTimeout
          ? `AI worker timed out locally after ${clientTimeoutLabel}. Try Fast mode, fewer files, or a smaller source.`
          : error instanceof Error
            ? error.message
            : 'The AI worker request failed.',
      );
    } finally {
      if (workerRequestControllersRef.current[workerId] === controller) {
        delete workerRequestControllersRef.current[workerId];
      }

      clearWorkerRequestTimeout(workerId);
      delete workerRequestSignaturesRef.current[workerId];
    }
  }, [
    buildWorkerInputSignature,
    buildWorkerSourceSignature,
    clearWorkerRequestTimeout,
    collectWorkerSourceFiles,
    commitWorkerOutput,
    failWorkerProcessing,
    getExistingWorkerOutputFolder,
    getNodeById,
    startWorkerProgressLoop,
  ]);

  const getWorkerInputConnectionTarget = useCallback((
    nodeId: string,
    positions: Record<string, Point>,
    dragNodeIds: string[],
  ) => {
    const node = getNodeById(nodeId);

    if (
      !node ||
      (node.kind !== 'file' && node.kind !== 'folder') ||
      node.generatedByWorkerId
    ) {
      return null;
    }

    const nodePosition = positions[nodeId] ?? node.position;
    const nodeBounds = getNodeBoundsWithSize(
      nodePosition,
      draftSizesRef.current[nodeId] ?? node.size,
      node.kind,
    );
    const nodeCenter = {
      x: (nodeBounds.left + nodeBounds.right) / 2,
      y: (nodeBounds.top + nodeBounds.bottom) / 2,
    };
    let closestWorkerId: string | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    nodesRef.current.forEach((candidate) => {
      if (
        candidate.kind !== 'worker' ||
        candidate.id === nodeId ||
        dragNodeIds.includes(candidate.id)
      ) {
        return;
      }

      const candidatePosition = positions[candidate.id] ?? candidate.position;
      const candidateBounds = getNodeBoundsWithSize(
        candidatePosition,
        draftSizesRef.current[candidate.id] ?? candidate.size,
        candidate.kind,
      );
      const candidateCenterX = (candidateBounds.left + candidateBounds.right) / 2;

      if (nodeCenter.x > candidateCenterX + SLOT_STEP_X * 0.2) {
        return;
      }

      const inputZone = {
        left: candidateBounds.left - WORKER_CONNECTION_THRESHOLD_X,
        right: candidateBounds.left + SLOT_STEP_X * 0.35,
        top: candidateBounds.top - WORKER_CONNECTION_THRESHOLD_Y,
        bottom: candidateBounds.bottom + WORKER_CONNECTION_THRESHOLD_Y,
      };
      const distanceX = Math.max(
        0,
        inputZone.left - nodeBounds.right,
        nodeBounds.left - inputZone.right,
      );
      const distanceY = Math.max(
        0,
        inputZone.top - nodeBounds.bottom,
        nodeBounds.top - inputZone.bottom,
      );
      const distance = Math.hypot(distanceX, distanceY);

      if (distance < closestDistance) {
        closestWorkerId = candidate.id;
        closestDistance = distance;
      }
    });

    return closestDistance <= SLOT_STEP_X ? closestWorkerId : null;
  }, [getNodeById]);

  const getDraggedWorkerConnectionAssignments = useCallback((
    nodeIds: string[],
    positions: Record<string, Point>,
  ) => {
    const assignments = new Map<string, string | null>();

    nodeIds.forEach((nodeId) => {
      const node = getNodeById(nodeId);

      if (
        !node ||
        (node.kind !== 'file' && node.kind !== 'folder') ||
        node.generatedByWorkerId
      ) {
        return;
      }

      const nextWorkerId = getWorkerInputConnectionTarget(nodeId, positions, nodeIds);
      const currentParent = node.parentNodeId ? getNodeById(node.parentNodeId) : null;

      if (currentParent?.kind === 'worker' && nodeIds.includes(currentParent.id)) {
        return;
      }

      if (nextWorkerId || currentParent?.kind === 'worker') {
        assignments.set(nodeId, nextWorkerId);
      }
    });

    return assignments;
  }, [getNodeById, getWorkerInputConnectionTarget]);

  useEffect(() => {
    const activeWorkerIds = new Set(
      nodes.filter((node) => node.kind === 'worker').map((node) => node.id),
    );

    Object.keys(workerProcessTimersRef.current).forEach((workerId) => {
      if (!activeWorkerIds.has(workerId)) {
        clearWorkerProcessTimer(workerId);
      }
    });
    Object.keys(workerRequestControllersRef.current).forEach((workerId) => {
      if (!activeWorkerIds.has(workerId)) {
        cancelWorkerRequest(workerId);
      }
    });

    nodes.forEach((node) => {
      if (node.kind !== 'worker') {
        return;
      }

      const workerMode = resolveWorkerMode(node.workerMode);
      const inputNodes = getWorkerInputNodes(node.id);
      const inputSignature = buildWorkerInputSignature(node.id);
      const outputFolderExists = node.workerOutputFolderId
        ? Boolean(getNodeById(node.workerOutputFolderId))
        : Boolean(
            nodesRef.current.find(
              (candidate) => candidate.kind === 'folder' && candidate.generatedByWorkerId === node.id,
            ),
          );

      if (inputNodes.length === 0) {
        cancelWorkerRequest(node.id);
        clearWorkerProcessTimer(node.id);

        if (outputFolderExists) {
          removeWorkerOutputFolder(node);
        }

        if (
          node.workerStatus !== 'idle' ||
          (node.workerProgress ?? 0) !== 0 ||
          node.workerOutputFolderId ||
          node.workerInputSignature ||
          node.workerLastError
        ) {
          onUpdateNodeRef.current(node.id, {
            workerStatus: 'idle',
            workerProgress: 0,
            workerOutputFolderId: null,
            workerInputSignature: null,
            workerLastError: null,
          });
        }
        return;
      }

      if (workerMode === 'ai-ready') {
        if (node.workerStatus === 'processing') {
          if (
            workerRequestSignaturesRef.current[node.id] &&
            workerRequestSignaturesRef.current[node.id] !== inputSignature
          ) {
            cancelWorkerRequest(node.id);
            clearWorkerProcessTimer(node.id);
            onUpdateNodeRef.current(node.id, {
              workerStatus: 'idle',
              workerProgress: 0,
              workerLastError: null,
            });
          }
          return;
        }

        if (
          node.workerStatus === 'complete' &&
          node.workerInputSignature === inputSignature &&
          outputFolderExists
        ) {
          return;
        }

        return;
      }

      if (node.workerStatus === 'processing') {
        return;
      }

      if (
        node.workerStatus === 'complete' &&
        node.workerInputSignature === inputSignature &&
        outputFolderExists
      ) {
        return;
      }

      startSortWorkerProcessing(node.id, inputSignature);
    });
  }, [
    buildWorkerInputSignature,
    cancelWorkerRequest,
    clearWorkerProcessTimer,
    getNodeById,
    getWorkerInputNodes,
    nodes,
    removeWorkerOutputFolder,
    startSortWorkerProcessing,
  ]);

  const resolveInsertionPosition = useCallback((
    node: Pick<FilePageNode, 'kind' | 'size'>,
    localPoint: Point | null = contextMenuPointRef.current,
    anchor: 'top-left' | 'center' = 'top-left',
  ) => {
    const resolvedPoint = localPoint ?? {
      x: CANVAS_PADDING,
      y: CANVAS_PADDING,
    };
    const nodeDimensions = getNodeDimensionsForKind(node.size, node.kind);
    const offsetX = anchor === 'center' ? nodeDimensions.width / 2 : 0;
    const offsetY = anchor === 'center' ? nodeDimensions.height / 2 : 0;

    return {
      x: clampToCanvas(resolvedPoint.x - offsetX),
      y: clampToCanvas(resolvedPoint.y - offsetY),
    };
  }, []);

  const addNodeWithPosition = useCallback((
    node: Omit<FilePageNode, 'position'>,
    position: Point,
  ) => {
    const nextNode = {
      ...node,
      position,
    };

    onPreviewContentItemChange?.(null);
    onAddNodeRef.current(nextNode);
    onSelectNodesRef.current([nextNode.id]);
    setDraftSelectedNodeIds([nextNode.id]);
  }, [onPreviewContentItemChange]);

  const addNodeAtContext = useCallback((node: Omit<FilePageNode, 'position'>) => {
    addNodeWithPosition(node, resolveInsertionPosition(node));
    contextMenuPointRef.current = null;
  }, [addNodeWithPosition, resolveInsertionPosition]);

  const addNodeInViewport = useCallback((node: Omit<FilePageNode, 'position'>) => {
    if (!canvasRef.current) {
      addNodeWithPosition(node, resolveInsertionPosition(node));
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const viewportCenter = {
      x: rect.width / 2 - viewportRef.current.x,
      y: rect.height / 2 - viewportRef.current.y,
    };

    addNodeWithPosition(node, resolveInsertionPosition(node, viewportCenter, 'center'));
    contextMenuPointRef.current = null;
  }, [addNodeWithPosition, resolveInsertionPosition]);

  const buildBasicElementNode = useCallback((): Omit<FilePageNode, 'position'> => ({
    id: `element-${Date.now()}`,
    label: 'Basic element',
    description: 'Freeform canvas object for quick thinking and placement.',
    kind: 'element',
    icon: 'sparkles',
    size: {
      widthUnits: 1,
      heightUnits: 1,
    },
  }), []);

  const buildGroupNode = useCallback((): Omit<FilePageNode, 'position'> => ({
    id: `group-${Date.now()}`,
    label: 'Group',
    description: 'Shared canvas region for clustering related notes and files.',
    kind: 'group',
    icon: 'shapes',
    size: {
      widthUnits: 3,
      heightUnits: 2,
    },
  }), []);

  const buildWorkerNode = useCallback((mode: FilePageWorkerMode): Omit<FilePageNode, 'position'> => {
    const workerMeta = getWorkerModeMeta(mode);

    return {
      id: `worker-${Date.now()}`,
      label: workerMeta.defaultNodeLabel,
      description: workerMeta.defaultNodeDescription,
      kind: 'worker',
      icon: 'target',
      size: {
        widthUnits: 3,
        heightUnits: 3,
      },
      contentItems: [],
      generatedByWorkerId: null,
      workerMode: mode,
      workerFocus: DEFAULT_FILE_PAGE_WORKER_FOCUS,
      workerRunMode: DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
      workerOutputMode: DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
      workerStatus: 'idle',
      workerProgress: 0,
      workerOutputFolderId: null,
      workerInputSignature: null,
      workerLastError: null,
    };
  }, []);

  const buildCanvasPaletteNode = useCallback((
    templateId: CanvasPaletteTemplateId,
  ): Omit<FilePageNode, 'position'> => {
    switch (templateId) {
      case 'ai-worker':
        return buildWorkerNode('ai-ready');
      case 'sort-worker':
        return buildWorkerNode('sort-data');
      case 'group':
        return buildGroupNode();
      case 'element':
      default:
        return buildBasicElementNode();
    }
  }, [buildBasicElementNode, buildGroupNode, buildWorkerNode]);

  const canvasPaletteItems = useMemo<CanvasPaletteSidebarItem[]>(() => {
    const aiWorkerMeta = getWorkerModeMeta('ai-ready');
    const sortWorkerMeta = getWorkerModeMeta('sort-data');

    return [
      {
        id: 'ai-worker',
        label: aiWorkerMeta.defaultNodeLabel,
        description: aiWorkerMeta.defaultNodeDescription,
        section: 'Workers',
      },
      {
        id: 'sort-worker',
        label: sortWorkerMeta.defaultNodeLabel,
        description: sortWorkerMeta.defaultNodeDescription,
        section: 'Workers',
      },
      {
        id: 'element',
        label: 'Basic element',
        description: 'Freeform canvas object for quick thinking and placement.',
        section: 'Structure',
      },
      {
        id: 'group',
        label: 'Group',
        description: 'Shared canvas region for clustering related notes, workers, and files.',
        section: 'Structure',
      },
    ];
  }, []);
  const structurePaletteItems = useMemo(
    () => canvasPaletteItems.filter((item) => item.section === 'Structure'),
    [canvasPaletteItems],
  );
  const workerPaletteItems = useMemo(
    () => canvasPaletteItems.filter((item) => item.section === 'Workers'),
    [canvasPaletteItems],
  );

  const clearPaletteDragState = useCallback(() => {
    paletteDragDepthRef.current = 0;
    setDraggedPaletteTemplateId(null);
    setPaletteDragPreviewPoint(null);
    setIsPaletteDragOverCanvas(false);
  }, []);

  const handleInsertPaletteNode = useCallback((templateId: CanvasPaletteTemplateId) => {
    addNodeInViewport(buildCanvasPaletteNode(templateId));
  }, [addNodeInViewport, buildCanvasPaletteNode]);

  const handlePaletteItemDragStart = useCallback((
    templateId: CanvasPaletteTemplateId,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    setDraggedPaletteTemplateId(templateId);
    setPaletteDragPreviewPoint(null);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(CANVAS_PALETTE_DATA_TRANSFER_TYPE, templateId);
    event.dataTransfer.setData('text/plain', `${CANVAS_PALETTE_TEXT_PREFIX}${templateId}`);
    setTransparentDragImage(event.dataTransfer);
  }, []);

  const handleCanvasPaletteDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (
      (event.target as HTMLElement).closest('[data-canvas-chrome="true"]') ||
      !hasCanvasPaletteTemplate(event.dataTransfer)
    ) {
      return;
    }

    event.preventDefault();
    paletteDragDepthRef.current += 1;
    setIsPaletteDragOverCanvas(true);
    const localPoint = getLocalPoint(event.clientX, event.clientY);

    if (localPoint) {
      setPaletteDragPreviewPoint(localPoint);
    }
  }, [getLocalPoint]);

  const handleCanvasPaletteDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (
      (event.target as HTMLElement).closest('[data-canvas-chrome="true"]') ||
      !hasCanvasPaletteTemplate(event.dataTransfer)
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const localPoint = getLocalPoint(event.clientX, event.clientY);

    if (localPoint) {
      setPaletteDragPreviewPoint(localPoint);
    }

    if (!isPaletteDragOverCanvas) {
      setIsPaletteDragOverCanvas(true);
    }
  }, [getLocalPoint, isPaletteDragOverCanvas]);

  const handleCanvasPaletteDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (
      (event.target as HTMLElement).closest('[data-canvas-chrome="true"]') ||
      !hasCanvasPaletteTemplate(event.dataTransfer)
    ) {
      return;
    }

    event.preventDefault();
    paletteDragDepthRef.current = Math.max(0, paletteDragDepthRef.current - 1);

    if (paletteDragDepthRef.current === 0) {
      setPaletteDragPreviewPoint(null);
      setIsPaletteDragOverCanvas(false);
    }
  }, []);

  const handleCanvasPaletteDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const templateId = readCanvasPaletteTemplate(event.dataTransfer);

    if (
      !templateId ||
      (event.target as HTMLElement).closest('[data-canvas-chrome="true"]')
    ) {
      return;
    }

    event.preventDefault();
    clearPaletteDragState();
    const localPoint = getLocalPoint(event.clientX, event.clientY);

    if (!localPoint) {
      return;
    }

    const nextNode = buildCanvasPaletteNode(templateId);
    addNodeWithPosition(nextNode, resolveInsertionPosition(nextNode, localPoint, 'center'));
  }, [
    addNodeWithPosition,
    buildCanvasPaletteNode,
    clearPaletteDragState,
    getLocalPoint,
    resolveInsertionPosition,
  ]);

  const paletteDragPreview = useMemo(() => {
    if (!draggedPaletteTemplateId || !paletteDragPreviewPoint) {
      return null;
    }

    const node = buildCanvasPaletteNode(draggedPaletteTemplateId);
    const position = resolveInsertionPosition(node, paletteDragPreviewPoint, 'center');
    const bounds = getNodeBoundsWithSize(position, node.size, node.kind);
    const dimensions = getNodeDimensionsForKind(node.size, node.kind);
    const meta = NODE_META[node.kind];
    const elementMeta = node.kind === 'element' ? ELEMENT_ICON_META[node.icon] : null;
    const Icon = elementMeta?.icon ?? meta.icon;
    const iconToneClassName =
      node.icon === 'lightbulb'
        ? 'border-amber-200/80 bg-amber-50/85 text-amber-600'
        : node.icon === 'message-square'
          ? 'border-sky-200/80 bg-sky-50/85 text-sky-600'
          : node.icon === 'target'
            ? 'border-rose-200/80 bg-rose-50/85 text-rose-600'
            : node.icon === 'shapes'
              ? 'border-violet-200/80 bg-violet-50/85 text-violet-600'
              : 'border-emerald-200/80 bg-emerald-50/85 text-emerald-600';

    return {
      Icon,
      bounds,
      dimensions,
      iconToneClassName,
      node,
    };
  }, [buildCanvasPaletteNode, draggedPaletteTemplateId, paletteDragPreviewPoint, resolveInsertionPosition]);

  function handleAddBasicElement() {
    addNodeAtContext(buildBasicElementNode());
  }

  function handleAddGroup() {
    addNodeAtContext(buildGroupNode());
  }

  function handleAddWorker(mode: FilePageWorkerMode) {
    addNodeAtContext(buildWorkerNode(mode));
  }

  function handleAddAiWorker() {
    handleAddWorker('ai-ready');
  }

  function handleAddSortWorker() {
    handleAddWorker('sort-data');
  }

  const clearNodeSizePreview = useCallback((nodeId?: string) => {
    if (!nodeId) {
      setDraftSizes({});
      setDraftPositions({});
      return;
    }

    setDraftSizes((current) => {
      if (!(nodeId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[nodeId];
      return next;
    });
    setDraftPositions((current) => {
      if (!(nodeId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[nodeId];
      return next;
    });
  }, []);

  const clearNodeIconPreview = useCallback((nodeId?: string) => {
    if (!nodeId) {
      setDraftIcons({});
      return;
    }

    setDraftIcons((current) => {
      if (!(nodeId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[nodeId];
      return next;
    });
  }, []);

  const getResizePlacement = useCallback((
    nodeId: string,
    size: FilePageNode['size'],
    positionOverride?: Point,
  ) => {
    const resizingNode = getNodeById(nodeId);

    if (!resizingNode) {
      return null;
    }

    const basePosition = resizingNode.position;
    const widthGrowth = Math.max(0, size.widthUnits - resizingNode.size.widthUnits);
    const heightGrowth = Math.max(0, size.heightUnits - resizingNode.size.heightUnits);
    const candidatePositions = positionOverride
      ? [positionOverride]
      : Array.from({ length: widthGrowth + 1 }, (_, leftShiftUnits) =>
          Array.from({ length: heightGrowth + 1 }, (_, upShiftUnits) => ({
            position: {
              x: basePosition.x - leftShiftUnits * SLOT_STEP_X,
              y: basePosition.y - upShiftUnits * SLOT_STEP_Y,
            },
            distance: leftShiftUnits + upShiftUnits,
          })),
        )
          .flat()
          .sort((left, right) => left.distance - right.distance)
          .map(({ position }) => position);

    for (const resizedPosition of candidatePositions) {
      if (resizingNode.kind === 'group') {
        const resizedContentBounds = getGroupContentBounds(resizedPosition, size);
        const childFitsWithinGroup = nodesRef.current
          .filter((node) => node.groupId === resizingNode.id)
          .every((node) => {
            const childPosition = draftPositionsRef.current[node.id] ?? node.position;
            const childSize = draftSizesRef.current[node.id] ?? node.size;
            const childBounds = getNodeBoundsWithSize(childPosition, childSize, node.kind);

            return (
              childBounds.left >= resizedContentBounds.left &&
              childBounds.top >= resizedContentBounds.top &&
              childBounds.right <= resizedContentBounds.right &&
              childBounds.bottom <= resizedContentBounds.bottom
            );
          });

        if (!childFitsWithinGroup) {
          continue;
        }
      }

      if (resizingNode.groupId) {
        const parentBounds = getGroupBounds(resizingNode.groupId, draftPositionsRef.current);

        if (!parentBounds) {
          continue;
        }

        const clampedPosition = clampNodePositionToBounds(resizedPosition, size, parentBounds);

        if (clampedPosition.x !== resizedPosition.x || clampedPosition.y !== resizedPosition.y) {
          continue;
        }
      }

      const resizedBounds = getNodeBoundsWithSize(resizedPosition, size, resizingNode.kind);
      const collides = nodesRef.current
        .filter((node) => node.id !== nodeId)
        .some((node) => {
          const otherPosition = draftPositionsRef.current[node.id] ?? node.position;
          const otherSize = draftSizesRef.current[node.id] ?? node.size;

          return (
            !canNodesShareSpace(resizingNode, node) &&
            boundsOverlap(resizedBounds, getNodeBoundsWithSize(otherPosition, otherSize, node.kind))
          );
        });

      if (!collides) {
        return resizedPosition;
      }
    }

    return null;
  }, [canNodesShareSpace, getGroupBounds, getNodeById]);

  const canResizeNode = useCallback((
    nodeId: string,
    size: FilePageNode['size'],
    positionOverride?: Point,
  ) => Boolean(getResizePlacement(nodeId, size, positionOverride)), [getResizePlacement]);

  const previewNodeResize = useCallback((node: FilePageNode, size: FilePageNode['size']) => {
    const resizePlacement = getResizePlacement(node.id, size);

    if (!resizePlacement) {
      return;
    }

    setDraftSizes((current) => ({
      ...current,
      [node.id]: size,
    }));
    setDraftPositions((current) => ({
      ...current,
      [node.id]: resizePlacement,
    }));
  }, [getResizePlacement]);

  const applyNodeResize = useCallback((node: FilePageNode, size: FilePageNode['size']) => {
    const resizePlacement = getResizePlacement(node.id, size);

    if (!resizePlacement) {
      return;
    }

    clearNodeSizePreview(node.id);
    if (!arePointsEqual(resizePlacement, node.position)) {
      onMoveNodesRef.current({
        [node.id]: resizePlacement,
      });
    }
    onResizeNodeRef.current(node.id, size);
    onSelectNodesRef.current([node.id]);
  }, [clearNodeSizePreview, getResizePlacement]);

  const previewNodeIcon = useCallback((node: FilePageNode, icon: FilePageElementIcon) => {
    if (node.kind !== 'element') {
      return;
    }

    setDraftIcons((current) => ({
      ...current,
      [node.id]: icon,
    }));
  }, []);

  const applyNodeIcon = useCallback((node: FilePageNode, icon: FilePageElementIcon) => {
    if (node.kind !== 'element') {
      return;
    }

    clearNodeIconPreview(node.id);
    onUpdateNodeRef.current(node.id, { icon });
    onSelectNodesRef.current([node.id]);
  }, [clearNodeIconPreview]);

  const startNodeRename = useCallback((node: FilePageNode) => {
    setEditingNodeId(node.id);
    setEditingLabel(node.label);
    onSelectNodesRef.current([node.id]);
  }, []);

  const commitNodeRename = useCallback((node: FilePageNode) => {
    const nextLabel = editingLabelRef.current.trim();

    if (nextLabel) {
      onUpdateNodeRef.current(node.id, {
        label: nextLabel,
      });
    }

    setEditingNodeId(null);
    setEditingLabel('');
  }, []);

  const stopNodeRename = useCallback(() => {
    setEditingNodeId(null);
    setEditingLabel('');
  }, []);

  const selectSingleNode = useCallback((nodeId: string) => {
    onPreviewContentItemChange?.(null);
    onSelectNodesRef.current([nodeId]);
    setDraftSelectedNodeIds([nodeId]);
  }, [onPreviewContentItemChange]);

  const beginWorkerInputConnection = useCallback((
    event: ReactPointerEvent<HTMLSpanElement>,
    node: FilePageNode,
  ) => {
    if (event.button !== 0 || node.kind !== 'worker') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const localPoint = getLocalPoint(event.clientX, event.clientY);
    const handlePoint = getWorkerInputHandlePoint(node.id);

    if (!localPoint || !handlePoint) {
      return;
    }

    const nextWorkerConnectionState = {
      workerId: node.id,
      current: localPoint,
      targetNodeId: getWorkerInputDropTarget(node.id, localPoint),
    };

    setContextMenuNodeId(null);
    selectSingleNode(node.id);
    workerConnectionDragStateRef.current = nextWorkerConnectionState;
    setWorkerConnectionDragState(nextWorkerConnectionState);
  }, [getLocalPoint, getWorkerInputDropTarget, getWorkerInputHandlePoint, selectSingleNode]);

  const activeWorkerConnectionPreview = useMemo(() => {
    if (!workerConnectionDragState) {
      return null;
    }

    const handlePoint = getWorkerInputHandlePoint(workerConnectionDragState.workerId);

    if (!handlePoint) {
      return null;
    }

    let endPoint = workerConnectionDragState.current;

    if (workerConnectionDragState.targetNodeId) {
      const targetNode = getNodeById(workerConnectionDragState.targetNodeId);

      if (targetNode) {
        const targetBounds = getNodeBoundsWithSize(
          draftPositions[targetNode.id] ?? targetNode.position,
          draftSizes[targetNode.id] ?? targetNode.size,
          targetNode.kind,
        );

        endPoint = {
          x: targetBounds.right,
          y: (targetBounds.top + targetBounds.bottom) / 2,
        };
      }
    }

    return {
      path: getConnectorPath(getPointBounds(handlePoint), getPointBounds(endPoint)),
      targetNodeId: workerConnectionDragState.targetNodeId,
    };
  }, [
    draftPositions,
    draftSizes,
    getNodeById,
    getWorkerInputHandlePoint,
    workerConnectionDragState,
  ]);

  const setNodeHover = useCallback((node: FilePageNode, hovered: boolean) => {
    if (!hovered && contextMenuNodeIdRef.current === node.id) {
      return;
    }

    onHoverNodeChangeRef.current(hovered ? node : null);
  }, []);

  const setNodeContextMenuOpen = useCallback((node: FilePageNode, open: boolean) => {
    if (open) {
      setContextMenuNodeId(node.id);
      onHoverNodeChangeRef.current(node);
      return;
    }

    setContextMenuNodeId((current) => (current === node.id ? null : current));
    onHoverNodeChangeRef.current(null);
  }, []);

  const openNodeContextMenu = useCallback((node: FilePageNode) => {
    setContextMenuNodeId(node.id);
    onHoverNodeChangeRef.current(node);
    selectSingleNode(node.id);
  }, [selectSingleNode]);

  const deleteConnector = useCallback((connector: ConnectorPath) => {
    if (!connector.deletable) {
      return;
    }

    const childNode = getNodeById(connector.childNodeId);

    if (!childNode || childNode.parentNodeId !== connector.parentNodeId) {
      return;
    }

    setHoveredConnectorId((current) => (current === connector.id ? null : current));
    onPreviewContentItemChange?.(null);
    onUpdateNodeRef.current(childNode.id, {
      parentNodeId: null,
    });
  }, [getNodeById, onPreviewContentItemChange]);

  const deleteCanvasNode = useCallback((node: FilePageNode) => {
    if (node.kind === 'worker') {
      cancelWorkerRequest(node.id);
      clearWorkerProcessTimer(node.id);
      const connectedNodes = nodesRef.current.filter((candidate) => candidate.parentNodeId === node.id);

      connectedNodes.forEach((candidate) => {
        if (candidate.generatedByWorkerId === node.id) {
          onUpdateNodeRef.current(candidate.id, {
            parentNodeId: null,
            generatedByWorkerId: null,
          });
          return;
        }

        onUpdateNodeRef.current(candidate.id, {
          parentNodeId: null,
        });
      });

      onDeleteNodeRef.current(node.id);
      return;
    }

    if (node.kind !== 'group') {
      onDeleteNodeRef.current(node.id);
      return;
    }

    const childNodes = nodesRef.current.filter((candidate) => candidate.groupId === node.id);
    const dispersedPositions: Record<string, Point> = {};
    const stationaryNodes = nodesRef.current.filter(
      (candidate) => candidate.id !== node.id && candidate.groupId !== node.id,
    );
    const resolvedChildren: FilePageNode[] = [];

    childNodes.forEach((childNode) => {
      const desiredPosition = {
        x: snapToSlotX(childNode.position.x),
        y: snapToSlotY(childNode.position.y),
      };
      const resolvedPositions = resolveSnapPositions(
        {
          [childNode.id]: desiredPosition,
        },
        [childNode.id],
        [...stationaryNodes, ...resolvedChildren],
        {
          [childNode.id]: desiredPosition,
        },
        {
          [childNode.id]: draftSizesRef.current[childNode.id] ?? childNode.size,
        },
        undefined,
        {
          getNodeKind: (nodeId) => (nodeId === childNode.id ? childNode.kind : undefined),
        },
      );
      const nextPosition = resolvedPositions[childNode.id] ?? desiredPosition;

      dispersedPositions[childNode.id] = nextPosition;
      resolvedChildren.push({
        ...childNode,
        groupId: null,
        position: nextPosition,
      });
      onUpdateNodeRef.current(childNode.id, { groupId: null });
    });

    if (Object.keys(dispersedPositions).length > 0) {
      onMoveNodesRef.current(dispersedPositions);
    }

    onDeleteNodeRef.current(node.id);
  }, [cancelWorkerRequest, clearWorkerProcessTimer]);

  const beginNodeResize = useCallback((
    event: ReactPointerEvent<HTMLSpanElement>,
    node: FilePageNode,
    axis: GroupResizeAxis,
  ) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const localPoint = getLocalPoint(event.clientX, event.clientY);

    if (!localPoint) {
      return;
    }

    const nextResizeState = {
      nodeId: node.id,
      axis,
      origin: localPoint,
      basePosition: draftPositionsRef.current[node.id] ?? node.position,
      baseSize: draftSizesRef.current[node.id] ?? node.size,
      minimumSize: getMinimumNodeSize(node),
    };

    setContextMenuNodeId(null);
    selectSingleNode(node.id);
    resizeStateRef.current = nextResizeState;
    setResizeState(nextResizeState);
    setDraftSizes((current) => ({
      ...current,
      [node.id]: nextResizeState.baseSize,
    }));
    setDraftPositions((current) => ({
      ...current,
      [node.id]: nextResizeState.basePosition,
    }));
  }, [getLocalPoint, selectSingleNode]);

  function renderCanvasNode(node: FilePageNode) {
    const displayPosition = draftPositions[node.id] ?? node.position;
    const previewPosition = snapPreviewPositions[node.id];
    const showSnapPreview =
      activeSnapPreviewIds[node.id] &&
      previewPosition &&
      !arePointsEqual(previewPosition, displayPosition);
    const folderExpandState = getFolderExpandState?.(node) ?? 'hidden';
    const folderContents = resolveNodeFolderContents(node);

    return (
      <FileCanvasNode
        key={node.id}
        canResize={canResizeNode}
        displayPosition={displayPosition}
        displaySize={draftSizes[node.id] ?? node.size}
        draftIcon={draftIcons[node.id]}
        editingLabel={editingLabel}
        folderContents={folderContents}
        isContextMenuOpen={contextMenuNodeId === node.id}
        isDragging={dragNodeIdSet.has(node.id)}
        isEditing={editingNodeId === node.id}
        isResizing={resizeState?.nodeId === node.id}
        isWorkerConnectionTarget={workerConnectionDragState?.targetNodeId === node.id}
        resizeAxis={resizeState?.nodeId === node.id ? resizeState.axis : undefined}
        isSelected={selectedIdSet.has(node.id)}
        node={node}
        snapPreviewPosition={showSnapPreview ? previewPosition : undefined}
        onApplyIcon={applyNodeIcon}
        onApplyResize={applyNodeResize}
        onClearIconPreview={clearNodeIconPreview}
        onClearSizePreview={clearNodeSizePreview}
        onCommitRename={commitNodeRename}
        onContextMenu={openNodeContextMenu}
        onContextMenuOpenChange={setNodeContextMenuOpen}
        onDelete={deleteCanvasNode}
        onDownload={
          node.kind === 'file'
            ? onDownloadFileNode
            : node.kind === 'folder'
              ? onRequestDownloadFolderNode
              : undefined
        }
        onEditingLabelChange={setEditingLabel}
        onChangeWorkerFocus={
          node.kind === 'worker' && node.workerMode === 'ai-ready'
            ? (workerNode, focus) => {
                onUpdateNodeRef.current(workerNode.id, {
                  workerFocus: focus,
                  workerOutputFolderId: null,
                  workerStatus: 'idle',
                  workerProgress: 0,
                  workerInputSignature: null,
                  workerLastError: null,
                });
              }
            : undefined
        }
        onChangeWorkerRunMode={
          node.kind === 'worker' && node.workerMode === 'ai-ready'
            ? (workerNode, runMode) => {
                onUpdateNodeRef.current(workerNode.id, {
                  workerRunMode: runMode,
                  workerOutputFolderId: null,
                  workerStatus: 'idle',
                  workerProgress: 0,
                  workerInputSignature: null,
                  workerLastError: null,
                });
              }
            : undefined
        }
        onChangeWorkerOutputMode={
          node.kind === 'worker' && node.workerMode === 'ai-ready'
            ? (workerNode, outputMode) => {
                onUpdateNodeRef.current(workerNode.id, {
                  workerOutputMode: outputMode,
                  workerOutputFolderId: null,
                  workerStatus: 'idle',
                  workerProgress: 0,
                  workerInputSignature: null,
                  workerLastError: null,
                });
              }
            : undefined
        }
        onHoverChange={setNodeHover}
        onOpenPreview={openFloatingInspectorForNode}
        onPointerDown={handleNodePointerDown}
        onPreviewIcon={previewNodeIcon}
        onPreviewResize={previewNodeResize}
        onResizeHandlePointerDown={node.kind !== 'element' ? beginNodeResize : undefined}
        onRunWorker={
          node.kind === 'worker' && getWorkerModeMeta(node.workerMode).requiresManualRun
            ? (workerNode) => {
                void runAiWorker(workerNode.id);
              }
            : undefined
        }
        onSelectFolderContentItem={(item) => {
          if (getNodeById(item.id)) {
            const existingNode = getNodeById(item.id);

            if (existingNode) {
              selectSingleNode(item.id);

              if (existingNode.kind === 'file' || existingNode.kind === 'folder') {
                openFloatingInspectorForNode(existingNode);
              }
            }
            return;
          }

          openFloatingInspectorForItem(item);
        }}
        onSelect={selectSingleNode}
        onCollapseFolder={onCollapseFolder}
        onExpandFolder={onExpandFolder}
        folderExpandState={folderExpandState}
        onStartRename={startNodeRename}
        onStopRename={stopNodeRename}
        onWorkerInputHandlePointerDown={
          node.kind === 'worker' ? beginWorkerInputConnection : undefined
        }
      />
    );
  }

  useEffect(() => {
    if (
      hoveredConnectorId &&
      !connectorPaths.some((connector) => connector.id === hoveredConnectorId)
    ) {
      setHoveredConnectorId(null);
    }
  }, [connectorPaths, hoveredConnectorId]);

  function renderConnector(connector: ConnectorPath) {
    const isHovered = hoveredConnectorId === connector.id;
    const glowStroke = isHovered && connector.deletable
      ? 'rgba(244, 63, 94, 0.22)'
      : 'rgba(148, 163, 184, 0.18)';
    const lineStroke = isHovered && connector.deletable
      ? 'rgba(225, 29, 72, 0.88)'
      : 'rgba(100, 116, 139, 0.6)';

    return (
      <g key={connector.id}>
        <path
          d={connector.path}
          fill="none"
          stroke={glowStroke}
          strokeWidth={5}
          strokeLinecap="round"
        />
        <path
          d={connector.path}
          fill="none"
          stroke={lineStroke}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        {connector.deletable ? (
          <path
            d={connector.path}
            fill="none"
            stroke="transparent"
            strokeWidth={14}
            strokeLinecap="round"
            className="pointer-events-auto cursor-crosshair"
            onPointerEnter={() => setHoveredConnectorId(connector.id)}
            onPointerLeave={() =>
              setHoveredConnectorId((current) => (current === connector.id ? null : current))
            }
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              deleteConnector(connector);
            }}
          />
        ) : null}
      </g>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'flex h-full min-h-[34rem] overflow-hidden rounded-none border border-slate-200/80 bg-white/72 shadow-[0_36px_90px_-58px_rgba(15,23,42,0.22)] dark:border-slate-600/45 dark:bg-[rgba(30,41,59,0.56)] dark:shadow-[0_36px_90px_-58px_rgba(15,23,42,0.46)]',
          )}
        >
          <div
            ref={canvasRef}
            onContextMenu={handleCanvasContextMenu}
            onDragEnter={handleCanvasPaletteDragEnter}
            onDragOver={handleCanvasPaletteDragOver}
            onDragLeave={handleCanvasPaletteDragLeave}
            onDrop={handleCanvasPaletteDrop}
            onPointerLeave={() => {
              if (!contextMenuNodeId) {
                onHoverNodeChange(null);
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }

              if (
                (event.target as HTMLElement).closest('[data-canvas-node="true"]') ||
                (event.target as HTMLElement).closest('[data-canvas-chrome="true"]')
              ) {
                return;
              }

              event.preventDefault();

              if (event.shiftKey) {
                const localPoint = getLocalPoint(event.clientX, event.clientY);

                if (!localPoint) {
                  return;
                }

                beginMarqueeSelection(localPoint, true);
                return;
              }

              onSelectNodes([]);
              draftSelectedNodeIdsRef.current = [];
              setDraftSelectedNodeIds([]);
              const nextPanState = {
                origin: { x: event.clientX, y: event.clientY },
                baseViewport: viewport,
              };
              panStateRef.current = nextPanState;
              setPanState(nextPanState);
            }}
            className={cn(
              'canvas-surface relative min-w-0 flex-1 overflow-hidden touch-none',
              panState ? 'cursor-grabbing' : 'cursor-grab',
            )}
          >
            <FileCanvasFloatingToolbar
              draggedItemId={draggedPaletteTemplateId}
              structureItems={structurePaletteItems}
              workerItems={workerPaletteItems}
              onDragEndItem={clearPaletteDragState}
              onDragStartItem={handlePaletteItemDragStart}
              onInsertItem={handleInsertPaletteNode}
            />

            {isPaletteDragOverCanvas ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-4 z-20 rounded-[2rem] border border-dashed border-sky-300/80 bg-sky-100/18 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.22)]"
              />
            ) : null}

            {floatingInspector ? (
              <FileCanvasFloatingInspector
                rect={floatingInspector.window.rect}
                target={floatingInspector.target}
                isMinimized={floatingInspector.window.minimized}
                isMaximized={floatingInspector.window.maximized}
                phase={floatingInspector.phase}
                onClose={closeFloatingInspector}
                onHeaderPointerDown={handleFloatingInspectorHeaderPointerDown}
                onResizeHandlePointerDown={handleFloatingInspectorResizePointerDown}
                onTextChange={handleFloatingInspectorTextChange}
                onToggleMaximize={toggleFloatingInspectorMaximize}
                onToggleMinimize={toggleFloatingInspectorMinimize}
                onOpenItem={openFloatingInspectorForItem}
              />
            ) : null}

            <div
              className="absolute inset-0"
              style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0)` }}
            >
              {groupNodes.map((node) => renderCanvasNode(node))}
              {paletteDragPreview ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    NODE_CARD_CLASS,
                    'pointer-events-none z-30 border-slate-300/90 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.34)] opacity-95',
                    NODE_META[paletteDragPreview.node.kind].className,
                    paletteDragPreview.node.kind === 'group' && 'overflow-hidden',
                  )}
                  style={{
                    width: paletteDragPreview.dimensions.width,
                    height: paletteDragPreview.dimensions.height,
                    transform: `translate3d(${paletteDragPreview.bounds.left}px, ${paletteDragPreview.bounds.top}px, 0)`,
                  }}
                >
                  {paletteDragPreview.node.kind === 'group' ? (
                    <>
                      <div className="pointer-events-none absolute inset-px rounded-[15px] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(241,245,249,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),inset_0_0_0_1px_rgba(148,163,184,0.08)]" />
                      <div className="absolute left-4 right-4 top-4">
                        <div className="truncate text-sm font-medium text-slate-950 dark:text-white">
                          {paletteDragPreview.node.label}
                        </div>
                        <div className="mt-3 h-px bg-slate-300/90" />
                      </div>
                    </>
                  ) : paletteDragPreview.node.size.widthUnits === 1 ? (
                    <div className="flex h-full items-center justify-center p-0">
                      <span
                        className={cn(
                          'flex size-12 items-center justify-center',
                          paletteDragPreview.node.kind === 'worker'
                            ? 'text-slate-600 dark:text-white'
                            : paletteDragPreview.iconToneClassName,
                        )}
                      >
                        <paletteDragPreview.Icon className="size-7" />
                      </span>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col gap-3.5">
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className={cn(
                            'mt-0.5 flex size-10 shrink-0 items-center justify-center',
                            paletteDragPreview.node.kind === 'worker'
                              ? 'text-slate-600 dark:text-white'
                              : paletteDragPreview.iconToneClassName,
                          )}
                        >
                          <paletteDragPreview.Icon className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-slate-950 dark:text-white">
                            {paletteDragPreview.node.label}
                          </div>
                          {paletteDragPreview.node.description.trim().length > 0 ? (
                            <div className="mt-1 text-[12px] leading-5 text-slate-500 dark:text-white">
                              {paletteDragPreview.node.description}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
              {belowGroupConnectorPaths.length > 0 ? (
                <svg
                  aria-hidden="true"
                  className="absolute inset-0 overflow-visible"
                >
                  {belowGroupConnectorPaths.map((connector) => renderConnector(connector))}
                </svg>
              ) : null}
              {aboveGroupConnectorPaths.length > 0 ? (
                <svg
                  aria-hidden="true"
                  className="absolute inset-0 overflow-visible"
                >
                  {aboveGroupConnectorPaths.map((connector) => renderConnector(connector))}
                </svg>
              ) : null}
              {contentNodes.map((node) => renderCanvasNode(node))}
              {activeWorkerConnectionPreview ? (
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-visible"
                >
                  <g>
                    <path
                      d={activeWorkerConnectionPreview.path}
                      fill="none"
                      stroke="rgba(148, 163, 184, 0.18)"
                      strokeWidth={5}
                      strokeLinecap="round"
                    />
                    <path
                      d={activeWorkerConnectionPreview.path}
                      fill="none"
                      stroke="rgba(71, 85, 105, 0.78)"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                    />
                  </g>
                </svg>
              ) : null}

              {marqueeState ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute rounded-2xl border border-sky-400/50 bg-sky-400/10 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.18)]"
                  style={{
                    left: normalizeRectangle(marqueeState.origin, marqueeState.current).left,
                    top: normalizeRectangle(marqueeState.origin, marqueeState.current).top,
                    width:
                      normalizeRectangle(marqueeState.origin, marqueeState.current).right -
                      normalizeRectangle(marqueeState.origin, marqueeState.current).left,
                    height:
                      normalizeRectangle(marqueeState.origin, marqueeState.current).bottom -
                      normalizeRectangle(marqueeState.origin, marqueeState.current).top,
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="ml-2 w-52">
        <ContextMenuItem onSelect={handleAddAiWorker}>
          <BotIcon className="size-4" />
          Add AI worker
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleAddSortWorker}>
          <ArrowUpDownIcon className="size-4" />
          Add sort worker
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleAddGroup}>
          <ShapesIcon className="size-4" />
          Add group
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleAddBasicElement}>
          <PlusIcon className="size-4" />
          Add basic element
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
