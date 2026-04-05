import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PlusIcon, ShapesIcon } from 'lucide-react';

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
  GROUP_CONTENT_INSET_TOP,
  GROUP_CONTENT_INSET_X,
  GROUP_HEADER_HEIGHT,
  GROUP_MIN_GRID_UNITS,
  GROUP_TITLE_UNDERLINE_INSET,
  SLOT_STEP_X,
  SLOT_STEP_Y,
} from './canvas/constants';
import { FileCanvasNode } from './canvas/FileCanvasNode';
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
  snapPointToBoundsGrid,
  snapToSlotX,
  snapToSlotY,
} from './canvas/utils';
import type {
  FilePageElementIcon,
  FilePageNode,
  FilePageNodeSize,
  FilePageNodeUpdates,
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
  onExpandFolder?: (node: FilePageNode) => void;
  onCollapseFolder?: (node: FilePageNode) => void;
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

type ResizeState = {
  nodeId: string;
  axis: 'x' | 'y' | 'both';
  origin: Point;
  baseSize: FilePageNode['size'];
  minimumSize: FilePageNode['size'];
};

const OUTER_WIDGET_SNAP_THRESHOLD = 4;

function arePointsEqual(left?: Point, right?: Point) {
  return left?.x === right?.x && left?.y === right?.y;
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
  onExpandFolder,
  onCollapseFolder,
}: FileCanvasViewProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const marqueeStateRef = useRef<MarqueeState | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const rawDragPositionsRef = useRef<Record<string, Point>>({});
  const draftPositionsRef = useRef<Record<string, Point>>({});
  const snapPreviewPositionsRef = useRef<Record<string, Point>>({});
  const activeSnapPreviewIdsRef = useRef<Record<string, boolean>>({});
  const draftSelectedNodeIdsRef = useRef<string[] | null>(null);
  const contextMenuPointRef = useRef<Point | null>(null);
  const nodesRef = useRef(nodes);
  const nodeMapRef = useRef(new Map(nodes.map((node) => [node.id, node])));
  const viewportRef = useRef<Point>({ x: 0, y: 0 });
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const contextMenuNodeIdRef = useRef<string | null>(null);
  const draftSizesRef = useRef<Record<string, FilePageNode['size']>>({});
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
  const connectorPaths = useMemo(() => {
    const nodeMap = new Map(renderedNodes.map((node) => [node.id, node]));

    return renderedNodes.flatMap((node) => {
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
          path: getConnectorPath(parentBounds, childBounds),
        },
      ];
    });
  }, [draftPositions, draftSizes, renderedNodes]);
  const outerCanvasFields = useMemo(() => {
    const baseFieldPadding = GRID_SIZE * 1.5;
    const activeFieldPadding = GRID_SIZE * 2.5;
    const activationRadius = GRID_SIZE * 4;
    const outerNodes = renderedNodes
      .filter((node) => node.kind !== 'group' && !node.groupId && !dragNodeIdSet.has(node.id))
      .map((node) => {
        const position = node.position;
        const size = node.size;
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
    const activeNodes = outerNodes.filter(({ node }) => dragNodeIdSet.has(node.id));

    return outerNodes.map(({ node, bounds, center }) => {
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
  }, [draftPositions, draftSizes, dragNodeIdSet, renderedNodes]);

  useEffect(() => {
    nodesRef.current = nodes;
    nodeMapRef.current = new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

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

      if (!liveDragState && !liveMarqueeState && !livePanState && !liveResizeState) {
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
        const widthChromeInset = resizingNode.kind === 'group' ? GROUP_CONTENT_INSET_X * 2 : 0;
        const heightChromeInset =
          resizingNode.kind === 'group'
            ? GROUP_CONTENT_INSET_TOP + GROUP_CONTENT_INSET_BOTTOM
            : 0;
        const currentSize = draftSizesRef.current[resizingNode.id] ?? resizingNode.size;
        const candidateSize = {
          widthUnits:
            liveResizeState.axis === 'y'
              ? currentSize.widthUnits
              : getUnitsForDimension(
                  baseDimensions.width -
                    widthChromeInset +
                    (localPoint.x - liveResizeState.origin.x),
                  SLOT_STEP_X,
                  liveResizeState.minimumSize.widthUnits,
                ),
          heightUnits:
            liveResizeState.axis === 'x'
              ? currentSize.heightUnits
              : getUnitsForDimension(
                  baseDimensions.height -
                    heightChromeInset +
                    (localPoint.y - liveResizeState.origin.y),
                  SLOT_STEP_Y,
                  liveResizeState.minimumSize.heightUnits,
                ),
        };
        const fallbackSizes = [
          candidateSize,
          {
            widthUnits: candidateSize.widthUnits,
            heightUnits: currentSize.heightUnits,
          },
          {
            widthUnits: currentSize.widthUnits,
            heightUnits: candidateSize.heightUnits,
          },
        ];
        const nextSize = fallbackSizes.find(
          (size) =>
            areSizesEqual(size, currentSize) || canResizeNode(resizingNode.id, size),
        );

        if (!nextSize || areSizesEqual(nextSize, currentSize)) {
          return;
        }

        setDraftSizes((current) => ({
          ...current,
          [resizingNode.id]: nextSize,
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

      if (liveDragState) {
        const rawNextPositions = liveDragState.nodeIds.reduce<Record<string, Point>>(
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
          const detectedGroupId = findContainingGroupId(
            movingNode,
            rawNextPositions[nodeId],
            nextSize,
            rawNextPositions,
          );
          let nextGroupId = detectedGroupId;

          if (!detectedGroupId && movingNode.groupId) {
            const currentGroupBounds = getGroupBounds(movingNode.groupId, nextDraftPositions);

            if (currentGroupBounds) {
              const clampedToCurrentGroup = clampNodePositionToBounds(
                rawNextPositions[nodeId],
                nextSize,
                currentGroupBounds,
              );
              const releaseThreshold = Math.min(SLOT_STEP_X, SLOT_STEP_Y) / 2;
              const distanceFromBoundary = Math.max(
                Math.abs(clampedToCurrentGroup.x - rawNextPositions[nodeId].x),
                Math.abs(clampedToCurrentGroup.y - rawNextPositions[nodeId].y),
              );

              if (distanceFromBoundary <= releaseThreshold) {
                nextGroupId = movingNode.groupId;
                nextDraftPositions[nodeId] = clampedToCurrentGroup;
              }
            }
          }

          candidateGroupIds.set(nodeId, nextGroupId);

          if (!nextGroupId) {
            return;
          }

          const parentBounds = getGroupBounds(nextGroupId, nextDraftPositions);

          if (!parentBounds) {
            return;
          }

          nextDraftPositions[nodeId] = clampNodePositionToBounds(
            nextDraftPositions[nodeId],
            nextSize,
            parentBounds,
          );
        });
        const desiredSnapPositions = liveDragState.nodeIds.reduce<Record<string, Point>>(
          (positions, nodeId) => {
            const draftPosition = nextDraftPositions[nodeId];
            const movingNode = getNodeById(nodeId);
            const nextSize =
              draftSizesRef.current[nodeId] ?? movingNode?.size ?? { widthUnits: 1, heightUnits: 1 };
            const nextGroupId = candidateGroupIds.get(nodeId);
            const groupBounds =
              typeof nextGroupId === 'string'
                ? getGroupBounds(nextGroupId, nextDraftPositions)
                : null;

            positions[nodeId] =
              groupBounds && movingNode && movingNode.kind !== 'group'
                ? snapPointToBoundsGrid(draftPosition, nextSize, groupBounds)
                : draftPosition;

            return positions;
          },
          {},
        );
        const dragTargetGroupIds = liveDragState.nodeIds.map((nodeId) => candidateGroupIds.get(nodeId));
        const firstDragTargetGroupId = dragTargetGroupIds[0];
        const sharedDragTargetGroupId =
          typeof firstDragTargetGroupId === 'string' &&
          dragTargetGroupIds.every((groupId) => groupId === firstDragTargetGroupId)
            ? firstDragTargetGroupId
            : null;
        const sharedDragTargetBounds =
          typeof sharedDragTargetGroupId === 'string'
            ? getGroupBounds(sharedDragTargetGroupId, nextDraftPositions)
            : null;
        const sharedOuterGridOrigin = sharedDragTargetBounds
          ? null
          : getSharedOuterSnapOrigin(
              liveDragState.nodeIds,
              desiredSnapPositions,
              candidateGroupIds,
            );
        const nextActiveSnapPreviewIds = liveDragState.nodeIds.reduce<Record<string, boolean>>(
          (accumulator, nodeId) => {
            accumulator[nodeId] = Boolean(sharedDragTargetBounds || sharedOuterGridOrigin);
            return accumulator;
          },
          {},
        );
        const nextSnapPositions = sharedDragTargetBounds
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
                  candidateGroupIds,
                ),
              {
                anchorGridOrigin: {
                  x: sharedDragTargetBounds.left,
                  y: sharedDragTargetBounds.top,
                },
                constrainPosition: (position, nodeId) => {
                  const movingNode = getNodeById(nodeId);

                  if (!movingNode) {
                    return {
                      x: clampToCanvas(position.x),
                      y: clampToCanvas(position.y),
                    };
                  }

                  if ((candidateGroupIds.get(nodeId) ?? null) !== sharedDragTargetGroupId) {
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
          : sharedOuterGridOrigin
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
                    candidateGroupIds,
                  ),
                {
                  anchorGridOrigin: sharedOuterGridOrigin,
                  constrainPosition: (position) => ({
                    x: clampToCanvas(position.x),
                    y: clampToCanvas(position.y),
                  }),
                  getNodeKind: (nodeId) => getNodeById(nodeId)?.kind,
                },
              )
          : desiredSnapPositions;

        rawDragPositionsRef.current = rawNextPositions;
        draftPositionsRef.current = nextDraftPositions;
        snapPreviewPositionsRef.current = nextSnapPositions;
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

      if (liveDragState && Object.keys(liveSnapPreviewPositions).length > 0) {
        const finalSnapPositions = { ...liveSnapPreviewPositions };
        const nextGroupIds = new Map<string, string | null>();
        const rawNextPositions = rawDragPositionsRef.current;
        const nextPositions = nodesRef.current.reduce<Record<string, Point>>((positions, node) => {
          positions[node.id] = finalSnapPositions[node.id] ?? node.position;
          return positions;
        }, {});

        liveDragState.selectedNodeIds.forEach((nodeId) => {
          const node = getNodeById(nodeId);

          if (!node || node.kind === 'group') {
            return;
          }

          const rawPosition = rawNextPositions[nodeId] ?? nextPositions[nodeId];
          const previewPosition = finalSnapPositions[nodeId] ?? nextPositions[nodeId];
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
            previewGroupId ??
            findContainingGroupId(node, rawPosition, draftSizesRef.current[node.id] ?? node.size, {
              ...nextPositions,
              [nodeId]: rawPosition,
            });

          nextGroupIds.set(node.id, nextGroupId);

          const parentBounds =
            typeof nextGroupId === 'string' ? getGroupBounds(nextGroupId, nextPositions) : null;
          const desiredPosition =
            nextGroupId && parentBounds
              ? snapPointToBoundsGrid(
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

          const stationaryNodes = nodesRef.current
            .filter((candidate) => candidate.id !== node.id)
            .map((candidate) => ({
              ...candidate,
              position: nextPositions[candidate.id] ?? candidate.position,
            }));
          const resolvedPositions = resolveSnapPositions(
            {
              [node.id]: desiredPosition,
            },
            [node.id],
            stationaryNodes,
            {
              [node.id]: desiredPosition,
            },
            {
              [node.id]: draftSizesRef.current[node.id] ?? node.size,
            },
            (leftNodeId, rightNodeId) => {
              const leftNode =
                leftNodeId === node.id
                  ? node
                  : stationaryNodes.find((candidate) => candidate.id === leftNodeId);
              const rightNode =
                rightNodeId === node.id
                  ? node
                  : stationaryNodes.find((candidate) => candidate.id === rightNodeId);

              return canNodesShareSpace(
                leftNode,
                rightNode,
                new Map([[node.id, nextGroupId]]),
              );
            },
            parentBounds
              ? {
                  anchorGridOrigin: {
                    x: parentBounds.left,
                    y: parentBounds.top,
                  },
                  constrainPosition: (position) => {
                    const clampedPosition = clampNodePositionToBounds(
                      position,
                      draftSizesRef.current[node.id] ?? node.size,
                      parentBounds,
                    );

                    return clampedPosition.x === position.x && clampedPosition.y === position.y
                      ? clampedPosition
                      : null;
                  },
                  getNodeKind: (nodeId) =>
                    nodeId === node.id
                      ? node.kind
                      : stationaryNodes.find((candidate) => candidate.id === nodeId)?.kind,
                }
              : {
                  getNodeKind: (nodeId) =>
                    nodeId === node.id
                      ? node.kind
                      : stationaryNodes.find((candidate) => candidate.id === nodeId)?.kind,
                },
          );
          const resolvedPosition = resolvedPositions[node.id] ?? desiredPosition;

          finalSnapPositions[node.id] = resolvedPosition;
          nextPositions[node.id] = resolvedPosition;
        });

        onMoveNodesRef.current(finalSnapPositions);
        draftPositionsRef.current = finalSnapPositions;
        setDraftPositions(finalSnapPositions);

        nextGroupIds.forEach((nextGroupId, nodeId) => {
          const node = getNodeById(nodeId);

          if (node && (node.groupId ?? null) !== nextGroupId) {
            onUpdateNodeRef.current(node.id, {
              groupId: nextGroupId,
            });
          }
        });
      }

      if (liveResizeState) {
        const nextSize = draftSizesRef.current[liveResizeState.nodeId] ?? liveResizeState.baseSize;

        if (!areSizesEqual(nextSize, liveResizeState.baseSize)) {
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
      setPanState(null);
      setResizeState(null);
      dragStateRef.current = null;
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

        const desiredPosition = snapPointToBoundsGrid(currentPosition, node.size, parentBounds);
        const stationaryNodes = nodes
          .filter((otherNode) => otherNode.id !== node.id)
          .map((otherNode) => ({
            ...otherNode,
            position: nextPositions[otherNode.id] ?? otherNode.position,
          }));
        const resolvedPositions = resolveSnapPositions(
          {
            [node.id]: desiredPosition,
          },
          [node.id],
          stationaryNodes,
          {
            [node.id]: desiredPosition,
          },
          {
            [node.id]: node.size,
          },
          (leftNodeId, rightNodeId) => {
            const leftNode =
              leftNodeId === node.id
                ? node
                : stationaryNodes.find((otherNode) => otherNode.id === leftNodeId);
            const rightNode =
              rightNodeId === node.id
                ? node
                : stationaryNodes.find((otherNode) => otherNode.id === rightNodeId);

            return canNodesShareSpace(leftNode, rightNode);
          },
          parentBounds
            ? {
                anchorGridOrigin: {
                  x: parentBounds.left,
                  y: parentBounds.top,
                },
                constrainPosition: (position) => {
                  const clampedPosition = clampNodePositionToBounds(
                    position,
                    node.size,
                    parentBounds,
                  );

                  return clampedPosition.x === position.x && clampedPosition.y === position.y
                    ? clampedPosition
                    : null;
                },
                getNodeKind: (nodeId) =>
                  nodeId === node.id
                    ? node.kind
                    : stationaryNodes.find((otherNode) => otherNode.id === nodeId)?.kind,
              }
            : {
                getNodeKind: (nodeId) =>
                  nodeId === node.id
                    ? node.kind
                    : stationaryNodes.find((otherNode) => otherNode.id === nodeId)?.kind,
              },
        );
        const nextPosition = resolvedPositions[node.id] ?? desiredPosition;

        nextPositions[node.id] = nextPosition;

        if (nextPosition.x !== node.position.x || nextPosition.y !== node.position.y) {
          correctedPositions[node.id] = nextPosition;
        }
      });

    if (Object.keys(correctedPositions).length > 0) {
      onMoveNodesRef.current(correctedPositions);
    }
  }, [dragState, marqueeState, nodes, panState, resizeState]);

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

    const currentSelection = draftSelectedNodeIdsRef.current ?? selectedNodeIdsRef.current;
    const currentSelectionSet = new Set(currentSelection);
    const nextSelectedIds =
      currentSelectionSet.has(node.id) && currentSelection.length > 1 ? currentSelection : [node.id];
    const nextDragNodeIds = expandDragNodeIds(nextSelectedIds);

    onSelectNodesRef.current(nextSelectedIds);
    setDraftSelectedNodeIds(nextSelectedIds);
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
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  }, [getLocalPoint, getNodeById]);

  function handleCanvasContextMenu(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-canvas-node="true"]')) {
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

  const expandDragNodeIds = useCallback((selectedIds: string[]) => {
    const seen = new Set(selectedIds);
    const queue = [...selectedIds];

    while (queue.length > 0) {
      const nodeId = queue.shift();

      if (!nodeId) {
        continue;
      }

      const childIds = nodesRef.current
        .filter((node) => node.groupId === nodeId)
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

        const fullyContained =
          nodeBounds.left >= groupBounds.left &&
          nodeBounds.top >= groupBounds.top &&
          nodeBounds.right <= groupBounds.right &&
          nodeBounds.bottom <= groupBounds.bottom;
        const centerInside =
          nodeCenter.x >= groupBounds.left &&
          nodeCenter.x <= groupBounds.right &&
          nodeCenter.y >= groupBounds.top &&
          nodeCenter.y <= groupBounds.bottom;

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
  ) => {
    const anchorNode = getNodeById(anchorNodeId);

    if (!anchorNode || anchorNode.kind === 'group' || anchorNode.groupId) {
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
        closestOrigin = origin;
        closestDistance = distance;
      }
    });

    return closestOrigin;
  }, [getNodeById]);

  const getSharedOuterSnapOrigin = useCallback((
    dragNodeIds: string[],
    desiredPositions: Record<string, Point>,
    candidateGroupIds: Map<string, string | null>,
  ) => {
    if (dragNodeIds.length === 0) {
      return null;
    }

    const canUseOuterWidgetSnap = dragNodeIds.every((nodeId) => {
      const node = getNodeById(nodeId);

      return Boolean(node && node.kind !== 'group' && !candidateGroupIds.get(nodeId));
    });

    if (!canUseOuterWidgetSnap) {
      return null;
    }

    return getNearbyOuterGridOrigin(dragNodeIds[0], desiredPositions, dragNodeIds);
  }, [getNearbyOuterGridOrigin, getNodeById]);

  function resolveInsertionPosition(node: Pick<FilePageNode, 'kind' | 'size'>) {
    const localPoint = contextMenuPointRef.current ?? {
      x: CANVAS_PADDING,
      y: CANVAS_PADDING,
    };
    return {
      x: clampToCanvas(localPoint.x),
      y: clampToCanvas(localPoint.y),
    };
  }

  const addNodeAtContext = useCallback((node: Omit<FilePageNode, 'position'>) => {
    const nextNode = {
      ...node,
      position: resolveInsertionPosition(node),
    };

    onAddNodeRef.current(nextNode);
    selectSingleNode(nextNode.id);
    contextMenuPointRef.current = null;
  }, [resolveInsertionPosition]);

  function handleAddBasicElement() {
    addNodeAtContext({
      id: `element-${Date.now()}`,
      label: 'Basic element',
      description: 'Freeform canvas object for quick thinking and placement.',
      kind: 'element',
      icon: 'sparkles',
      size: {
        widthUnits: 1,
        heightUnits: 1,
      },
    });
  }

  function handleAddGroup() {
    addNodeAtContext({
      id: `group-${Date.now()}`,
      label: 'Group',
      description: 'Shared canvas region for clustering related notes and files.',
      kind: 'group',
      icon: 'shapes',
      size: {
        widthUnits: 3,
        heightUnits: 2,
      },
    });
  }

  const clearNodeSizePreview = useCallback((nodeId?: string) => {
    if (!nodeId) {
      setDraftSizes({});
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

  const canResizeNode = useCallback((nodeId: string, size: FilePageNode['size']) => {
    const resizingNode = getNodeById(nodeId);

    if (!resizingNode) {
      return false;
    }

    if (resizingNode.kind === 'group') {
      const resizedContentBounds = getGroupContentBounds(resizingNode.position, size);
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
        return false;
      }
    }

    const resizedBounds = getNodeBoundsWithSize(resizingNode.position, size, resizingNode.kind);

    return !nodesRef.current
      .filter((node) => node.id !== nodeId)
      .some(
        (node) =>
          !canNodesShareSpace(resizingNode, node) &&
          boundsOverlap(resizedBounds, getNodeBoundsWithSize(node.position, node.size, node.kind)),
      );
  }, [canNodesShareSpace, getNodeById]);

  const previewNodeResize = useCallback((node: FilePageNode, size: FilePageNode['size']) => {
    if (!canResizeNode(node.id, size)) {
      return;
    }

    setDraftSizes((current) => ({
      ...current,
      [node.id]: size,
    }));
  }, [canResizeNode]);

  const applyNodeResize = useCallback((node: FilePageNode, size: FilePageNode['size']) => {
    if (!canResizeNode(node.id, size)) {
      return;
    }

    clearNodeSizePreview(node.id);
    onResizeNodeRef.current(node.id, size);
    onSelectNodesRef.current([node.id]);
  }, [canResizeNode, clearNodeSizePreview]);

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
    onSelectNodesRef.current([nodeId]);
    setDraftSelectedNodeIds([nodeId]);
  }, []);

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

  const deleteCanvasNode = useCallback((node: FilePageNode) => {
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
  }, []);

  const beginNodeResize = useCallback((
    event: ReactPointerEvent<HTMLSpanElement>,
    node: FilePageNode,
    axis: 'x' | 'y' | 'both',
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
  }, [getLocalPoint, selectSingleNode]);

  function renderGroupShellOverlay(node: FilePageNode) {
    const displayPosition = draftPositions[node.id] ?? node.position;
    const displaySize = draftSizes[node.id] ?? node.size;
    const bounds = getNodeBoundsWithSize(displayPosition, displaySize, node.kind);
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const topShellHeight = GROUP_CONTENT_INSET_TOP;
    const leftShellWidth = GROUP_CONTENT_INSET_X;
    const rightShellWidth = GROUP_CONTENT_INSET_X;
    const bottomShellHeight = GROUP_CONTENT_INSET_BOTTOM;
    const isSelected = selectedIdSet.has(node.id);
    const isResizing = resizeState?.nodeId === node.id;
    const resizeAccentClass =
      isResizing || isSelected ? 'bg-sky-300/80' : 'bg-slate-300/70';
    const resizeHandleClass =
      isResizing || isSelected
        ? 'border-sky-300/80 bg-sky-50/95 text-sky-600 shadow-[0_10px_24px_-16px_rgba(14,165,233,0.55)]'
        : 'border-slate-300/80 bg-white/92 text-slate-500 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.22)]';

    return (
      <div
        key={`${node.id}-shell`}
        aria-hidden="true"
        className="pointer-events-none absolute z-30"
        style={{
          left: bounds.left,
          top: bounds.top,
          width,
          height,
        }}
      >
        <div
          className={cn(
            'absolute inset-0 rounded-2xl border bg-transparent shadow-[0_10px_26px_-22px_rgba(15,23,42,0.28)]',
            isResizing
              ? 'border-sky-300/85 ring-2 ring-sky-200/80'
              : isSelected
                ? 'border-slate-900/25 ring-2 ring-slate-900/8'
                : 'border-slate-400/95',
          )}
        />
        <div className="absolute inset-x-0 top-0 rounded-t-2xl bg-[#fffbf1]/95" style={{ height: topShellHeight }} />
        <div className="absolute left-0 bg-[#fffbf1]/95" style={{ top: topShellHeight, bottom: bottomShellHeight, width: leftShellWidth }} />
        <div className="absolute right-0 bg-[#fffbf1]/95" style={{ top: topShellHeight, bottom: bottomShellHeight, width: rightShellWidth }} />
        <div className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-[#fffbf1]/95" style={{ height: bottomShellHeight }} />
        <div className="absolute left-4 right-4 top-4" style={{ height: GROUP_HEADER_HEIGHT - 16 }}>
          <div className="truncate text-sm font-medium text-slate-950">{node.label}</div>
          <span
            className="absolute bottom-0 h-px bg-slate-300/80"
            style={{
              left: GROUP_TITLE_UNDERLINE_INSET,
              right: GROUP_TITLE_UNDERLINE_INSET,
            }}
          />
        </div>
        <span
          className={cn('absolute transition-colors duration-150', resizeAccentClass)}
          style={{
            left: leftShellWidth,
            right: leftShellWidth + 22,
            bottom: 18,
            height: 1,
          }}
        />
        <span
          className={cn('absolute transition-colors duration-150', resizeAccentClass)}
          style={{
            top: topShellHeight,
            bottom: bottomShellHeight + 22,
            right: 18,
            width: 1,
          }}
        />
        <span
          role="presentation"
          onPointerDown={(event) => beginNodeResize(event, node, 'x')}
          className="pointer-events-auto absolute inset-y-0 right-0 w-5 cursor-ew-resize"
        />
        <span
          role="presentation"
          onPointerDown={(event) => beginNodeResize(event, node, 'y')}
          className="pointer-events-auto absolute bottom-0 left-0 right-0 h-5 cursor-ns-resize"
        />
        <span
          role="presentation"
          onPointerDown={(event) => beginNodeResize(event, node, 'both')}
          className={cn(
            'pointer-events-auto absolute bottom-2 right-2 flex size-7 cursor-nwse-resize items-center justify-center rounded-lg border transition-colors',
            resizeHandleClass,
          )}
        >
          <span className="size-3 rounded-br-[7px] border-b-2 border-r-2 border-current" />
        </span>
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={canvasRef}
          onContextMenu={handleCanvasContextMenu}
          onPointerLeave={() => {
            if (!contextMenuNodeId) {
              onHoverNodeChange(null);
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            if (!(event.target as HTMLElement).closest('[data-canvas-node="true"]')) {
              if (event.shiftKey) {
                const localPoint = getLocalPoint(event.clientX, event.clientY);

                if (!localPoint) {
                  onSelectNodes([]);
                  return;
                }

                setMarqueeState({
                  origin: localPoint,
                  current: localPoint,
                  additive: true,
                  initialSelection: selectedNodeIds,
                });
                marqueeStateRef.current = {
                  origin: localPoint,
                  current: localPoint,
                  additive: true,
                  initialSelection: selectedNodeIds,
                };
                draftSelectedNodeIdsRef.current = selectedNodeIds;
                setDraftSelectedNodeIds(selectedNodeIds);
                return;
              }

        const nextPanState = {
                origin: { x: event.clientX, y: event.clientY },
                baseViewport: viewport,
              };
              panStateRef.current = nextPanState;
              setPanState(nextPanState);
            }
          }}
          className={cn(
            'relative h-full min-h-[34rem] overflow-hidden rounded-none border border-slate-200/80 bg-[#fffdf7]/92 shadow-[0_36px_90px_-58px_rgba(15,23,42,0.22)] touch-none',
            panState ? 'cursor-grabbing' : 'cursor-grab',
          )}
        >
          <div
            className="absolute inset-0"
            style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0)` }}
          >
            {outerCanvasFields.map((field) => (
              <div
                key={field.id}
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute rounded-[2.5rem] transition-[opacity,width,height,left,top] duration-150',
                  field.isActive ? 'opacity-100' : 'opacity-85',
                )}
                style={{
                  left: field.left,
                  top: field.top,
                  width: field.width,
                  height: field.height,
                  backgroundImage:
                    field.isActive
                      ? 'radial-gradient(circle, rgba(100,116,139,0.34) 1.45px, transparent 1.55px)'
                      : 'radial-gradient(circle, rgba(100,116,139,0.28) 1.35px, transparent 1.5px)',
                  backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
                  maskImage:
                    field.isActive
                      ? 'radial-gradient(circle at center, rgba(0,0,0,0.98) 46%, rgba(0,0,0,0.52) 76%, transparent 100%)'
                      : 'radial-gradient(circle at center, rgba(0,0,0,0.94) 42%, rgba(0,0,0,0.38) 72%, transparent 100%)',
                  WebkitMaskImage:
                    field.isActive
                      ? 'radial-gradient(circle at center, rgba(0,0,0,0.98) 46%, rgba(0,0,0,0.52) 76%, transparent 100%)'
                      : 'radial-gradient(circle at center, rgba(0,0,0,0.94) 42%, rgba(0,0,0,0.38) 72%, transparent 100%)',
                }}
              />
            ))}
            {connectorPaths.length > 0 ? (
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-visible"
              >
                {connectorPaths.map((connector) => (
                  <g key={connector.id}>
                    <path
                      d={connector.path}
                      fill="none"
                      stroke="rgba(148, 163, 184, 0.18)"
                      strokeWidth={5}
                      strokeLinecap="round"
                    />
                    <path
                      d={connector.path}
                      fill="none"
                      stroke="rgba(100, 116, 139, 0.6)"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                    />
                  </g>
                ))}
              </svg>
            ) : null}
            {renderedNodes.map((node) => {
            const displayPosition = draftPositions[node.id] ?? node.position;
            const previewPosition = snapPreviewPositions[node.id];
            const showSnapPreview =
              activeSnapPreviewIds[node.id] &&
              previewPosition &&
              !arePointsEqual(previewPosition, displayPosition);
            const folderExpandState = getFolderExpandState?.(node) ?? 'hidden';

            return (
              <FileCanvasNode
                key={node.id}
                canResize={canResizeNode}
                displayPosition={displayPosition}
                displaySize={draftSizes[node.id] ?? node.size}
                draftIcon={draftIcons[node.id]}
                editingLabel={editingLabel}
                isContextMenuOpen={contextMenuNodeId === node.id}
                isDragging={dragNodeIdSet.has(node.id)}
                isEditing={editingNodeId === node.id}
                isResizing={resizeState?.nodeId === node.id}
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
                onEditingLabelChange={setEditingLabel}
                onHoverChange={setNodeHover}
                onPointerDown={handleNodePointerDown}
                onPreviewIcon={previewNodeIcon}
                onPreviewResize={previewNodeResize}
                onResizeHandlePointerDown={node.kind === 'group' ? beginNodeResize : undefined}
                onSelect={selectSingleNode}
                onCollapseFolder={onCollapseFolder}
                onExpandFolder={onExpandFolder}
                folderExpandState={folderExpandState}
                showGroupHeader={node.kind !== 'group'}
                onStartRename={startNodeRename}
                onStopRename={stopNodeRename}
              />
            );
          })}
            {renderedNodes
              .filter((node) => node.kind === 'group')
              .map((node) => renderGroupShellOverlay(node))}

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
      </ContextMenuTrigger>
      <ContextMenuContent className="ml-2 w-52">
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
