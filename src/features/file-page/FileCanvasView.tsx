/**
 * FileCanvasView — the main freeform canvas view for a file or folder page.
 *
 * Orchestrates:
 *  - Canvas interaction (drag, pan, marquee, resize, worker connection)
 *  - Node rendering and connector SVG paths
 *  - Palette drag-and-drop for adding new nodes
 *  - Delegation to focused sub-hooks:
 *      useCanvasLayout  — spatial layout and snap computation
 *      useWorkerEngine  — worker node lifecycle and local sort processing
 *      useFloatingInspectors — floating file/folder inspector windows
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import {
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
  ShapesIcon,
} from 'lucide-react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import {
  CANVAS_PADDING,
  GRID_SIZE,
  GROUP_CONTENT_INSET_BOTTOM,
  GROUP_CONTENT_INSET_LEFT,
  GROUP_CONTENT_INSET_RIGHT,
  GROUP_CONTENT_INSET_TOP,
  GROUP_CONTENT_PADDING_BOTTOM,
  GROUP_CONTENT_PADDING_TOP,
  GROUP_CONTENT_PADDING_X,
  GROUP_MAX_GRID_UNITS,
  GROUP_MIN_GRID_UNITS,
  NODE_CARD_CLASS,
  SLOT_STEP_X,
  SLOT_STEP_Y,
} from './canvas/constants';
import type { CanvasPaletteTemplateId } from './canvas/CanvasPaletteSidebar';
import {
  FileCanvasFloatingInspector,
  type CanvasFloatingInspectorTab,
} from './canvas/FileCanvasFloatingInspector';
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
import {
  arePointsEqual,
  getConnectorPath,
  getPointBounds,
  hasCanvasPaletteTemplate,
  isCanvasPaletteTemplateId,
  pointIsWithinBounds,
  readCanvasPaletteTemplate,
  sortCanvasContentItems,
} from './canvas/canvasUtils';
import {
  areSizesEqual,
  buildCanvasPaletteNode,
  buildGroupNode,
  getMinimumNodeSize,
} from './canvas/nodeBuilders';
import { useCanvasLayout } from './canvas/useCanvasLayout';
import { useWorkerEngine } from './canvas/useWorkerEngine';
import { useFloatingInspectors } from './canvas/useFloatingInspectors';
import type {
  ConnectorPath,
  DragState,
  MarqueeState,
  PanState,
  ResizeState,
  WorkerConnectionDragState,
} from './canvas/canvasTypes';
import type {
  FilePageContentItem,
  FilePageElementIcon,
  FilePageNode,
  FilePageNodeSize,
  FilePageNodeUpdates,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';

const CANVAS_MIN_ZOOM = 0.35;
const CANVAS_MAX_ZOOM = 2.25;
const CANVAS_ZOOM_STEP = 0.15;

// ─── Props ────────────────────────────────────────────────────────────────────

interface FileCanvasViewProps {
  highlightedNodeIds?: string[];
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
  onOpenCanvasFile?: (fileId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FileCanvasView({
  nodes,
  highlightedNodeIds = [],
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
  onOpenCanvasFile,
}: FileCanvasViewProps) {
  // ── DOM ref ────────────────────────────────────────────────────────────────

  const canvasRef = useRef<HTMLDivElement | null>(null);

  // ── Interaction state refs (read in pointer handlers without re-render) ─────

  const dragStateRef = useRef<DragState | null>(null);
  const marqueeStateRef = useRef<MarqueeState | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const workerConnectionDragStateRef = useRef<WorkerConnectionDragState | null>(null);
  const nodeDragMovedRef = useRef(false);
  const marqueeMovedRef = useRef(false);
  const suppressPreviewOpenUntilRef = useRef(0);

  // ── Draft position / selection refs ───────────────────────────────────────

  const rawDragPositionsRef = useRef<Record<string, Point>>({});
  const draftPositionsRef = useRef<Record<string, Point>>({});
  const snapPreviewPositionsRef = useRef<Record<string, Point>>({});
  const activeSnapPreviewIdsRef = useRef<Record<string, boolean>>({});
  const draftSizesRef = useRef<Record<string, FilePageNode['size']>>({});
  const draftSelectedNodeIdsRef = useRef<string[] | null>(null);
  const contextMenuPointRef = useRef<Point | null>(null);

  // ── Stable node lookup ─────────────────────────────────────────────────────

  const nodesRef = useRef(nodes);
  const nodeMapRef = useRef(new Map(nodes.map((n) => [n.id, n])));

  // ── Viewport ───────────────────────────────────────────────────────────────

  const viewportRef = useRef<Point>({ x: 0, y: 0 });
  const zoomRef = useRef(1);

  // ── Stable callback refs (avoid stale closures in effects) ─────────────────

  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const contextMenuNodeIdRef = useRef<string | null>(null);
  const canvasContextMenuOpenRef = useRef(false);
  // Set when onOpenChange(false) fires (during pointerdown, before contextmenu fires).
  // Consumed in handleCanvasContextMenu to detect that a reopen is needed even though
  // canvasContextMenuOpenRef is already false by the time contextmenu fires.
  const canvasContextMenuJustClosedRef = useRef(false);
  const armedPrimaryOpenNodeIdRef = useRef<string | null>(null);
  const nodeClickShouldOpenRef = useRef(false);
  const editingNodeIdRef = useRef<string | null>(null);
  const editingLabelRef = useRef('');
  const onMoveNodesRef = useRef(onMoveNodes);
  const onResizeNodeRef = useRef(onResizeNode);
  const onAddNodeRef = useRef(onAddNode);
  const onUpdateNodeRef = useRef(onUpdateNode);
  const onDeleteNodeRef = useRef(onDeleteNode);
  const onHoverNodeChangeRef = useRef(onHoverNodeChange);
  const onSelectNodesRef = useRef(onSelectNodes);

  // ── Timer / frame refs ─────────────────────────────────────────────────────

  const releaseTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const resizeDraftFrameRef = useRef<number | null>(null);
  const marqueeFrameRef = useRef<number | null>(null);
  const workerConnectionFrameRef = useRef<number | null>(null);
  const paletteDragFrameRef = useRef<number | null>(null);
  const paletteDragDepthRef = useRef(0);
  const paletteDragPreviewPointRef = useRef<Point | null>(null);

  // ── React state ────────────────────────────────────────────────────────────

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [workerConnectionDragState, setWorkerConnectionDragState] =
    useState<WorkerConnectionDragState | null>(null);
  const [viewport, setViewport] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [draftPositions, setDraftPositions] = useState<Record<string, Point>>({});
  const [snapPreviewPositions, setSnapPreviewPositions] = useState<Record<string, Point>>({});
  const [activeSnapPreviewIds, setActiveSnapPreviewIds] = useState<Record<string, boolean>>({});
  const [draftSizes, setDraftSizes] = useState<Record<string, FilePageNode['size']>>({});
  const [draftIcons, setDraftIcons] = useState<Record<string, FilePageElementIcon>>({});
  const [draftSelectedNodeIds, setDraftSelectedNodeIds] = useState<string[] | null>(null);
  const [contextMenuNodeId, setContextMenuNodeId] = useState<string | null>(null);
  const [canvasContextMenuKey, setCanvasContextMenuKey] = useState(0);
  const [nodeContextMenuResetKey, setNodeContextMenuResetKey] = useState(0);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [hoveredConnectorId, setHoveredConnectorId] = useState<string | null>(null);
  const [draggedPaletteTemplateId, setDraggedPaletteTemplateId] =
    useState<CanvasPaletteTemplateId | null>(null);
  const [paletteDragPreviewPoint, setPaletteDragPreviewPoint] = useState<Point | null>(null);
  const [isPaletteDragOverCanvas, setIsPaletteDragOverCanvas] = useState(false);

  // ── Ref sync effects ───────────────────────────────────────────────────────

  useEffect(() => {
    nodesRef.current = nodes;
    nodeMapRef.current = new Map(nodes.map((n) => [n.id, n]));
  }, [nodes]);

  useEffect(() => { selectedNodeIdsRef.current = selectedNodeIds; }, [selectedNodeIds]);
  useEffect(() => { editingNodeIdRef.current = editingNodeId; }, [editingNodeId]);
  useEffect(() => { dragStateRef.current = dragState; }, [dragState]);
  useEffect(() => {
    if (marqueeFrameRef.current === null) {
      marqueeStateRef.current = marqueeState;
    }
  }, [marqueeState]);
  useEffect(() => { panStateRef.current = panState; }, [panState]);
  useEffect(() => { resizeStateRef.current = resizeState; }, [resizeState]);
  useEffect(() => {
    if (workerConnectionFrameRef.current === null) {
      workerConnectionDragStateRef.current = workerConnectionDragState;
    }
  }, [workerConnectionDragState]);
  useEffect(() => {
    if (frameRef.current === null && resizeDraftFrameRef.current === null) {
      draftPositionsRef.current = draftPositions;
    }
  }, [draftPositions]);
  useEffect(() => {
    if (resizeDraftFrameRef.current === null) {
      draftSizesRef.current = draftSizes;
    }
  }, [draftSizes]);
  useEffect(() => { snapPreviewPositionsRef.current = snapPreviewPositions; }, [snapPreviewPositions]);
  useEffect(() => { activeSnapPreviewIdsRef.current = activeSnapPreviewIds; }, [activeSnapPreviewIds]);
  useEffect(() => {
    if (marqueeFrameRef.current === null) {
      draftSelectedNodeIdsRef.current = draftSelectedNodeIds;
    }
  }, [draftSelectedNodeIds]);
  useEffect(() => {
    if (viewportFrameRef.current === null) {
      viewportRef.current = viewport;
    }
  }, [viewport]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { contextMenuNodeIdRef.current = contextMenuNodeId; }, [contextMenuNodeId]);
  useEffect(() => { editingLabelRef.current = editingLabel; }, [editingLabel]);

  useEffect(() => {
    onMoveNodesRef.current = onMoveNodes;
    onResizeNodeRef.current = onResizeNode;
    onAddNodeRef.current = onAddNode;
    onUpdateNodeRef.current = onUpdateNode;
    onDeleteNodeRef.current = onDeleteNode;
    onHoverNodeChangeRef.current = onHoverNodeChange;
    onSelectNodesRef.current = onSelectNodes;
  }, [onAddNode, onDeleteNode, onHoverNodeChange, onMoveNodes, onResizeNode, onSelectNodes, onUpdateNode]);

  const cancelScheduledFrame = useCallback((frame: MutableRefObject<number | null>) => {
    if (frame.current === null) return;
    window.cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const scheduleViewportCommit = useCallback(() => {
    if (viewportFrameRef.current !== null) return;
    viewportFrameRef.current = window.requestAnimationFrame(() => {
      viewportFrameRef.current = null;
      setViewport(viewportRef.current);
    });
  }, []);

  const applyCanvasZoom = useCallback(
    (nextZoomValue: number, anchorClientPoint?: Point) => {
      if (!canvasRef.current) return;

      const currentZoom = zoomRef.current;
      const nextZoom = Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, nextZoomValue));
      if (Math.abs(nextZoom - currentZoom) < 0.001) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const anchor = anchorClientPoint
        ? {
            x: anchorClientPoint.x - rect.left,
            y: anchorClientPoint.y - rect.top,
          }
        : {
            x: rect.width / 2,
            y: rect.height / 2,
          };
      const anchorWorld = {
        x: (anchor.x - viewportRef.current.x) / currentZoom,
        y: (anchor.y - viewportRef.current.y) / currentZoom,
      };

      viewportRef.current = {
        x: anchor.x - anchorWorld.x * nextZoom,
        y: anchor.y - anchorWorld.y * nextZoom,
      };
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      scheduleViewportCommit();
    },
    [scheduleViewportCommit],
  );

  const resetCanvasZoom = useCallback(() => {
    applyCanvasZoom(1);
  }, [applyCanvasZoom]);

  const scheduleResizeDraftCommit = useCallback(() => {
    if (resizeDraftFrameRef.current !== null) return;
    resizeDraftFrameRef.current = window.requestAnimationFrame(() => {
      resizeDraftFrameRef.current = null;
      setDraftSizes(draftSizesRef.current);
      setDraftPositions(draftPositionsRef.current);
    });
  }, []);

  const scheduleMarqueeCommit = useCallback(() => {
    if (marqueeFrameRef.current !== null) return;
    marqueeFrameRef.current = window.requestAnimationFrame(() => {
      marqueeFrameRef.current = null;
      setMarqueeState(marqueeStateRef.current);
      setDraftSelectedNodeIds(draftSelectedNodeIdsRef.current);
    });
  }, []);

  const scheduleWorkerConnectionCommit = useCallback(() => {
    if (workerConnectionFrameRef.current !== null) return;
    workerConnectionFrameRef.current = window.requestAnimationFrame(() => {
      workerConnectionFrameRef.current = null;
      setWorkerConnectionDragState(workerConnectionDragStateRef.current);
    });
  }, []);

  const schedulePalettePreviewCommit = useCallback((point: Point) => {
    paletteDragPreviewPointRef.current = point;
    if (paletteDragFrameRef.current !== null) return;
    paletteDragFrameRef.current = window.requestAnimationFrame(() => {
      paletteDragFrameRef.current = null;
      setPaletteDragPreviewPoint(paletteDragPreviewPointRef.current);
    });
  }, []);

  // ── Derived node lists ─────────────────────────────────────────────────────

  const renderedNodes = useMemo(
    () => [...nodes].sort((a, b) => (a.kind === 'group' ? 0 : 1) - (b.kind === 'group' ? 0 : 1)),
    [nodes],
  );

  const groupNodes = useMemo(() => renderedNodes.filter((n) => n.kind === 'group'), [renderedNodes]);
  const contentNodes = useMemo(() => renderedNodes.filter((n) => n.kind !== 'group'), [renderedNodes]);

  // Keep a ref to groupNodes for use inside stable pointer-event callbacks
  const groupNodesRef = useRef(groupNodes);
  useEffect(() => { groupNodesRef.current = groupNodes; }, [groupNodes]);

  // ── Display selection ──────────────────────────────────────────────────────

  const displaySelectedNodeIds = draftSelectedNodeIds ?? selectedNodeIds;
  const selectedIdSet = useMemo(() => new Set(displaySelectedNodeIds), [displaySelectedNodeIds]);
  const highlightedIdSet = useMemo(
    () => new Set(highlightedNodeIds),
    [highlightedNodeIds],
  );
  const dragNodeIdSet = useMemo(() => new Set(dragState?.nodeIds ?? []), [dragState?.nodeIds]);

  // ── Stable node lookup ─────────────────────────────────────────────────────

  const getNodeById = useCallback(
    (nodeId: string) => nodeMapRef.current.get(nodeId),
    [],
  );

  // ── Derived content maps ───────────────────────────────────────────────────

  /**
   * Maps each folder/worker node id to the list of content items it displays
   * in its card body (children + generated contentItems, deduped).
   */
  const folderContentsById = useMemo(() => {
    const entries: Record<string, FilePageContentItem[]> = {};

    renderedNodes.forEach((node) => {
      if (node.parentNodeId && (node.kind === 'folder' || node.kind === 'file')) {
        const existing = entries[node.parentNodeId] ?? [];
        existing.push({ id: node.id, kind: node.kind, label: node.label });
        entries[node.parentNodeId] = existing;
      }

      if (node.contentItems && node.contentItems.length > 0) {
        const existing = entries[node.id] ?? [];
        const dedupedById = new Map(existing.map((item) => [item.id, item]));
        node.contentItems.forEach((item) => {
          if (!dedupedById.has(item.id)) dedupedById.set(item.id, item);
        });
        entries[node.id] = sortCanvasContentItems([...dedupedById.values()]);
      }
    });

    Object.keys(entries).forEach((nodeId) => {
      entries[nodeId] = sortCanvasContentItems(entries[nodeId]);
    });

    return entries;
  }, [renderedNodes]);

  /**
   * Maps each worker node id to the file/folder nodes connected as its inputs
   * (excluding generated outputs).
   */
  const workerInputContentsById = useMemo(
    () => {
      const renderedNodeById = new Map(renderedNodes.map((node) => [node.id, node]));
      const entries = renderedNodes.reduce<Record<string, FilePageContentItem[]>>((acc, node) => {
        if (
          !node.parentNodeId ||
          (node.kind !== 'folder' && node.kind !== 'file') ||
          node.generatedByWorkerId === node.parentNodeId
        ) {
          return acc;
        }

        const parentNode = renderedNodeById.get(node.parentNodeId);
        if (!parentNode || parentNode.kind !== 'worker') return acc;

        const existing = acc[node.parentNodeId] ?? [];
        existing.push({ id: node.id, kind: node.kind, label: node.label });
        acc[node.parentNodeId] = existing;
        return acc;
      }, {});

      Object.keys(entries).forEach((nodeId) => {
        entries[nodeId] = sortCanvasContentItems(entries[nodeId]);
      });

      return entries;
    },
    [renderedNodes],
  );

  const filePreviewById = useMemo(() => {
    type FilePreview = { text: string | null; mimeType: string | null; fileId: string | null };
    if (!resolveCanvasFileItem && !resolveCanvasFileId) return {} as Record<string, FilePreview>;
    return renderedNodes.reduce<Record<string, FilePreview>>((acc, node) => {
      if (node.kind === 'file') {
        const item = resolveCanvasFileItem?.(node);
        const fileId = resolveCanvasFileId?.(node) ?? null;
        if (item?.textContent || fileId) {
          acc[node.id] = {
            text: item?.textContent ?? null,
            mimeType: item?.mimeType ?? null,
            fileId,
          };
        }
      }
      return acc;
    }, {});
  }, [renderedNodes, resolveCanvasFileId, resolveCanvasFileItem]);

  /** Resolves the content items displayed for a given canvas node. */
  const resolveNodeFolderContents = useCallback(
    (node: FilePageNode): FilePageContentItem[] => {
      const derivedContents = folderContentsById[node.id];
      const sourceContents = getFolderContents?.(node);

      if (node.kind === 'worker') return workerInputContentsById[node.id] ?? [];

      if (sourceContents && sourceContents.length > 0) return sourceContents;
      if (derivedContents && derivedContents.length > 0) return derivedContents;
      return node.contentItems ?? [];
    },
    [folderContentsById, getFolderContents, workerInputContentsById],
  );

  // ── Connector paths ────────────────────────────────────────────────────────

  const connectorPaths = useMemo((): ConnectorPath[] => {
    const nodeMap = new Map(renderedNodes.map((n) => [n.id, n]));

    return renderedNodes.flatMap((node) => {
      if (!node.parentNodeId) return [];

      const parentNode = nodeMap.get(node.parentNodeId);
      if (!parentNode) return [];

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
        } satisfies ConnectorPath,
      ];
    });
  }, [draftPositions, draftSizes, renderedNodes]);

  const belowGroupConnectorPaths = useMemo(
    () => connectorPaths.filter((c) => c.layer === 'below-group'),
    [connectorPaths],
  );
  const aboveGroupConnectorPaths = useMemo(
    () => connectorPaths.filter((c) => c.layer === 'above-group'),
    [connectorPaths],
  );

  // ── Sub-hooks ──────────────────────────────────────────────────────────────

  const layout = useCanvasLayout({
    nodesRef,
    groupNodesRef,
    draftPositionsRef,
    draftSizesRef,
    getNodeById,
  });

  const workerEngine = useWorkerEngine({
    nodes,
    nodesRef,
    draftPositionsRef,
    draftSizesRef,
    getNodeById,
    getGroupBounds: layout.getGroupBounds,
    onAddNodeRef,
    onUpdateNodeRef,
    onDeleteNodeRef,
    resolveCanvasFileItem,
    resolveCanvasFolderSourceFiles,
  });

  const centerNodesInGroup = useCallback(
    (groupId: string, nodeIds?: string[]) => {
      const groupNode = getNodeById(groupId);
      if (!groupNode || groupNode.kind !== 'group') return;

      const nodeIdSet = nodeIds ? new Set(nodeIds) : null;
      const groupBounds = layout.getGroupBounds(groupId, draftPositionsRef.current);
      if (!groupBounds) return;

      const targetNodes = nodesRef.current.filter(
        (node) =>
          node.groupId === groupId &&
          node.kind !== 'group' &&
          (!nodeIdSet || nodeIdSet.has(node.id)),
      );

      if (targetNodes.length === 0) return;

      const targetBounds = targetNodes.map((node) => ({
        node,
        position: draftPositionsRef.current[node.id] ?? node.position,
        size: draftSizesRef.current[node.id] ?? node.size,
      })).map(({ node, position, size }) => ({
        node,
        position,
        size,
        bounds: getNodeBoundsWithSize(position, size, node.kind),
      }));

      const layoutBounds = targetBounds.reduce(
        (bounds, entry) => ({
          left: Math.min(bounds.left, entry.bounds.left),
          top: Math.min(bounds.top, entry.bounds.top),
          right: Math.max(bounds.right, entry.bounds.right),
          bottom: Math.max(bounds.bottom, entry.bounds.bottom),
        }),
        {
          left: Number.POSITIVE_INFINITY,
          top: Number.POSITIVE_INFINITY,
          right: Number.NEGATIVE_INFINITY,
          bottom: Number.NEGATIVE_INFINITY,
        },
      );

      const layoutWidth = layoutBounds.right - layoutBounds.left;
      const layoutHeight = layoutBounds.bottom - layoutBounds.top;
      const groupWidth = groupBounds.right - groupBounds.left;
      const groupHeight = groupBounds.bottom - groupBounds.top;
      let offsetX = groupBounds.left + (groupWidth - layoutWidth) / 2 - layoutBounds.left;
      let offsetY = groupBounds.top + (groupHeight - layoutHeight) / 2 - layoutBounds.top;

      if (layoutWidth <= groupWidth) {
        if (layoutBounds.left + offsetX < groupBounds.left) {
          offsetX += groupBounds.left - (layoutBounds.left + offsetX);
        }
        if (layoutBounds.right + offsetX > groupBounds.right) {
          offsetX -= layoutBounds.right + offsetX - groupBounds.right;
        }
      }

      if (layoutHeight <= groupHeight) {
        if (layoutBounds.top + offsetY < groupBounds.top) {
          offsetY += groupBounds.top - (layoutBounds.top + offsetY);
        }
        if (layoutBounds.bottom + offsetY > groupBounds.bottom) {
          offsetY -= layoutBounds.bottom + offsetY - groupBounds.bottom;
        }
      }

      const nextPositions = targetBounds.reduce<Record<string, Point>>((positions, entry) => {
        positions[entry.node.id] = clampNodePositionToBounds(
          {
            x: entry.position.x + offsetX,
            y: entry.position.y + offsetY,
          },
          entry.size,
          groupBounds,
        );
        return positions;
      }, {});

      const movedPositions = Object.fromEntries(
        Object.entries(nextPositions).filter(([nodeId, position]) => {
          const node = getNodeById(nodeId);
          return node && !arePointsEqual(position, node.position);
        }),
      );

      if (Object.keys(movedPositions).length === 0) return;

      draftPositionsRef.current = {
        ...draftPositionsRef.current,
        ...movedPositions,
      };
      setDraftPositions((current) => ({
        ...current,
        ...movedPositions,
      }));
      onMoveNodesRef.current(movedPositions);
    },
    [getNodeById, layout],
  );

  const centerGroupContents = useCallback(
    (groupNode: FilePageNode) => {
      if (groupNode.kind !== 'group') return;
      centerNodesInGroup(groupNode.id);
    },
    [centerNodesInGroup],
  );

  const inspectors = useFloatingInspectors({
    canvasRef,
    suppressPreviewOpenUntilRef,
    getNodeById,
    resolveNodeFolderContents,
    resolveCanvasFileItem,
    resolveCanvasFileId,
    onUpdateWorkspaceFileContent,
  });

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(
    () => () => {
      onHoverNodeChange(null);
      if (releaseTimerRef.current !== null) window.clearTimeout(releaseTimerRef.current);
      cancelScheduledFrame(frameRef);
      cancelScheduledFrame(viewportFrameRef);
      cancelScheduledFrame(resizeDraftFrameRef);
      cancelScheduledFrame(marqueeFrameRef);
      cancelScheduledFrame(workerConnectionFrameRef);
      cancelScheduledFrame(paletteDragFrameRef);
    },
    [cancelScheduledFrame, onHoverNodeChange],
  );

  // ── Cancel editing when node disappears ───────────────────────────────────

  useEffect(() => {
    if (!editingNodeId) return;
    if (!nodes.find((n) => n.id === editingNodeId)) {
      setEditingNodeId(null);
      setEditingLabel('');
    }
  }, [editingNodeId, nodes]);

  // ── Escape key clears selection ────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || editingNodeIdRef.current) return;
      draftSelectedNodeIdsRef.current = null;
      onSelectNodesRef.current([]);
      setDraftSelectedNodeIds(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Position correction (push nodes out of groups they shouldn't be in) ───

  useEffect(() => {
    if (dragState || marqueeState || panState || resizeState) return;

    const nextPositions = nodes.reduce<Record<string, Point>>((positions, node) => {
      positions[node.id] = node.position;
      return positions;
    }, {});
    const correctedPositions: Record<string, Point> = {};

    // Clamp grouped nodes to their group's content bounds
    nodes
      .filter((n) => n.kind !== 'group')
      .forEach((node) => {
        const currentPos = nextPositions[node.id] ?? node.position;
        const parentBounds = node.groupId ? layout.getGroupBounds(node.groupId, nextPositions) : null;
        if (!parentBounds) return;

        const nextPos = clampNodePositionToBounds(currentPos, node.size, parentBounds);
        nextPositions[node.id] = nextPos;

        if (nextPos.x !== node.position.x || nextPos.y !== node.position.y) {
          correctedPositions[node.id] = nextPos;
        }
      });

    // Push ungrouped nodes out of any group they happen to overlap
    nodes
      .filter((n) => n.kind !== 'group' && !n.groupId)
      .forEach((node) => {
        const corrected = layout.pushDraggedLayoutsOutsideGroups(
          { [node.id]: nextPositions[node.id] ?? node.position },
          [node.id],
          new Map([[node.id, null]]),
        )[node.id];

        if (!corrected) return;
        nextPositions[node.id] = corrected;

        if (corrected.x !== node.position.x || corrected.y !== node.position.y) {
          correctedPositions[node.id] = corrected;
        }
      });

    if (Object.keys(correctedPositions).length > 0) {
      onMoveNodesRef.current(correctedPositions);
    }
  }, [dragState, layout, marqueeState, nodes, panState, resizeState]);

  // ── Coordinate helpers ─────────────────────────────────────────────────────

  const getLocalPoint = useCallback((clientX: number, clientY: number): Point | null => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewportRef.current.x) / zoomRef.current,
      y: (clientY - rect.top - viewportRef.current.y) / zoomRef.current,
    };
  }, []);

  // ── Wheel scroll ───────────────────────────────────────────────────────────

  const handleCanvasWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (
      dragStateRef.current ||
      marqueeStateRef.current ||
      panStateRef.current ||
      resizeStateRef.current ||
      workerConnectionDragStateRef.current
    ) {
      return;
    }
    if ((event.target as HTMLElement).closest('[data-canvas-chrome="true"]')) return;

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();

      const delta = event.deltaY;
      const zoomMultiplier = Math.exp(-delta * 0.002);
      applyCanvasZoom(zoomRef.current * zoomMultiplier, { x: event.clientX, y: event.clientY });
      return;
    }

    let deltaX = event.deltaX;
    let deltaY = event.deltaY;

    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      deltaX *= 16;
      deltaY *= 16;
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      const h = canvasRef.current?.clientHeight ?? 1;
      deltaX *= h;
      deltaY *= h;
    }

    if (deltaX === 0 && deltaY === 0) return;

    event.preventDefault();
    event.stopPropagation();
    viewportRef.current = {
      x: viewportRef.current.x - deltaX,
      y: viewportRef.current.y - deltaY,
    };
    scheduleViewportCommit();
  }, [applyCanvasZoom, scheduleViewportCommit]);

  // ── Worker connection helpers ──────────────────────────────────────────────

  const getWorkerInputHandlePoint = useCallback(
    (workerId: string): Point | null => {
      const workerNode = getNodeById(workerId);
      if (!workerNode || workerNode.kind !== 'worker') return null;

      const bounds = getNodeBoundsWithSize(
        draftPositionsRef.current[workerId] ?? workerNode.position,
        draftSizesRef.current[workerId] ?? workerNode.size,
        workerNode.kind,
      );
      return { x: bounds.left - 8, y: (bounds.top + bounds.bottom) / 2 };
    },
    [getNodeById],
  );

  const getWorkerInputDropTarget = useCallback(
    (workerId: string, point: Point): string | null => {
      const workerNode = getNodeById(workerId);
      if (!workerNode || workerNode.kind !== 'worker') return null;

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

        if (!pointIsWithinBounds(point, candidateBounds)) return;

        const candidateCenterX = (candidateBounds.left + candidateBounds.right) / 2;
        if (candidateCenterX > workerCenterX + SLOT_STEP_X * 0.15) return;

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
    },
    [getNodeById],
  );

  // ── Active worker connection preview ───────────────────────────────────────

  const activeWorkerConnectionPreview = useMemo(() => {
    if (!workerConnectionDragState) return null;

    const handlePoint = getWorkerInputHandlePoint(workerConnectionDragState.workerId);
    if (!handlePoint) return null;

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
  }, [draftPositions, draftSizes, getNodeById, getWorkerInputHandlePoint, workerConnectionDragState]);

  // ── Marquee selection ──────────────────────────────────────────────────────

  const beginMarqueeSelection = useCallback((localPoint: Point, additive: boolean) => {
    const initialSelection = additive
      ? (draftSelectedNodeIdsRef.current ?? selectedNodeIdsRef.current)
      : [];

    const nextMarquee: MarqueeState = {
      origin: localPoint,
      current: localPoint,
      additive,
      initialSelection,
    };

    panStateRef.current = null;
    resizeStateRef.current = null;
    dragStateRef.current = null;
    workerConnectionDragStateRef.current = null;
    setPanState(null);
    setResizeState(null);
    setDragState(null);
    setWorkerConnectionDragState(null);
    marqueeStateRef.current = nextMarquee;
    setMarqueeState(nextMarquee);
    marqueeMovedRef.current = false;
    draftSelectedNodeIdsRef.current = initialSelection;
    setDraftSelectedNodeIds(initialSelection);
  }, []);

  // ── Node pointer-down (begins drag) ───────────────────────────────────────

  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, node: FilePageNode) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const localPoint = getLocalPoint(event.clientX, event.clientY);
      if (!localPoint) return;

      if (event.shiftKey) {
        armedPrimaryOpenNodeIdRef.current = null;
        nodeClickShouldOpenRef.current = false;
        const currentSelection = draftSelectedNodeIdsRef.current ?? selectedNodeIdsRef.current;
        const nextSelection = currentSelection.includes(node.id)
          ? currentSelection.filter((nodeId) => nodeId !== node.id)
          : [...currentSelection, node.id];
        onPreviewContentItemChange?.(null);
        onSelectNodesRef.current(nextSelection);
        draftSelectedNodeIdsRef.current = nextSelection;
        setDraftSelectedNodeIds(nextSelection);
        return;
      }

      const currentSelection = draftSelectedNodeIdsRef.current ?? selectedNodeIdsRef.current;
      const currentSelectionSet = new Set(currentSelection);
      nodeClickShouldOpenRef.current =
        armedPrimaryOpenNodeIdRef.current === node.id &&
        currentSelection.length === 1 &&
        currentSelectionSet.has(node.id);
      const nextSelectedIds =
        currentSelectionSet.has(node.id) && currentSelection.length > 1
          ? currentSelection
          : [node.id];
      const nextDragNodeIds = layout.expandDragNodeIds(nextSelectedIds);

      onSelectNodesRef.current([]);
      setDraftSelectedNodeIds([]);
      draftSelectedNodeIdsRef.current = [];

      const nextDragState: DragState = {
        nodeIds: nextDragNodeIds,
        selectedNodeIds: nextSelectedIds,
        origin: localPoint,
        basePositions: nextDragNodeIds.reduce<Record<string, Point>>((positions, nodeId) => {
          const selectedNode = getNodeById(nodeId);
          if (selectedNode) positions[nodeId] = selectedNode.position;
          return positions;
        }, {}),
      };

      nodeDragMovedRef.current = false;
      dragStateRef.current = nextDragState;
      setDragState(nextDragState);
    },
    [getLocalPoint, getNodeById, layout, onPreviewContentItemChange],
  );

  // ── Canvas context menu point ──────────────────────────────────────────────

  function findCanvasNodeElement(nodeId: string) {
    const candidates = canvasRef.current?.querySelectorAll<HTMLElement>('[data-canvas-node-id]');

    return Array.from(candidates ?? []).find(
      (candidate) => candidate.dataset.canvasNodeId === nodeId,
    ) ?? null;
  }

  function dispatchContextMenuAt(target: HTMLElement, clientX: number, clientY: number) {
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        button: 2,
        buttons: 2,
      }),
    );
  }

  function closeAndReopenCanvasContextMenu(
    clientX: number,
    clientY: number,
    targetNodeId?: string,
  ) {
    canvasContextMenuOpenRef.current = false;
    contextMenuNodeIdRef.current = null;

    setContextMenuNodeId(null);
    setCanvasContextMenuKey((current) => current + 1);
    setNodeContextMenuResetKey((current) => current + 1);

    window.requestAnimationFrame(() => {
      const target = targetNodeId ? findCanvasNodeElement(targetNodeId) : canvasRef.current;

      if (target) {
        dispatchContextMenuAt(target, clientX, clientY);
      }
    });
  }

  function handleCanvasContextMenu(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      (event.target as HTMLElement).closest('[data-canvas-node="true"]') ||
      (event.target as HTMLElement).closest('[data-canvas-chrome="true"]')
    ) {
      return;
    }

    contextMenuPointRef.current = getLocalPoint(event.clientX, event.clientY);

    // Radix's DismissableLayer fires on pointerdown (capture phase, before contextmenu),
    // so canvasContextMenuOpenRef is already false by the time this handler runs.
    // canvasContextMenuJustClosedRef bridges that gap: it's set in onOpenChange(false)
    // and consumed here to detect that a force-reopen is needed.
    const needsReopen = canvasContextMenuJustClosedRef.current || contextMenuNodeIdRef.current !== null;
    canvasContextMenuJustClosedRef.current = false;

    if (!needsReopen) {
      return;
    }

    event.preventDefault();
    closeAndReopenCanvasContextMenu(event.clientX, event.clientY);
  }

  // ── Worker connection drag ─────────────────────────────────────────────────

  const beginWorkerInputConnection = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>, node: FilePageNode) => {
      if (event.button !== 0 || node.kind !== 'worker') return;
      event.preventDefault();
      event.stopPropagation();

      const localPoint = getLocalPoint(event.clientX, event.clientY);
      const handlePoint = getWorkerInputHandlePoint(node.id);
      if (!localPoint || !handlePoint) return;

      const nextState: WorkerConnectionDragState = {
        workerId: node.id,
        current: localPoint,
        targetNodeId: getWorkerInputDropTarget(node.id, localPoint),
      };

      setContextMenuNodeId(null);
      selectSingleNode(node.id);
      workerConnectionDragStateRef.current = nextState;
      setWorkerConnectionDragState(nextState);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getLocalPoint, getWorkerInputDropTarget, getWorkerInputHandlePoint],
  );

  // ── Global pointer move / up ───────────────────────────────────────────────

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const liveDrag = dragStateRef.current;
      const liveMarquee = marqueeStateRef.current;
      const livePan = panStateRef.current;
      const liveResize = resizeStateRef.current;
      const liveWorkerConn = workerConnectionDragStateRef.current;

      if (!liveDrag && !liveMarquee && !livePan && !liveResize && !liveWorkerConn) return;

      // ── Resize ────────────────────────────────────────────────────────────

      if (liveResize) {
        const resizingNode = getNodeById(liveResize.nodeId);
        const localPoint = getLocalPoint(event.clientX, event.clientY);
        if (!resizingNode || !localPoint) return;

        const baseDimensions = getNodeDimensionsForKind(liveResize.baseSize, resizingNode.kind);
        const currentSize = draftSizesRef.current[resizingNode.id] ?? resizingNode.size;
        const resizesWidth =
          liveResize.axis === 'left' ||
          liveResize.axis === 'right' ||
          liveResize.axis === 'top-left' ||
          liveResize.axis === 'bottom-right';
        const resizesHeight =
          liveResize.axis === 'top' ||
          liveResize.axis === 'bottom' ||
          liveResize.axis === 'top-left' ||
          liveResize.axis === 'bottom-right';
        const resizeFromLeft = liveResize.axis === 'left' || liveResize.axis === 'top-left';
        const resizeFromTop = liveResize.axis === 'top' || liveResize.axis === 'top-left';

        const getResizePosition = (size: FilePageNode['size']): Point => {
          const dims = getNodeDimensionsForKind(size, resizingNode.kind);
          return {
            x: liveResize.basePosition.x + (resizeFromLeft ? baseDimensions.width - dims.width : 0),
            y: liveResize.basePosition.y + (resizeFromTop ? baseDimensions.height - dims.height : 0),
          };
        };

        const candidateSize: FilePageNode['size'] = {
          widthUnits: !resizesWidth
            ? currentSize.widthUnits
            : getUnitsForDimension(
                baseDimensions.width +
                  (resizeFromLeft
                    ? liveResize.origin.x - localPoint.x
                    : localPoint.x - liveResize.origin.x),
                SLOT_STEP_X,
                liveResize.minimumSize.widthUnits,
                resizingNode.kind === 'group' ? GROUP_MAX_GRID_UNITS : undefined,
              ),
          heightUnits: !resizesHeight
            ? currentSize.heightUnits
            : getUnitsForDimension(
                baseDimensions.height +
                  (resizeFromTop
                    ? liveResize.origin.y - localPoint.y
                    : localPoint.y - liveResize.origin.y),
                SLOT_STEP_Y,
                liveResize.minimumSize.heightUnits,
                resizingNode.kind === 'group' ? GROUP_MAX_GRID_UNITS : undefined,
              ),
        };

        const fallbackSizes: FilePageNode['size'][] = [
          candidateSize,
          ...(resizesWidth && resizesHeight
            ? [
                { widthUnits: candidateSize.widthUnits, heightUnits: currentSize.heightUnits },
                { widthUnits: currentSize.widthUnits, heightUnits: candidateSize.heightUnits },
              ]
            : []),
        ];

        const nextSize = fallbackSizes.find((size) => {
          const pos = getResizePosition(size);
          return areSizesEqual(size, currentSize) || canResizeNode(resizingNode.id, size, pos);
        });

        if (!nextSize || areSizesEqual(nextSize, currentSize)) return;

        const nextPosition = getResizePosition(nextSize);
        draftSizesRef.current = { ...draftSizesRef.current, [resizingNode.id]: nextSize };
        draftPositionsRef.current = { ...draftPositionsRef.current, [resizingNode.id]: nextPosition };
        scheduleResizeDraftCommit();
        return;
      }

      // ── Pan ───────────────────────────────────────────────────────────────

      if (livePan) {
        viewportRef.current = {
          x: livePan.baseViewport.x + (event.clientX - livePan.origin.x),
          y: livePan.baseViewport.y + (event.clientY - livePan.origin.y),
        };
        scheduleViewportCommit();
        return;
      }

      const localPoint = getLocalPoint(event.clientX, event.clientY);
      if (!localPoint) return;

      // ── Worker connection ─────────────────────────────────────────────────

      if (liveWorkerConn) {
        const nextState: WorkerConnectionDragState = {
          workerId: liveWorkerConn.workerId,
          current: localPoint,
          targetNodeId: getWorkerInputDropTarget(liveWorkerConn.workerId, localPoint),
        };
        workerConnectionDragStateRef.current = nextState;
        scheduleWorkerConnectionCommit();
        return;
      }

      // ── Node drag ─────────────────────────────────────────────────────────

      if (liveDrag) {
        if (
          !nodeDragMovedRef.current &&
          (Math.abs(localPoint.x - liveDrag.origin.x) > 3 ||
            Math.abs(localPoint.y - liveDrag.origin.y) > 3)
        ) {
          nodeDragMovedRef.current = true;
        }

        const dragNodeIdSet = new Set(liveDrag.nodeIds);

        // Raw position from pointer delta
        let rawNextPositions = liveDrag.nodeIds.reduce<Record<string, Point>>(
          (positions, nodeId) => {
            const base = liveDrag.basePositions[nodeId];
            positions[nodeId] = {
              x: clampToCanvas(base.x + (localPoint.x - liveDrag.origin.x)),
              y: clampToCanvas(base.y + (localPoint.y - liveDrag.origin.y)),
            };
            return positions;
          },
          {},
        );

        // Constrain nodes that are in the same group branch
        const draggedBranchNodeIds = liveDrag.nodeIds.reduce<Map<string, string[]>>(
          (branches, nodeId) => {
            let currentNode = getNodeById(nodeId);
            let branchRootId = nodeId;

            while (currentNode?.parentNodeId && dragNodeIdSet.has(currentNode.parentNodeId)) {
              branchRootId = currentNode.parentNodeId;
              currentNode = getNodeById(currentNode.parentNodeId);
            }

            const existing = branches.get(branchRootId) ?? [];
            existing.push(nodeId);
            branches.set(branchRootId, existing);
            return branches;
          },
          new Map(),
        );

        draggedBranchNodeIds.forEach((branchNodeIds) => {
          const branchGroupId = branchNodeIds.reduce<string | null>((groupId, nodeId) => {
            if (groupId) return groupId;
            return getNodeById(nodeId)?.groupId ?? null;
          }, null);

          if (!branchGroupId) return;

          const groupNode = getNodeById(branchGroupId);
          const groupContentBounds = layout.getGroupBounds(branchGroupId, rawNextPositions);
          if (!groupNode || !groupContentBounds) return;

          const groupOuterBounds = getNodeBoundsWithSize(
            rawNextPositions[groupNode.id] ?? groupNode.position,
            draftSizesRef.current[groupNode.id] ?? groupNode.size,
            groupNode.kind,
          );
          const layoutBounds = layout.getLayoutBounds(rawNextPositions, branchNodeIds);
          if (!layoutBounds || !rectanglesIntersect(layoutBounds, groupOuterBounds)) return;

          rawNextPositions = layout.constrainNodeLayoutToBounds(
            rawNextPositions,
            branchNodeIds,
            groupContentBounds,
          );
        });

        const nextDraftPositions = { ...rawNextPositions };
        const candidateGroupIds = new Map<string, string | null>();

        liveDrag.nodeIds.forEach((nodeId) => {
          const movingNode = getNodeById(nodeId);
          if (
            !movingNode ||
            movingNode.kind === 'group' ||
            (movingNode.groupId && dragNodeIdSet.has(movingNode.groupId))
          ) {
            return;
          }

          const lockedGroupId = layout.getLockedConnectedGroupId(movingNode, candidateGroupIds);
          const detectedGroupId = layout.findContainingGroupId(
            movingNode,
            rawNextPositions[nodeId],
            draftSizesRef.current[nodeId] ?? movingNode.size,
            rawNextPositions,
          );

          candidateGroupIds.set(nodeId, lockedGroupId !== undefined ? lockedGroupId : detectedGroupId);
        });

        // Second pass: ensure branch members share the same group candidate
        draggedBranchNodeIds.forEach((branchNodeIds) => {
          const branchGroupId = branchNodeIds.reduce<string | null>((groupId, nodeId) => {
            if (groupId) return groupId;
            return candidateGroupIds.get(nodeId) ?? getNodeById(nodeId)?.groupId ?? null;
          }, null);

          if (!branchGroupId) return;

          const groupBounds = layout.getGroupBounds(branchGroupId, rawNextPositions);
          const layoutBounds = layout.getLayoutBounds(rawNextPositions, branchNodeIds);

          if (
            !groupBounds ||
            !layoutBounds ||
            layoutBounds.left < groupBounds.left ||
            layoutBounds.top < groupBounds.top ||
            layoutBounds.right > groupBounds.right ||
            layoutBounds.bottom > groupBounds.bottom
          ) {
            return;
          }

          branchNodeIds.forEach((nodeId) => candidateGroupIds.set(nodeId, branchGroupId));
        });

        const constrainedGroupResult = layout.constrainDraggedLayoutsToTargetGroups(
          nextDraftPositions,
          liveDrag.nodeIds,
          candidateGroupIds,
        );

        const { candidateGroupIds: constrainedCandidateGroupIds } = constrainedGroupResult;
        const constrainedDraftPositions = constrainedGroupResult.positions;

        const desiredSnapPositions = liveDrag.nodeIds.reduce<Record<string, Point>>(
          (positions, nodeId) => {
            positions[nodeId] = constrainedDraftPositions[nodeId];
            return positions;
          },
          {},
        );

        const dragTargetGroupIds = liveDrag.nodeIds.map((nodeId) =>
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
            ? layout.getGroupBounds(sharedDragTargetGroupId, constrainedDraftPositions)
            : null;

        const sharedGroupSnapOrigin =
          sharedDragTargetBounds
            ? layout.getSharedGroupSnapOrigin(
                liveDrag.nodeIds,
                desiredSnapPositions,
                liveDrag.basePositions,
                constrainedCandidateGroupIds,
                sharedDragTargetGroupId!,
              )
            : null;

        const sharedOuterSnapTarget =
          sharedDragTargetBounds || sharedGroupSnapOrigin
            ? null
            : layout.getSharedOuterSnapOrigin(
                liveDrag.nodeIds,
                desiredSnapPositions,
                liveDrag.basePositions,
                constrainedCandidateGroupIds,
              );

        const nextActiveSnapPreviewIds = liveDrag.nodeIds.reduce<Record<string, boolean>>(
          (acc, nodeId) => {
            acc[nodeId] = true;
            return acc;
          },
          {},
        );

        const canShare = (leftNodeId: string, rightNodeId: string) =>
          layout.canNodesShareSpace(
            getNodeById(leftNodeId),
            getNodeById(rightNodeId),
            constrainedCandidateGroupIds,
          );
        const stationaryNodesForDrag = nodesRef.current.filter((n) => !dragNodeIdSet.has(n.id));
        const currentSizesById = Object.fromEntries(
          nodesRef.current.map((n) => [n.id, draftSizesRef.current[n.id] ?? n.size]),
        );

        const nextSnapPositions =
          sharedDragTargetBounds && sharedGroupSnapOrigin
            ? resolveSnapPositions(
                desiredSnapPositions,
                liveDrag.nodeIds,
                stationaryNodesForDrag,
                liveDrag.basePositions,
                currentSizesById,
                canShare,
                {
                  anchorGridOrigin: sharedGroupSnapOrigin,
                  constrainPosition: (position, nodeId) => {
                    const movingNode = getNodeById(nodeId);
                    if (!movingNode) {
                      return { x: clampToCanvas(position.x), y: clampToCanvas(position.y) };
                    }
                    if (
                      (constrainedCandidateGroupIds.get(nodeId) ?? null) !== sharedDragTargetGroupId
                    ) {
                      return null;
                    }
                    const clamped = clampNodePositionToBounds(
                      position,
                      draftSizesRef.current[nodeId] ?? movingNode.size,
                      sharedDragTargetBounds,
                    );
                    return clamped.x === position.x && clamped.y === position.y ? clamped : null;
                  },
                  getNodeKind: (nodeId) => getNodeById(nodeId)?.kind,
                },
              )
            : sharedDragTargetBounds
              ? desiredSnapPositions
              : sharedOuterSnapTarget
                ? resolveSnapPositions(
                    desiredSnapPositions,
                    liveDrag.nodeIds,
                    stationaryNodesForDrag,
                    liveDrag.basePositions,
                    currentSizesById,
                    canShare,
                    {
                      anchorGridOrigin: sharedOuterSnapTarget.gridOrigin,
                      preferredAnchorCandidates: sharedOuterSnapTarget.preferredAnchorCandidates,
                      toSnapPosition: (position, nodeId) => {
                        const n = getNodeById(nodeId);
                        return n?.kind === 'group'
                          ? { x: position.x - GROUP_CONTENT_INSET_LEFT, y: position.y - GROUP_CONTENT_INSET_TOP }
                          : position;
                      },
                      fromSnapPosition: (position, nodeId) => {
                        const n = getNodeById(nodeId);
                        return n?.kind === 'group'
                          ? { x: position.x + GROUP_CONTENT_INSET_LEFT, y: position.y + GROUP_CONTENT_INSET_TOP }
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

        const predictiveLandingPositions = layout.pushDraggedLayoutsOutsideGroups(
          nextSnapPositions,
          liveDrag.nodeIds,
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

      // ── Marquee ───────────────────────────────────────────────────────────

      if (!liveMarquee) return;

      const nextMarquee = { ...liveMarquee, current: localPoint };
      if (
        !marqueeMovedRef.current &&
        (Math.abs(localPoint.x - liveMarquee.origin.x) > 3 ||
          Math.abs(localPoint.y - liveMarquee.origin.y) > 3)
      ) {
        marqueeMovedRef.current = true;
      }
      const marqueeRect = normalizeRectangle(liveMarquee.origin, localPoint);
      const intersectingIds = nodesRef.current
        .filter((node) => {
          const position = draftPositionsRef.current[node.id] ?? node.position;
          const size = draftSizesRef.current[node.id] ?? node.size;
          return rectanglesIntersect(marqueeRect, getNodeBoundsWithSize(position, size, node.kind));
        })
        .map((n) => n.id);
      const nextSelectedIds = liveMarquee.additive
        ? Array.from(new Set([...liveMarquee.initialSelection, ...intersectingIds]))
        : intersectingIds;

      marqueeStateRef.current = nextMarquee;
      draftSelectedNodeIdsRef.current = nextSelectedIds;
      scheduleMarqueeCommit();
    };

    // ── Pointer up ────────────────────────────────────────────────────────────

    const handlePointerUp = () => {
      const liveDrag = dragStateRef.current;
      const liveMarquee = marqueeStateRef.current;
      const liveSnapPreviewPositions = snapPreviewPositionsRef.current;
      const liveResize = resizeStateRef.current;
      const liveWorkerConn = workerConnectionDragStateRef.current;

      if (viewportFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportFrameRef.current);
        viewportFrameRef.current = null;
        setViewport(viewportRef.current);
      }
      cancelScheduledFrame(frameRef);
      cancelScheduledFrame(resizeDraftFrameRef);
      cancelScheduledFrame(marqueeFrameRef);
      cancelScheduledFrame(workerConnectionFrameRef);

      // Commit worker connection
      if (liveWorkerConn?.targetNodeId) {
        const targetNode = getNodeById(liveWorkerConn.targetNodeId);
        if (targetNode && (targetNode.parentNodeId ?? null) !== liveWorkerConn.workerId) {
          onUpdateNodeRef.current(targetNode.id, { parentNodeId: liveWorkerConn.workerId });
        }
      }

      // Commit final drag positions
      if (liveDrag && Object.keys(liveSnapPreviewPositions).length > 0) {
        const finalSnapPositions = { ...liveSnapPreviewPositions };
        const nextGroupIds = new Map<string, string | null>();
        const rawNextPositions = rawDragPositionsRef.current;
        const nextPositions = nodesRef.current.reduce<Record<string, Point>>((positions, node) => {
          positions[node.id] = finalSnapPositions[node.id] ?? node.position;
          return positions;
        }, {});

        liveDrag.nodeIds.forEach((nodeId) => {
          const node = getNodeById(nodeId);
          if (!node || node.kind === 'group') return;

          const rawPos = rawNextPositions[nodeId] ?? nextPositions[nodeId];
          const previewPos = finalSnapPositions[nodeId] ?? nextPositions[nodeId];
          const lockedGroupId = layout.getLockedConnectedGroupId(node, nextGroupIds);
          const previewGroupId = layout.findContainingGroupId(
            node,
            previewPos,
            draftSizesRef.current[nodeId] ?? node.size,
            { ...nextPositions, [nodeId]: previewPos },
          );
          const nextGroupId =
            lockedGroupId !== undefined
              ? lockedGroupId
              : previewGroupId ??
                layout.findContainingGroupId(node, rawPos, draftSizesRef.current[nodeId] ?? node.size, {
                  ...nextPositions,
                  [nodeId]: rawPos,
                });

          nextGroupIds.set(node.id, nextGroupId);

          const parentBounds =
            typeof nextGroupId === 'string'
              ? layout.getGroupBounds(nextGroupId, nextPositions)
              : null;
          const desiredPosition =
            nextGroupId && parentBounds
              ? clampNodePositionToBounds(
                  previewPos,
                  draftSizesRef.current[nodeId] ?? node.size,
                  parentBounds,
                )
              : previewPos;

          finalSnapPositions[nodeId] = desiredPosition;
          nextPositions[nodeId] = desiredPosition;
        });

        const constrainedFinalResult = layout.constrainDraggedLayoutsToTargetGroups(
          finalSnapPositions,
          liveDrag.nodeIds,
          nextGroupIds,
        );

        const constrainedFinalPositions = layout.pushDraggedLayoutsOutsideGroups(
          constrainedFinalResult.positions,
          liveDrag.nodeIds,
          constrainedFinalResult.candidateGroupIds,
        );

        onMoveNodesRef.current(constrainedFinalPositions);
        draftPositionsRef.current = constrainedFinalPositions;
        setDraftPositions(constrainedFinalPositions);

        constrainedFinalResult.candidateGroupIds.forEach((nextGroupId, nodeId) => {
          const node = getNodeById(nodeId);
          if (node && (node.groupId ?? null) !== nextGroupId) {
            onUpdateNodeRef.current(node.id, { groupId: nextGroupId });
          }
        });

        layout
          .getDraggedWorkerConnectionAssignments(liveDrag.nodeIds, constrainedFinalPositions)
          .forEach((nextParentId, nodeId) => {
            const node = getNodeById(nodeId);
            if (node && (node.parentNodeId ?? null) !== nextParentId) {
              onUpdateNodeRef.current(node.id, { parentNodeId: nextParentId });
            }
          });
      }

      if (liveDrag && nodeDragMovedRef.current) {
        suppressPreviewOpenUntilRef.current = Date.now() + 180;
        armedPrimaryOpenNodeIdRef.current = null;
        nodeClickShouldOpenRef.current = false;
      }

      if (liveDrag && !nodeDragMovedRef.current) {
        onSelectNodesRef.current(liveDrag.selectedNodeIds);
        armedPrimaryOpenNodeIdRef.current =
          liveDrag.selectedNodeIds.length === 1 ? liveDrag.selectedNodeIds[0] : null;
      }

      if (liveMarquee && marqueeMovedRef.current) {
        suppressPreviewOpenUntilRef.current = Date.now() + 180;
        armedPrimaryOpenNodeIdRef.current = null;
        nodeClickShouldOpenRef.current = false;
      }

      // Commit resize
      if (liveResize) {
        const nextSize = draftSizesRef.current[liveResize.nodeId] ?? liveResize.baseSize;
        const nextPosition =
          draftPositionsRef.current[liveResize.nodeId] ?? liveResize.basePosition;

        if (!areSizesEqual(nextSize, liveResize.baseSize)) {
          if (!arePointsEqual(nextPosition, liveResize.basePosition)) {
            onMoveNodesRef.current({ [liveResize.nodeId]: nextPosition });
          }
          onResizeNodeRef.current(liveResize.nodeId, nextSize);
        }

        onSelectNodesRef.current([liveResize.nodeId]);
      }

      // Commit marquee selection
      if (liveMarquee) {
        onSelectNodesRef.current(
          draftSelectedNodeIdsRef.current ??
            (liveMarquee.additive ? liveMarquee.initialSelection : []),
        );
      }

      // Reset all interaction state
      panStateRef.current = null;
      resizeStateRef.current = null;
      workerConnectionDragStateRef.current = null;
      setPanState(null);
      setResizeState(null);
      setWorkerConnectionDragState(null);
      dragStateRef.current = null;
      nodeDragMovedRef.current = false;
      marqueeMovedRef.current = false;
      marqueeStateRef.current = null;
      draftSelectedNodeIdsRef.current = null;
      setDragState(null);
      setMarqueeState(null);
      setDraftSelectedNodeIds(null);

      if (releaseTimerRef.current !== null) window.clearTimeout(releaseTimerRef.current);

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
  }, []); // stable — all mutable state is read from refs

  // ── Node action helpers ────────────────────────────────────────────────────

  const selectSingleNode = useCallback(
    (nodeId: string) => {
      onPreviewContentItemChange?.(null);
      onSelectNodesRef.current([nodeId]);
      setDraftSelectedNodeIds([nodeId]);
    },
    [onPreviewContentItemChange],
  );

  const setNodeHover = useCallback((node: FilePageNode, hovered: boolean) => {
    if (!hovered && contextMenuNodeIdRef.current === node.id) return;
    onHoverNodeChangeRef.current(hovered ? node : null);
  }, []);

  const setNodeContextMenuOpen = useCallback((node: FilePageNode, open: boolean) => {
    if (open) {
      contextMenuNodeIdRef.current = node.id;
      setContextMenuNodeId(node.id);
      onHoverNodeChangeRef.current(node);
      return;
    }
    if (contextMenuNodeIdRef.current === node.id) {
      contextMenuNodeIdRef.current = null;
    }
    setContextMenuNodeId((c) => (c === node.id ? null : c));
    onHoverNodeChangeRef.current(null);
  }, []);

  const openNodeContextMenu = useCallback(
    (node: FilePageNode, event?: ReactMouseEvent<HTMLButtonElement>) => {
      if (event && (canvasContextMenuOpenRef.current || contextMenuNodeIdRef.current)) {
        event.preventDefault();
        closeAndReopenCanvasContextMenu(event.clientX, event.clientY, node.id);
        return;
      }

      contextMenuNodeIdRef.current = node.id;
      armedPrimaryOpenNodeIdRef.current = null;
      nodeClickShouldOpenRef.current = false;
      setContextMenuNodeId(node.id);
      onHoverNodeChangeRef.current(node);
      const currentSelection = draftSelectedNodeIdsRef.current ?? selectedNodeIdsRef.current;
      if (!currentSelection.includes(node.id)) {
        selectSingleNode(node.id);
      }
    },
    [selectSingleNode],
  );

  const openNodePrimaryAction = useCallback(
    (node: FilePageNode) => {
      if (Date.now() < suppressPreviewOpenUntilRef.current) {
        nodeClickShouldOpenRef.current = false;
        return;
      }

      if (!nodeClickShouldOpenRef.current || armedPrimaryOpenNodeIdRef.current !== node.id) {
        nodeClickShouldOpenRef.current = false;
        return;
      }

      nodeClickShouldOpenRef.current = false;

      if (node.kind === 'file') {
        const fileId = resolveCanvasFileId?.(node) ?? null;

        if (fileId && onOpenCanvasFile) {
          onOpenCanvasFile(fileId);
          return;
        }
      }

      if (node.kind === 'file' || node.kind === 'folder') {
        inspectors.openFloatingInspectorForNode(node);
      }
    },
    [inspectors, onOpenCanvasFile, resolveCanvasFileId],
  );

  // ── Node resize helpers ────────────────────────────────────────────────────

  const getResizePlacement = useCallback(
    (nodeId: string, size: FilePageNode['size'], positionOverride?: Point): Point | null => {
      const resizingNode = getNodeById(nodeId);
      if (!resizingNode) return null;

      const basePosition = resizingNode.position;
      const widthGrowth = Math.max(0, size.widthUnits - resizingNode.size.widthUnits);
      const heightGrowth = Math.max(0, size.heightUnits - resizingNode.size.heightUnits);

      const candidatePositions = positionOverride
        ? [positionOverride]
        : Array.from({ length: widthGrowth + 1 }, (_, leftShift) =>
            Array.from({ length: heightGrowth + 1 }, (_, upShift) => ({
              position: {
                x: basePosition.x - leftShift * SLOT_STEP_X,
                y: basePosition.y - upShift * SLOT_STEP_Y,
              },
              distance: leftShift + upShift,
            })),
          )
            .flat()
            .sort((a, b) => a.distance - b.distance)
            .map(({ position }) => position);

      for (const resizedPosition of candidatePositions) {
        if (resizingNode.kind === 'group') {
          const resizedContentBounds = getGroupContentBounds(resizedPosition, size);
          const childFitsWithinGroup = nodesRef.current
            .filter((n) => n.groupId === resizingNode.id)
            .every((n) => {
              const childBounds = getNodeBoundsWithSize(
                draftPositionsRef.current[n.id] ?? n.position,
                draftSizesRef.current[n.id] ?? n.size,
                n.kind,
              );
              return (
                childBounds.left >= resizedContentBounds.left &&
                childBounds.top >= resizedContentBounds.top &&
                childBounds.right <= resizedContentBounds.right &&
                childBounds.bottom <= resizedContentBounds.bottom
              );
            });

          if (!childFitsWithinGroup) continue;
        }

        if (resizingNode.groupId) {
          const parentBounds = layout.getGroupBounds(resizingNode.groupId, draftPositionsRef.current);
          if (!parentBounds) continue;

          const clamped = clampNodePositionToBounds(resizedPosition, size, parentBounds);
          if (clamped.x !== resizedPosition.x || clamped.y !== resizedPosition.y) continue;
        }

        const resizedBounds = getNodeBoundsWithSize(resizedPosition, size, resizingNode.kind);
        const collides = nodesRef.current
          .filter((n) => n.id !== nodeId)
          .some((n) => {
            const otherBounds = getNodeBoundsWithSize(
              draftPositionsRef.current[n.id] ?? n.position,
              draftSizesRef.current[n.id] ?? n.size,
              n.kind,
            );
            return !layout.canNodesShareSpace(resizingNode, n) && boundsOverlap(resizedBounds, otherBounds);
          });

        if (!collides) return resizedPosition;
      }

      return null;
    },
    [getNodeById, layout],
  );

  const canResizeNode = useCallback(
    (nodeId: string, size: FilePageNode['size'], positionOverride?: Point): boolean =>
      Boolean(getResizePlacement(nodeId, size, positionOverride)),
    [getResizePlacement],
  );

  const previewNodeResize = useCallback(
    (node: FilePageNode, size: FilePageNode['size']) => {
      const placement = getResizePlacement(node.id, size);
      if (!placement) return;
      setDraftSizes((c) => ({ ...c, [node.id]: size }));
      setDraftPositions((c) => ({ ...c, [node.id]: placement }));
    },
    [getResizePlacement],
  );

  const applyNodeResize = useCallback(
    (node: FilePageNode, size: FilePageNode['size']) => {
      const placement = getResizePlacement(node.id, size);
      if (!placement) return;

      setDraftSizes((c) => {
        const next = { ...c };
        delete next[node.id];
        return next;
      });
      setDraftPositions((c) => {
        const next = { ...c };
        delete next[node.id];
        return next;
      });

      if (!arePointsEqual(placement, node.position)) {
        onMoveNodesRef.current({ [node.id]: placement });
      }
      onResizeNodeRef.current(node.id, size);
      onSelectNodesRef.current([node.id]);
    },
    [getResizePlacement],
  );

  const previewNodeIcon = useCallback((node: FilePageNode, icon: FilePageElementIcon) => {
    if (node.kind !== 'element') return;
    setDraftIcons((c) => ({ ...c, [node.id]: icon }));
  }, []);

  const applyNodeIcon = useCallback(
    (node: FilePageNode, icon: FilePageElementIcon) => {
      if (node.kind !== 'element') return;
      setDraftIcons((c) => {
        const next = { ...c };
        delete next[node.id];
        return next;
      });
      onUpdateNodeRef.current(node.id, { icon });
      onSelectNodesRef.current([node.id]);
    },
    [],
  );

  const clearNodeSizePreview = useCallback((nodeId?: string) => {
    if (!nodeId) {
      setDraftSizes({});
      setDraftPositions({});
      return;
    }
    setDraftSizes((c) => {
      if (!(nodeId in c)) return c;
      const next = { ...c };
      delete next[nodeId];
      return next;
    });
    setDraftPositions((c) => {
      if (!(nodeId in c)) return c;
      const next = { ...c };
      delete next[nodeId];
      return next;
    });
  }, []);

  const clearNodeIconPreview = useCallback((nodeId?: string) => {
    if (!nodeId) {
      setDraftIcons({});
      return;
    }
    setDraftIcons((c) => {
      if (!(nodeId in c)) return c;
      const next = { ...c };
      delete next[nodeId];
      return next;
    });
  }, []);

  // ── Node rename ────────────────────────────────────────────────────────────

  const startNodeRename = useCallback((node: FilePageNode) => {
    setEditingNodeId(node.id);
    setEditingLabel(node.label);
    onSelectNodesRef.current([node.id]);
  }, []);

  const commitNodeRename = useCallback((node: FilePageNode) => {
    const nextLabel = editingLabelRef.current.trim();
    if (nextLabel) onUpdateNodeRef.current(node.id, { label: nextLabel });
    setEditingNodeId(null);
    setEditingLabel('');
  }, []);

  const stopNodeRename = useCallback(() => {
    setEditingNodeId(null);
    setEditingLabel('');
  }, []);

  // ── Begin resize (pointer-down on resize handle) ───────────────────────────

  const beginNodeResize = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>, node: FilePageNode, axis: GroupResizeAxis) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const localPoint = getLocalPoint(event.clientX, event.clientY);
      if (!localPoint) return;

      const nextResizeState: ResizeState = {
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
      setDraftSizes((c) => ({ ...c, [node.id]: nextResizeState.baseSize }));
      setDraftPositions((c) => ({ ...c, [node.id]: nextResizeState.basePosition }));
    },
    [getLocalPoint, selectSingleNode],
  );

  // ── Delete connector ───────────────────────────────────────────────────────

  const deleteConnector = useCallback(
    (connector: ConnectorPath) => {
      if (!connector.deletable) return;
      const childNode = getNodeById(connector.childNodeId);
      if (!childNode || childNode.parentNodeId !== connector.parentNodeId) return;

      setHoveredConnectorId((c) => (c === connector.id ? null : c));
      onPreviewContentItemChange?.(null);
      onUpdateNodeRef.current(childNode.id, { parentNodeId: null });
    },
    [getNodeById, onPreviewContentItemChange],
  );

  // ── Delete node ────────────────────────────────────────────────────────────

  const deleteCanvasNode = useCallback(
    (node: FilePageNode) => {
      if (node.kind === 'worker') {
        workerEngine.cancelWorkerRequest(node.id);
        workerEngine.clearWorkerProcessTimer(node.id);

        nodesRef.current
          .filter((candidate) => candidate.parentNodeId === node.id)
          .forEach((candidate) => {
            onUpdateNodeRef.current(candidate.id, {
              parentNodeId: null,
              ...(candidate.generatedByWorkerId === node.id ? { generatedByWorkerId: null } : {}),
            });
          });

        onDeleteNodeRef.current(node.id);
        return;
      }

      if (node.kind !== 'group') {
        onDeleteNodeRef.current(node.id);
        return;
      }

      // Disperse group children back to the outer canvas
      const childNodes = nodesRef.current.filter((n) => n.groupId === node.id);
      const dispersedPositions: Record<string, Point> = {};
      const stationaryNodes = nodesRef.current.filter(
        (n) => n.id !== node.id && n.groupId !== node.id,
      );
      const resolvedChildren: FilePageNode[] = [];

      childNodes.forEach((childNode) => {
        const desiredPosition = {
          x: snapToSlotX(childNode.position.x),
          y: snapToSlotY(childNode.position.y),
        };
        const resolvedPositions = resolveSnapPositions(
          { [childNode.id]: desiredPosition },
          [childNode.id],
          [...stationaryNodes, ...resolvedChildren],
          { [childNode.id]: desiredPosition },
          { [childNode.id]: draftSizesRef.current[childNode.id] ?? childNode.size },
          undefined,
          { getNodeKind: (nodeId) => (nodeId === childNode.id ? childNode.kind : undefined) },
        );
        const nextPosition = resolvedPositions[childNode.id] ?? desiredPosition;

        dispersedPositions[childNode.id] = nextPosition;
        resolvedChildren.push({ ...childNode, groupId: null, position: nextPosition });
        onUpdateNodeRef.current(childNode.id, { groupId: null });
      });

      if (Object.keys(dispersedPositions).length > 0) {
        onMoveNodesRef.current(dispersedPositions);
      }

      onDeleteNodeRef.current(node.id);
    },
    [workerEngine],
  );

  const deleteSelectedNodes = useCallback(() => {
    const selectedIds = Array.from(
      new Set(draftSelectedNodeIdsRef.current ?? selectedNodeIdsRef.current),
    );

    if (selectedIds.length === 0) {
      return;
    }

    onPreviewContentItemChange?.(null);

    selectedIds.forEach((nodeId) => {
      const node = getNodeById(nodeId);

      if (node) {
        deleteCanvasNode(node);
      }
    });

    draftSelectedNodeIdsRef.current = null;
    setDraftSelectedNodeIds(null);
    onSelectNodesRef.current([]);
  }, [deleteCanvasNode, getNodeById, onPreviewContentItemChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (editingNodeIdRef.current) {
        return;
      }

      if (
        dragStateRef.current ||
        marqueeStateRef.current ||
        panStateRef.current ||
        resizeStateRef.current ||
        workerConnectionDragStateRef.current
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      const selectedIds = draftSelectedNodeIdsRef.current ?? selectedNodeIdsRef.current;
      if (selectedIds.length === 0) {
        return;
      }

      event.preventDefault();
      deleteSelectedNodes();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedNodes]);

  // ── Hovered connector cleanup ──────────────────────────────────────────────

  useEffect(() => {
    if (hoveredConnectorId && !connectorPaths.some((c) => c.id === hoveredConnectorId)) {
      setHoveredConnectorId(null);
    }
  }, [connectorPaths, hoveredConnectorId]);

  // ── Node insertion helpers ─────────────────────────────────────────────────

  const resolveInsertionPosition = useCallback(
    (
      node: Pick<FilePageNode, 'kind' | 'size'>,
      localPoint: Point | null = contextMenuPointRef.current,
      anchor: 'top-left' | 'center' = 'top-left',
    ): Point => {
      const resolvedPoint = localPoint ?? { x: CANVAS_PADDING, y: CANVAS_PADDING };
      const dims = getNodeDimensionsForKind(node.size, node.kind);
      const offsetX = anchor === 'center' ? dims.width / 2 : 0;
      const offsetY = anchor === 'center' ? dims.height / 2 : 0;
      return {
        x: clampToCanvas(resolvedPoint.x - offsetX),
        y: clampToCanvas(resolvedPoint.y - offsetY),
      };
    },
    [],
  );

  const addNodeWithPosition = useCallback(
    (node: Omit<FilePageNode, 'position'>, position: Point) => {
      const nextNode = { ...node, position };
      onPreviewContentItemChange?.(null);
      onAddNodeRef.current(nextNode);
      onSelectNodesRef.current([nextNode.id]);
      setDraftSelectedNodeIds([nextNode.id]);
    },
    [onPreviewContentItemChange],
  );

  const addNodeAtContext = useCallback(
    (node: Omit<FilePageNode, 'position'>) => {
      addNodeWithPosition(node, resolveInsertionPosition(node));
      contextMenuPointRef.current = null;
    },
    [addNodeWithPosition, resolveInsertionPosition],
  );

  // Context menu add handlers
  function handleAddGroup() { addNodeAtContext(buildGroupNode()); }

  const selectedGroupableNodes = useMemo(() => {
    const selectedIds = new Set(displaySelectedNodeIds);

    return nodes.filter((node) => selectedIds.has(node.id) && node.kind !== 'group');
  }, [displaySelectedNodeIds, nodes]);

  const canGroupSelectedNodes = selectedGroupableNodes.length > 1;

  const handleAddSelectedNodesToGroup = useCallback(() => {
    if (selectedGroupableNodes.length < 2) {
      return;
    }

    const selectedBounds = selectedGroupableNodes
      .map((node) =>
        getNodeBoundsWithSize(
          draftPositionsRef.current[node.id] ?? node.position,
          draftSizesRef.current[node.id] ?? node.size,
          node.kind,
        ),
      )
      .reduce(
        (bounds, nodeBounds) => ({
          left: Math.min(bounds.left, nodeBounds.left),
          top: Math.min(bounds.top, nodeBounds.top),
          right: Math.max(bounds.right, nodeBounds.right),
          bottom: Math.max(bounds.bottom, nodeBounds.bottom),
        }),
        {
          left: Number.POSITIVE_INFINITY,
          top: Number.POSITIVE_INFINITY,
          right: Number.NEGATIVE_INFINITY,
          bottom: Number.NEGATIVE_INFINITY,
        },
      );
    const selectedWidth = selectedBounds.right - selectedBounds.left;
    const selectedHeight = selectedBounds.bottom - selectedBounds.top;
    const groupSize: FilePageNode['size'] = {
      widthUnits: getUnitsForDimension(
        selectedWidth +
          GROUP_CONTENT_PADDING_X * 2 +
          GROUP_CONTENT_INSET_LEFT +
          GROUP_CONTENT_INSET_RIGHT,
        SLOT_STEP_X,
        GROUP_MIN_GRID_UNITS,
        GROUP_MAX_GRID_UNITS,
      ),
      heightUnits: getUnitsForDimension(
        selectedHeight +
          GROUP_CONTENT_PADDING_TOP +
          GROUP_CONTENT_PADDING_BOTTOM +
          GROUP_CONTENT_INSET_TOP +
          GROUP_CONTENT_INSET_BOTTOM,
        SLOT_STEP_Y,
        GROUP_MIN_GRID_UNITS,
        GROUP_MAX_GRID_UNITS,
      ),
    };
    const nextGroup = {
      ...buildGroupNode(),
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      position: {
        x: clampToCanvas(selectedBounds.left - GROUP_CONTENT_PADDING_X),
        y: clampToCanvas(selectedBounds.top - GROUP_CONTENT_PADDING_TOP),
      },
      size: groupSize,
    } satisfies FilePageNode;

    onPreviewContentItemChange?.(null);
    onAddNodeRef.current(nextGroup);
    selectedGroupableNodes.forEach((node) => {
      onUpdateNodeRef.current(node.id, { groupId: nextGroup.id });
    });
    onSelectNodesRef.current(selectedGroupableNodes.map((node) => node.id));
    setDraftSelectedNodeIds(selectedGroupableNodes.map((node) => node.id));
    contextMenuPointRef.current = null;
  }, [onPreviewContentItemChange, selectedGroupableNodes]);

  // ── Palette drag handlers ──────────────────────────────────────────────────

  const clearPaletteDragState = useCallback(() => {
    paletteDragDepthRef.current = 0;
    paletteDragPreviewPointRef.current = null;
    cancelScheduledFrame(paletteDragFrameRef);
    setDraggedPaletteTemplateId(null);
    setPaletteDragPreviewPoint(null);
    setIsPaletteDragOverCanvas(false);
  }, [cancelScheduledFrame]);

  const handleCanvasPaletteDragEnter = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
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
      if (localPoint) schedulePalettePreviewCommit(localPoint);
    },
    [getLocalPoint, schedulePalettePreviewCommit],
  );

  const handleCanvasPaletteDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (
        (event.target as HTMLElement).closest('[data-canvas-chrome="true"]') ||
        !hasCanvasPaletteTemplate(event.dataTransfer)
      ) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const localPoint = getLocalPoint(event.clientX, event.clientY);
      if (localPoint) schedulePalettePreviewCommit(localPoint);
      if (!isPaletteDragOverCanvas) setIsPaletteDragOverCanvas(true);
    },
    [getLocalPoint, isPaletteDragOverCanvas, schedulePalettePreviewCommit],
  );

  const handleCanvasPaletteDragLeave = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (
        (event.target as HTMLElement).closest('[data-canvas-chrome="true"]') ||
        !hasCanvasPaletteTemplate(event.dataTransfer)
      ) {
        return;
      }
      event.preventDefault();
      paletteDragDepthRef.current = Math.max(0, paletteDragDepthRef.current - 1);
      if (paletteDragDepthRef.current === 0) {
        paletteDragPreviewPointRef.current = null;
        cancelScheduledFrame(paletteDragFrameRef);
        setPaletteDragPreviewPoint(null);
        setIsPaletteDragOverCanvas(false);
      }
    },
    [cancelScheduledFrame],
  );

  const handleCanvasPaletteDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const templateId = readCanvasPaletteTemplate(event.dataTransfer);
      if (!templateId || (event.target as HTMLElement).closest('[data-canvas-chrome="true"]')) return;

      event.preventDefault();
      clearPaletteDragState();

      const localPoint = getLocalPoint(event.clientX, event.clientY);
      if (!localPoint) return;

      const nextNode = buildCanvasPaletteNode(templateId);
      addNodeWithPosition(nextNode, resolveInsertionPosition(nextNode, localPoint, 'center'));
    },
    [addNodeWithPosition, clearPaletteDragState, getLocalPoint, resolveInsertionPosition],
  );

  // ── Palette drag preview ───────────────────────────────────────────────────

  const paletteDragPreview = useMemo(() => {
    if (!draggedPaletteTemplateId || !paletteDragPreviewPoint) return null;

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

    return { Icon, bounds, dimensions, iconToneClassName, node };
  }, [draggedPaletteTemplateId, paletteDragPreviewPoint, resolveInsertionPosition]);

  // ── Render helpers ─────────────────────────────────────────────────────────

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
        filePreview={node.kind === 'file' ? (filePreviewById[node.id] ?? null) : null}
        folderContents={folderContents}
        folderExpandState={folderExpandState}
        isContextMenuOpen={contextMenuNodeId === node.id}
        isDragging={dragNodeIdSet.has(node.id)}
        isEditing={editingNodeId === node.id}
        isResizing={resizeState?.nodeId === node.id}
        isWorkerConnectionTarget={workerConnectionDragState?.targetNodeId === node.id}
        resizeAxis={resizeState?.nodeId === node.id ? resizeState.axis : undefined}
        isHighlighted={highlightedIdSet.has(node.id)}
        isSelected={selectedIdSet.has(node.id)}
        node={node}
        contextMenuResetKey={nodeContextMenuResetKey}
        snapPreviewPosition={showSnapPreview ? previewPosition : undefined}
        onApplyIcon={applyNodeIcon}
        onApplyResize={applyNodeResize}
        canAddSelectionToGroup={canGroupSelectedNodes && selectedIdSet.has(node.id)}
        onAddSelectionToGroup={handleAddSelectedNodesToGroup}
        onClearIconPreview={clearNodeIconPreview}
        onClearSizePreview={clearNodeSizePreview}
        onCommitRename={commitNodeRename}
        onContextMenu={openNodeContextMenu}
        onContextMenuOpenChange={setNodeContextMenuOpen}
        onDelete={deleteCanvasNode}
        onCenterGroupContents={
          node.kind === 'group' &&
          nodesRef.current.some((candidate) => candidate.groupId === node.id)
            ? centerGroupContents
            : undefined
        }
        onDownload={
          node.kind === 'file'
            ? onDownloadFileNode
            : node.kind === 'folder'
              ? onRequestDownloadFolderNode
              : undefined
        }
        onEditingLabelChange={setEditingLabel}
        onHoverChange={setNodeHover}
        onOpenPreview={openNodePrimaryAction}
        onPointerDown={handleNodePointerDown}
        onPreviewIcon={previewNodeIcon}
        onPreviewResize={previewNodeResize}
        onResizeHandlePointerDown={node.kind !== 'element' ? beginNodeResize : undefined}
        onSelectFolderContentItem={(item) => {
          const existingNode = getNodeById(item.id);
          if (existingNode) {
            selectSingleNode(item.id);
            if (existingNode.kind === 'file') {
              const fileId = resolveCanvasFileId?.(existingNode) ?? null;

              if (fileId && onOpenCanvasFile) {
                onOpenCanvasFile(fileId);
                return;
              }
            }

            if (existingNode.kind === 'file' || existingNode.kind === 'folder') {
              inspectors.openFloatingInspectorForNode(existingNode);
            }
            return;
          }

          if (item.kind === 'file' && item.id.startsWith('file:') && onOpenCanvasFile) {
            onOpenCanvasFile(item.id.slice('file:'.length));
            return;
          }

          inspectors.openFloatingInspectorForItem(item);
        }}
        onCollapseFolder={onCollapseFolder}
        onExpandFolder={onExpandFolder}
        onStartRename={startNodeRename}
        onStopRename={stopNodeRename}
        onWorkerInputHandlePointerDown={
          node.kind === 'worker' ? beginWorkerInputConnection : undefined
        }
      />
    );
  }

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
        <path d={connector.path} fill="none" stroke={glowStroke} strokeWidth={5} strokeLinecap="round" />
        <path d={connector.path} fill="none" stroke={lineStroke} strokeWidth={1.6} strokeLinecap="round" />
        {connector.deletable ? (
          <path
            d={connector.path}
            fill="none"
            stroke="transparent"
            strokeWidth={14}
            strokeLinecap="round"
            className="pointer-events-auto cursor-crosshair"
            onPointerEnter={() => setHoveredConnectorId(connector.id)}
            onPointerLeave={() => setHoveredConnectorId((c) => (c === connector.id ? null : c))}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteConnector(connector); }}
          />
        ) : null}
      </g>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ContextMenu
      key={canvasContextMenuKey}
      onOpenChange={(open) => {
        canvasContextMenuOpenRef.current = open;
        if (!open) {
          canvasContextMenuJustClosedRef.current = true;
        }
      }}
    >
      <ContextMenuTrigger asChild>
        <div className="flex h-full min-h-[34rem] overflow-hidden rounded-none bg-white/72 shadow-[0_36px_90px_-58px_rgba(15,23,42,0.22)] dark:bg-[rgba(30,41,59,0.56)] dark:shadow-[0_36px_90px_-58px_rgba(15,23,42,0.46)]">
          <div
            ref={canvasRef}
            onContextMenu={handleCanvasContextMenu}
            onDragEnter={handleCanvasPaletteDragEnter}
            onDragOver={handleCanvasPaletteDragOver}
            onDragLeave={handleCanvasPaletteDragLeave}
            onDrop={handleCanvasPaletteDrop}
            onWheel={handleCanvasWheel}
            onPointerLeave={() => {
              if (!contextMenuNodeId) onHoverNodeChange(null);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;

              if (
                (event.target as HTMLElement).closest('[data-canvas-node="true"]') ||
                (event.target as HTMLElement).closest('[data-canvas-chrome="true"]')
              ) {
                return;
              }

              event.preventDefault();
              armedPrimaryOpenNodeIdRef.current = null;
              nodeClickShouldOpenRef.current = false;

              if (event.shiftKey) {
                const localPoint = getLocalPoint(event.clientX, event.clientY);
                if (localPoint) beginMarqueeSelection(localPoint, true);
                return;
              }

              onSelectNodes([]);
              draftSelectedNodeIdsRef.current = [];
              setDraftSelectedNodeIds([]);

              const nextPanState: PanState = {
                origin: { x: event.clientX, y: event.clientY },
                baseViewport: viewportRef.current,
              };
              panStateRef.current = nextPanState;
              setPanState(nextPanState);
            }}
            className={cn(
              'canvas-surface relative min-w-0 flex-1 overflow-hidden touch-none [contain:layout_paint_style]',
              panState ? 'cursor-grabbing' : 'cursor-grab',
            )}
          >
            <div
              data-canvas-chrome="true"
              className="panel-surface absolute bottom-4 left-4 z-30 flex items-center gap-1 rounded-[1.35rem] p-1.5"
            >
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => applyCanvasZoom(zoomRef.current - CANVAS_ZOOM_STEP)}
                className="flex size-9 items-center justify-center rounded-[1rem] text-slate-600 transition hover:bg-slate-100/90 disabled:pointer-events-none disabled:opacity-35 dark:text-slate-200 dark:hover:bg-slate-700/34"
                disabled={zoom <= CANVAS_MIN_ZOOM + 0.001}
              >
                <MinusIcon className="size-4" />
              </button>
              <div className="min-w-14 select-none text-center text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-300">
                {Math.round(zoom * 100)}%
              </div>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => applyCanvasZoom(zoomRef.current + CANVAS_ZOOM_STEP)}
                className="flex size-9 items-center justify-center rounded-[1rem] text-slate-600 transition hover:bg-slate-100/90 disabled:pointer-events-none disabled:opacity-35 dark:text-slate-200 dark:hover:bg-slate-700/34"
                disabled={zoom >= CANVAS_MAX_ZOOM - 0.001}
              >
                <PlusIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Reset zoom"
                onClick={resetCanvasZoom}
                className="flex size-9 items-center justify-center rounded-[1rem] text-slate-500 transition hover:bg-slate-100/90 disabled:pointer-events-none disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-700/34"
                disabled={Math.abs(zoom - 1) < 0.001}
              >
                <RotateCcwIcon className="size-4" />
              </button>
            </div>

            {isPaletteDragOverCanvas ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-4 z-20 rounded-[2rem] border border-dashed border-sky-300/80 bg-sky-100/18 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.22)]"
              />
            ) : null}

            {/* Floating inspectors */}
            {inspectors.floatingInspectors.map((inspector, index) => {
              const activeTab =
                inspector.tabs.find((tab) => tab.id === inspector.activeTabId) ?? inspector.tabs[0];

              if (!activeTab) return null;

              const inspectorTabs: CanvasFloatingInspectorTab[] = inspector.tabs.map((tab) => ({
                id: tab.id,
                label: tab.target.label,
                type: tab.target.type,
              }));

              return (
                <FileCanvasFloatingInspector
                  key={inspector.id}
                  rect={inspector.window.rect}
                  tabs={inspectorTabs}
                  activeTabId={inspector.activeTabId}
                  target={activeTab.target}
                  isMinimized={inspector.window.minimized}
                  isMaximized={inspector.window.maximized}
                  phase={inspector.phase}
                  zIndex={20 + index}
                  onActivate={() => inspectors.activateFloatingInspector(inspector.id)}
                  onClose={() => inspectors.closeFloatingInspector(inspector.id)}
                  onCloseTab={(tabId) => inspectors.closeFloatingInspectorTab(inspector.id, tabId)}
                  onSelectTab={(tabId) => inspectors.selectFloatingInspectorTab(inspector.id, tabId)}
                  onHeaderPointerDown={(event) =>
                    inspectors.handleFloatingInspectorHeaderPointerDown(inspector.id, event)
                  }
                  onResizeHandlePointerDown={(event) =>
                    inspectors.handleFloatingInspectorResizePointerDown(inspector.id, event)
                  }
                  onTextChange={(value) =>
                    inspectors.handleFloatingInspectorTextChange(inspector.id, value)
                  }
                  onToggleMaximize={() => inspectors.toggleFloatingInspectorMaximize(inspector.id)}
                  onToggleMinimize={() => inspectors.toggleFloatingInspectorMinimize(inspector.id)}
                  onOpenItem={inspectors.openFloatingInspectorForItem}
                />
              );
            })}

            {/* World-space canvas layer */}
            <div
              className="absolute inset-0 [will-change:transform]"
              style={{
                transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${zoom})`,
                transformOrigin: '0 0',
              }}
            >
              {/* Groups render below content nodes */}
              {groupNodes.map((node) => renderCanvasNode(node))}

              {/* Palette drag ghost */}
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
                      <div
                        className={cn(
                          'flex min-w-0 gap-3',
                          paletteDragPreview.node.kind === 'worker' ? 'items-center' : 'items-start',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-10 shrink-0 items-center justify-center',
                            paletteDragPreview.node.kind !== 'worker' && 'mt-0.5',
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

              {/* Connectors below groups */}
              {belowGroupConnectorPaths.length > 0 ? (
                <svg aria-hidden="true" className="absolute inset-0 overflow-visible">
                  {belowGroupConnectorPaths.map((connector) => renderConnector(connector))}
                </svg>
              ) : null}

              {/* Connectors above groups */}
              {aboveGroupConnectorPaths.length > 0 ? (
                <svg aria-hidden="true" className="absolute inset-0 overflow-visible">
                  {aboveGroupConnectorPaths.map((connector) => renderConnector(connector))}
                </svg>
              ) : null}

              {/* Content nodes (files, folders, workers, elements) */}
              {contentNodes.map((node) => renderCanvasNode(node))}

              {/* Worker connection drag line */}
              {activeWorkerConnectionPreview ? (
                <svg aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible">
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

              {/* Marquee selection box */}
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
        {canGroupSelectedNodes ? (
          <ContextMenuItem onSelect={handleAddSelectedNodesToGroup}>
            <ShapesIcon className="size-4" />
            Add to group
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={handleAddGroup}>
            <ShapesIcon className="size-4" />
            Add group
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
