import { useEffect, useRef, useState } from 'react';
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
import type { FilePageElementIcon, FilePageNode, FilePageNodeSize } from '@/types/filePage';
import type { Point } from '@/types/geometry';

interface FileCanvasViewProps {
  nodes: FilePageNode[];
  selectedNodeIds: string[];
  onMoveNodes: (positions: Record<string, Point>) => void;
  onResizeNode: (nodeId: string, size: FilePageNodeSize) => void;
  onAddNode: (node: FilePageNode) => void;
  onUpdateNode: (
    nodeId: string,
    updates: Partial<Pick<FilePageNode, 'label' | 'description' | 'icon' | 'size' | 'groupId'>>,
  ) => void;
  onDeleteNode: (nodeId: string) => void;
  onHoverNodeChange: (node: FilePageNode | null) => void;
  onSelectNodes: (nodeIds: string[]) => void;
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
  const draftSelectedNodeIdsRef = useRef<string[] | null>(null);
  const contextMenuPointRef = useRef<Point | null>(null);
  const nodesRef = useRef(nodes);
  const viewportRef = useRef<Point>({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [viewport, setViewport] = useState<Point>({ x: 0, y: 0 });
  const [draftPositions, setDraftPositions] = useState<Record<string, Point>>({});
  const [snapPreviewPositions, setSnapPreviewPositions] = useState<Record<string, Point>>({});
  const [draftSizes, setDraftSizes] = useState<Record<string, FilePageNode['size']>>({});
  const [draftIcons, setDraftIcons] = useState<Record<string, FilePageElementIcon>>({});
  const [draftSelectedNodeIds, setDraftSelectedNodeIds] = useState<string[] | null>(null);
  const [contextMenuNodeId, setContextMenuNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const renderedNodes = [...nodes].sort((left, right) => {
    const leftRank = left.kind === 'group' ? 0 : 1;
    const rightRank = right.kind === 'group' ? 0 : 1;

    return leftRank - rightRank;
  });
  const displaySelectedNodeIds = draftSelectedNodeIds ?? selectedNodeIds;
  const selectedIdSet = new Set(displaySelectedNodeIds);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

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
    snapPreviewPositionsRef.current = snapPreviewPositions;
  }, [snapPreviewPositions]);

  useEffect(() => {
    draftSelectedNodeIdsRef.current = draftSelectedNodeIds;
  }, [draftSelectedNodeIds]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

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
        const resizingNode = nodesRef.current.find((node) => node.id === liveResizeState.nodeId);
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
        const currentSize = draftSizes[resizingNode.id] ?? resizingNode.size;
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
          const movingNode = nodesRef.current.find((node) => node.id === nodeId);

          if (
            !movingNode ||
            movingNode.kind === 'group' ||
            (movingNode.groupId && liveDragState.nodeIds.includes(movingNode.groupId))
          ) {
            return;
          }

          const nextSize = draftSizes[nodeId] ?? movingNode.size;
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
            const movingNode = nodesRef.current.find((node) => node.id === nodeId);
            const nextSize =
              draftSizes[nodeId] ?? movingNode?.size ?? { widthUnits: 1, heightUnits: 1 };
            const nextGroupId = candidateGroupIds.get(nodeId);
            const groupBounds =
              typeof nextGroupId === 'string'
                ? getGroupBounds(nextGroupId, nextDraftPositions)
                : null;

            positions[nodeId] =
              groupBounds && movingNode && movingNode.kind !== 'group'
                ? snapPointToBoundsGrid(draftPosition, nextSize, groupBounds)
                : {
                    x: snapToSlotX(draftPosition.x),
                    y: snapToSlotY(draftPosition.y),
                  };

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
        const nextSnapPositions = resolveSnapPositions(
          desiredSnapPositions,
          liveDragState.nodeIds,
          nodesRef.current.filter((node) => !liveDragState.nodeIds.includes(node.id)),
          liveDragState.basePositions,
          Object.fromEntries(
            nodesRef.current.map((node) => [node.id, draftSizes[node.id] ?? node.size]),
          ),
          (leftNodeId, rightNodeId) =>
            canNodesShareSpace(
              nodesRef.current.find((node) => node.id === leftNodeId),
              nodesRef.current.find((node) => node.id === rightNodeId),
              candidateGroupIds,
            ),
          sharedDragTargetBounds
            ? {
                anchorGridOrigin: {
                  x: sharedDragTargetBounds.left,
                  y: sharedDragTargetBounds.top,
                },
                constrainPosition: (position, nodeId) => {
                  const movingNode = nodesRef.current.find((node) => node.id === nodeId);

                  if (!movingNode) {
                    return {
                      x: clampToCanvas(position.x),
                      y: clampToCanvas(position.y),
                    };
                  }

                  if ((candidateGroupIds.get(nodeId) ?? null) !== sharedDragTargetGroupId) {
                    return null;
                  }

                  const nextSize = draftSizes[nodeId] ?? movingNode.size;
                  const clampedPosition = clampNodePositionToBounds(
                    position,
                    nextSize,
                    sharedDragTargetBounds,
                  );

                  return clampedPosition.x === position.x && clampedPosition.y === position.y
                    ? clampedPosition
                    : null;
                },
                getNodeKind: (nodeId) =>
                  nodesRef.current.find((node) => node.id === nodeId)?.kind,
              }
            : {
                getNodeKind: (nodeId) =>
                  nodesRef.current.find((node) => node.id === nodeId)?.kind,
              },
        );

        rawDragPositionsRef.current = rawNextPositions;
        draftPositionsRef.current = nextDraftPositions;
        snapPreviewPositionsRef.current = nextSnapPositions;

        if (frameRef.current === null) {
          frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            setDraftPositions(draftPositionsRef.current);
            setSnapPreviewPositions(snapPreviewPositionsRef.current);
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
          const size = draftSizes[node.id] ?? node.size;
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
          const node = nodesRef.current.find((candidate) => candidate.id === nodeId);

          if (!node || node.kind === 'group') {
            return;
          }

          const rawPosition = rawNextPositions[nodeId] ?? nextPositions[nodeId];
          const nextGroupId = findContainingGroupId(
            node,
            rawPosition,
            draftSizes[node.id] ?? node.size,
            {
              ...nextPositions,
              [nodeId]: rawPosition,
            },
          );

          nextGroupIds.set(node.id, nextGroupId);

          const parentBounds =
            typeof nextGroupId === 'string' ? getGroupBounds(nextGroupId, nextPositions) : null;
          const desiredPosition =
            nextGroupId && parentBounds
              ? snapPointToBoundsGrid(rawPosition, draftSizes[node.id] ?? node.size, parentBounds)
              : {
                  x: snapToSlotX(rawPosition.x),
                  y: snapToSlotY(rawPosition.y),
                };
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
              [node.id]: draftSizes[node.id] ?? node.size,
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
                      draftSizes[node.id] ?? node.size,
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

        onMoveNodes(finalSnapPositions);
        draftPositionsRef.current = finalSnapPositions;
        setDraftPositions(finalSnapPositions);

        nextGroupIds.forEach((nextGroupId, nodeId) => {
          const node = nodesRef.current.find((candidate) => candidate.id === nodeId);

          if (node && (node.groupId ?? null) !== nextGroupId) {
            onUpdateNode(node.id, {
              groupId: nextGroupId,
            });
          }
        });
      }

      if (liveResizeState) {
        const nextSize = draftSizes[liveResizeState.nodeId] ?? liveResizeState.baseSize;

        if (!areSizesEqual(nextSize, liveResizeState.baseSize)) {
          onResizeNode(liveResizeState.nodeId, nextSize);
        }

        onSelectNodes([liveResizeState.nodeId]);
      }

      if (liveMarqueeState) {
        onSelectNodes(
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
        setDraftPositions({});
        setSnapPreviewPositions({});
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
  }, [draftSizes, onMoveNodes, onResizeNode, onSelectNodes]);

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
        const desiredPosition = parentBounds
          ? snapPointToBoundsGrid(currentPosition, node.size, parentBounds)
          : {
              x: snapToSlotX(currentPosition.x),
              y: snapToSlotY(currentPosition.y),
            };
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
      onMoveNodes(correctedPositions);
    }
  }, [dragState, marqueeState, nodes, onMoveNodes, panState, resizeState]);

  function getLocalPoint(clientX: number, clientY: number) {
    if (!canvasRef.current) {
      return null;
    }

    const rect = canvasRef.current.getBoundingClientRect();

    return {
      x: clientX - rect.left - viewportRef.current.x,
      y: clientY - rect.top - viewportRef.current.y,
    };
  }

  function handleNodePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    node: FilePageNode,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const localPoint = getLocalPoint(event.clientX, event.clientY);

    if (!localPoint) {
      return;
    }

    const nextSelectedIds =
      selectedIdSet.has(node.id) && selectedNodeIds.length > 1 ? selectedNodeIds : [node.id];
    const nextDragNodeIds = expandDragNodeIds(nextSelectedIds);

    onSelectNodes(nextSelectedIds);
    setDraftSelectedNodeIds(nextSelectedIds);
    const nextDragState = {
      nodeIds: nextDragNodeIds,
      selectedNodeIds: nextSelectedIds,
      origin: localPoint,
      basePositions: nextDragNodeIds.reduce<Record<string, Point>>((positions, nodeId) => {
        const selectedNode = nodes.find((candidate) => candidate.id === nodeId);

        if (selectedNode) {
          positions[nodeId] = selectedNode.position;
        }

        return positions;
      }, {}),
    };
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  }

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

  function getGroupBounds(groupId: string, positions?: Record<string, Point>) {
    const groupNode = nodesRef.current.find((node) => node.id === groupId && node.kind === 'group');

    if (!groupNode) {
      return null;
    }

    return getGroupContentBounds(
      positions?.[groupNode.id] ?? draftPositionsRef.current[groupNode.id] ?? groupNode.position,
      draftSizes[groupNode.id] ?? groupNode.size,
    );
  }

  function canNodesShareSpace(
    leftNode: FilePageNode | undefined,
    rightNode: FilePageNode | undefined,
    candidateGroupIds?: Map<string, string | null>,
  ) {
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
  }

  function expandDragNodeIds(selectedIds: string[]) {
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
  }

  function findContainingGroupId(
    node: FilePageNode,
    position: Point,
    size: FilePageNode['size'],
    positions: Record<string, Point>,
  ) {
    if (node.kind === 'group') {
      return null;
    }

    const nodeBounds = getNodeBoundsWithSize(position, size, node.kind);
    const containingGroups = nodesRef.current
      .filter((candidate) => candidate.kind === 'group' && candidate.id !== node.id)
      .filter((candidate) => {
        const groupBounds = getGroupBounds(candidate.id, positions);

        if (!groupBounds) {
          return false;
        }

        return (
          nodeBounds.left >= groupBounds.left &&
          nodeBounds.top >= groupBounds.top &&
          nodeBounds.right <= groupBounds.right &&
          nodeBounds.bottom <= groupBounds.bottom
        );
      })
      .sort((left, right) => {
        const leftBounds = getNodeBoundsWithSize(
          positions[left.id] ?? left.position,
          draftSizes[left.id] ?? left.size,
          left.kind,
        );
        const rightBounds = getNodeBoundsWithSize(
          positions[right.id] ?? right.position,
          draftSizes[right.id] ?? right.size,
          right.kind,
        );
        const leftArea = (leftBounds.right - leftBounds.left) * (leftBounds.bottom - leftBounds.top);
        const rightArea =
          (rightBounds.right - rightBounds.left) * (rightBounds.bottom - rightBounds.top);

        return leftArea - rightArea;
      });

    return containingGroups[0]?.id ?? null;
  }

  function resolveInsertionPosition(node: Pick<FilePageNode, 'kind' | 'size'>) {
    const localPoint = contextMenuPointRef.current ?? {
      x: CANVAS_PADDING,
      y: CANVAS_PADDING,
    };
    const desiredPosition = {
      x: snapToSlotX(localPoint.x),
      y: snapToSlotY(localPoint.y),
    };
    const resolvedPositions = resolveSnapPositions(
      {
        anchor: desiredPosition,
      },
      ['anchor'],
      nodesRef.current,
      {
        anchor: desiredPosition,
      },
      {
        anchor: node.size,
      },
      (_leftNodeId, rightNodeId) =>
        canNodesShareSpace(
          {
            id: 'anchor',
            label: '',
            description: '',
            groupId: null,
            kind: node.kind,
            icon: 'shapes',
            position: desiredPosition,
            size: node.size,
          },
          nodesRef.current.find((entry) => entry.id === rightNodeId),
        ),
      {
        getNodeKind: (nodeId) => (nodeId === 'anchor' ? node.kind : undefined),
      },
    );

    return resolvedPositions.anchor ?? desiredPosition;
  }

  function addNodeAtContext(node: Omit<FilePageNode, 'position'>) {
    const nextNode = {
      ...node,
      position: resolveInsertionPosition(node),
    };

    onAddNode(nextNode);
    selectSingleNode(nextNode.id);
    contextMenuPointRef.current = null;
  }

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

  function clearNodeSizePreview(nodeId?: string) {
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
  }

  function clearNodeIconPreview(nodeId?: string) {
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
  }

  function canResizeNode(nodeId: string, size: FilePageNode['size']) {
    const resizingNode = nodesRef.current.find((node) => node.id === nodeId);

    if (!resizingNode) {
      return false;
    }

    if (resizingNode.kind === 'group') {
      const resizedContentBounds = getGroupContentBounds(resizingNode.position, size);
      const childFitsWithinGroup = nodesRef.current
        .filter((node) => node.groupId === resizingNode.id)
        .every((node) => {
          const childPosition = draftPositionsRef.current[node.id] ?? node.position;
          const childSize = draftSizes[node.id] ?? node.size;
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
  }

  function previewNodeResize(node: FilePageNode, size: FilePageNode['size']) {
    if (!canResizeNode(node.id, size)) {
      return;
    }

    setDraftSizes((current) => ({
      ...current,
      [node.id]: size,
    }));
  }

  function applyNodeResize(node: FilePageNode, size: FilePageNode['size']) {
    if (!canResizeNode(node.id, size)) {
      return;
    }

    clearNodeSizePreview(node.id);
    onResizeNode(node.id, size);
    onSelectNodes([node.id]);
  }

  function previewNodeIcon(node: FilePageNode, icon: FilePageElementIcon) {
    if (node.kind !== 'element') {
      return;
    }

    setDraftIcons((current) => ({
      ...current,
      [node.id]: icon,
    }));
  }

  function applyNodeIcon(node: FilePageNode, icon: FilePageElementIcon) {
    if (node.kind !== 'element') {
      return;
    }

    clearNodeIconPreview(node.id);
    onUpdateNode(node.id, { icon });
    onSelectNodes([node.id]);
  }

  function startNodeRename(node: FilePageNode) {
    setEditingNodeId(node.id);
    setEditingLabel(node.label);
    onSelectNodes([node.id]);
  }

  function commitNodeRename(node: FilePageNode) {
    const nextLabel = editingLabel.trim();

    if (nextLabel) {
      onUpdateNode(node.id, {
        label: nextLabel,
      });
    }

    setEditingNodeId(null);
    setEditingLabel('');
  }

  function stopNodeRename() {
    setEditingNodeId(null);
    setEditingLabel('');
  }

  function selectSingleNode(nodeId: string) {
    onSelectNodes([nodeId]);
    setDraftSelectedNodeIds([nodeId]);
  }

  function setNodeHover(node: FilePageNode, hovered: boolean) {
    if (!hovered && contextMenuNodeId === node.id) {
      return;
    }

    onHoverNodeChange(hovered ? node : null);
  }

  function setNodeContextMenuOpen(node: FilePageNode, open: boolean) {
    if (open) {
      setContextMenuNodeId(node.id);
      onHoverNodeChange(node);
      return;
    }

    setContextMenuNodeId((current) => (current === node.id ? null : current));
    onHoverNodeChange(null);
  }

  function deleteCanvasNode(node: FilePageNode) {
    if (node.kind !== 'group') {
      onDeleteNode(node.id);
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
          [childNode.id]: draftSizes[childNode.id] ?? childNode.size,
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
      onUpdateNode(childNode.id, { groupId: null });
    });

    if (Object.keys(dispersedPositions).length > 0) {
      onMoveNodes(dispersedPositions);
    }

    onDeleteNode(node.id);
  }

  function beginNodeResize(
    event: ReactPointerEvent<HTMLSpanElement>,
    node: FilePageNode,
    axis: 'x' | 'y' | 'both',
  ) {
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
      baseSize: draftSizes[node.id] ?? node.size,
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
  }

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
            'absolute inset-0 rounded-2xl border bg-transparent',
            isResizing
              ? 'border-sky-300/85 ring-2 ring-sky-200/80'
              : isSelected
                ? 'border-slate-900/25 ring-2 ring-slate-900/8'
                : 'border-slate-300/85',
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
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(100,116,139,0.34) 1.45px, transparent 1.55px)',
            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
            backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          }}
        >
          <div
            className="absolute inset-0"
            style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0)` }}
          >
            {renderedNodes.map((node) => {
            return (
              <FileCanvasNode
                key={node.id}
                canResize={(size) => canResizeNode(node.id, size)}
                displayPosition={draftPositions[node.id] ?? node.position}
                displaySize={draftSizes[node.id] ?? node.size}
                draftIcon={draftIcons[node.id]}
                editingLabel={editingLabel}
                isContextMenuOpen={contextMenuNodeId === node.id}
                isDragging={dragState?.nodeIds.includes(node.id) ?? false}
                isEditing={editingNodeId === node.id}
                isResizing={resizeState?.nodeId === node.id}
                isSelected={selectedIdSet.has(node.id)}
                node={node}
                snapPreviewPosition={snapPreviewPositions[node.id]}
                onApplyIcon={(icon) => applyNodeIcon(node, icon)}
                onApplyResize={(size) => applyNodeResize(node, size)}
                onClearIconPreview={() => clearNodeIconPreview(node.id)}
                onClearSizePreview={() => clearNodeSizePreview(node.id)}
                onCommitRename={() => commitNodeRename(node)}
                onContextMenu={() => {
                  setContextMenuNodeId(node.id);
                  onHoverNodeChange(node);
                  selectSingleNode(node.id);
                }}
                onContextMenuOpenChange={(open) => setNodeContextMenuOpen(node, open)}
                onDelete={() => deleteCanvasNode(node)}
                onEditingLabelChange={setEditingLabel}
                onHoverChange={(hovered) => setNodeHover(node, hovered)}
                onPointerDown={(event) => handleNodePointerDown(event, node)}
                onPreviewIcon={(icon) => previewNodeIcon(node, icon)}
                onPreviewResize={(size) => previewNodeResize(node, size)}
                onResizeHandlePointerDown={
                  node.kind === 'group'
                    ? (event, axis) => beginNodeResize(event, node, axis)
                    : undefined
                }
                onSelect={() => selectSingleNode(node.id)}
                showGroupHeader={node.kind !== 'group'}
                onStartRename={() => startNodeRename(node)}
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
