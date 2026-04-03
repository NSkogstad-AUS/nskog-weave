import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  ExpandIcon,
  PlusIcon,
  FileTextIcon,
  FolderIcon,
  SparklesIcon,
} from 'lucide-react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { FilePageNode } from '@/types/filePage';
import type { Point } from '@/types/workspace';

interface FileCanvasViewProps {
  nodes: FilePageNode[];
  selectedNodeIds: string[];
  onMoveNodes: (positions: Record<string, Point>) => void;
  onResizeNode: (
    nodeId: string,
    size: {
      widthUnits: 1 | 2 | 3;
      heightUnits: 1 | 2 | 3;
    },
  ) => void;
  onAddNode: (node: FilePageNode) => void;
  onSelectNodes: (nodeIds: string[]) => void;
}

const GRID_SIZE = 64;
const CANVAS_PADDING = 32;
const NODE_UNIT = 96;
const SLOT_GAP_X = 16;
const SLOT_GAP_Y = 16;
const SLOT_STEP_X = NODE_UNIT + SLOT_GAP_X;
const SLOT_STEP_Y = NODE_UNIT + SLOT_GAP_Y;
const COLLISION_GAP = 10;
const NODE_CARD_CLASS = 'absolute rounded-2xl border px-4 py-3 text-left';

type DragState = {
  nodeIds: string[];
  origin: Point;
  basePositions: Record<string, Point>;
};

type MarqueeState = {
  origin: Point;
  current: Point;
  additive: boolean;
  initialSelection: string[];
};

function positionsChanged(
  current: Record<string, Point>,
  next: Record<string, Point>,
) {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);

  if (currentKeys.length !== nextKeys.length) {
    return true;
  }

  return nextKeys.some((key) => {
    const currentPoint = current[key];
    const nextPoint = next[key];

    return !currentPoint || currentPoint.x !== nextPoint.x || currentPoint.y !== nextPoint.y;
  });
}

function snapToGrid(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function clampToCanvas(value: number) {
  return Math.max(CANVAS_PADDING, value);
}

function clampUnits(value: number): 1 | 2 | 3 {
  return Math.max(1, Math.min(3, value)) as 1 | 2 | 3;
}

function snapToSlotX(value: number) {
  return (
    CANVAS_PADDING +
    Math.round((clampToCanvas(value) - CANVAS_PADDING) / SLOT_STEP_X) * SLOT_STEP_X
  );
}

function snapToSlotY(value: number) {
  return (
    CANVAS_PADDING +
    Math.round((clampToCanvas(value) - CANVAS_PADDING) / SLOT_STEP_Y) * SLOT_STEP_Y
  );
}

function normalizeRectangle(start: Point, end: Point) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

function rectanglesIntersect(
  left: ReturnType<typeof normalizeRectangle>,
  right: ReturnType<typeof normalizeRectangle>,
) {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

function getNodeBounds(position: Point) {
  return getNodeBoundsWithSize(position, {
    widthUnits: 1,
    heightUnits: 1,
  });
}

function getNodeDimensions(size: FilePageNode['size']) {
  return {
    width: NODE_UNIT + (size.widthUnits - 1) * SLOT_STEP_X,
    height: NODE_UNIT + (size.heightUnits - 1) * SLOT_STEP_Y,
  };
}

function getNodeBoundsWithSize(position: Point, size: FilePageNode['size']) {
  const dimensions = getNodeDimensions(size);

  return {
    left: position.x,
    top: position.y,
    right: position.x + dimensions.width,
    bottom: position.y + dimensions.height,
  };
}

function boundsOverlap(
  left: ReturnType<typeof getNodeBounds>,
  right: ReturnType<typeof getNodeBounds>,
) {
  return !(
    left.right + COLLISION_GAP <= right.left ||
    left.left >= right.right + COLLISION_GAP ||
    left.bottom + COLLISION_GAP <= right.top ||
    left.top >= right.bottom + COLLISION_GAP
  );
}

function buildCandidateAnchors(origin: Point) {
  const baseColumn = Math.round((snapToSlotX(origin.x) - CANVAS_PADDING) / SLOT_STEP_X);
  const baseRow = Math.round((snapToSlotY(origin.y) - CANVAS_PADDING) / SLOT_STEP_Y);
  const candidates: Point[] = [];
  const seen = new Set<string>();

  for (let radius = 0; radius <= 10; radius += 1) {
    const offsets =
      radius === 0
        ? [[0, 0]]
        : [
            [0, -radius],
            [radius, 0],
            [0, radius],
            [-radius, 0],
            ...Array.from({ length: radius - 1 }, (_, index) => index + 1).flatMap((step) => [
              [step, -radius + step],
              [radius - step, step],
              [-step, radius - step],
              [-radius + step, -step],
            ]),
          ];

    offsets.forEach(([columnOffset, rowOffset]) => {
      const column = baseColumn + columnOffset;
      const row = baseRow + rowOffset;
      const key = `${column}:${row}`;

      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      candidates.push({
        x: CANVAS_PADDING + column * SLOT_STEP_X,
        y: CANVAS_PADDING + row * SLOT_STEP_Y,
      });
    });
  }

  return candidates;
}

function resolveSnapPositions(
  desiredPositions: Record<string, Point>,
  dragNodeIds: string[],
  stationaryNodes: FilePageNode[],
  basePositions: Record<string, Point>,
  nodeSizes: Record<string, FilePageNode['size']>,
) {
  const anchorId = dragNodeIds[0];
  const anchorBasePosition = basePositions[anchorId];
  const anchorDesiredPosition = desiredPositions[anchorId];

  if (!anchorBasePosition || !anchorDesiredPosition) {
    return desiredPositions;
  }

  const relativeOffsets = dragNodeIds.reduce<Record<string, Point>>((offsets, nodeId) => {
    const basePosition = basePositions[nodeId];

    if (basePosition) {
      offsets[nodeId] = {
        x: basePosition.x - anchorBasePosition.x,
        y: basePosition.y - anchorBasePosition.y,
      };
    }

    return offsets;
  }, {});
  const stationaryBounds = stationaryNodes.map((node) =>
    getNodeBoundsWithSize(node.position, node.size),
  );

  for (const anchorCandidate of buildCandidateAnchors(anchorDesiredPosition)) {
    const candidatePositions = dragNodeIds.reduce<Record<string, Point>>((positions, nodeId) => {
      const offset = relativeOffsets[nodeId] ?? { x: 0, y: 0 };

      positions[nodeId] = {
        x: clampToCanvas(anchorCandidate.x + offset.x),
        y: clampToCanvas(anchorCandidate.y + offset.y),
      };

      return positions;
    }, {});
    const candidateBounds = dragNodeIds.map((nodeId) =>
      getNodeBoundsWithSize(
        candidatePositions[nodeId],
        nodeSizes[nodeId] ?? { widthUnits: 1, heightUnits: 1 },
      ),
    );
    const collidesWithStationary = candidateBounds.some((bounds) =>
      stationaryBounds.some((stationary) => boundsOverlap(bounds, stationary)),
    );

    if (collidesWithStationary) {
      continue;
    }

    const collidesWithinGroup = candidateBounds.some((bounds, index) =>
      candidateBounds.some(
        (otherBounds, otherIndex) =>
          index !== otherIndex && boundsOverlap(bounds, otherBounds),
      ),
    );

    if (!collidesWithinGroup) {
      return candidatePositions;
    }
  }

  return desiredPositions;
}

const NODE_META = {
  folder: {
    icon: FolderIcon,
    eyebrow: 'Folder',
    className: 'border-slate-200/80 bg-white/95',
  },
  file: {
    icon: FileTextIcon,
    eyebrow: 'File',
    className: 'border-slate-200/80 bg-white/98',
  },
  element: {
    icon: SparklesIcon,
    eyebrow: 'Element',
    className: 'border-sky-200/80 bg-sky-50/90',
  },
} satisfies Record<
  FilePageNode['kind'],
  {
    icon: typeof FolderIcon;
    eyebrow: string;
    className: string;
  }
>;

const RESIZE_OPTIONS = [
  { widthUnits: 1, heightUnits: 1 },
  { widthUnits: 2, heightUnits: 1 },
  { widthUnits: 3, heightUnits: 1 },
  { widthUnits: 1, heightUnits: 2 },
  { widthUnits: 2, heightUnits: 2 },
  { widthUnits: 3, heightUnits: 2 },
  { widthUnits: 1, heightUnits: 3 },
  { widthUnits: 2, heightUnits: 3 },
  { widthUnits: 3, heightUnits: 3 },
] satisfies FilePageNode['size'][];

function ResizeOptionSwatch({ size }: { size: FilePageNode['size'] }) {
  return (
    <span className="grid grid-cols-3 grid-rows-3 gap-0.5">
      {Array.from({ length: 9 }, (_, index) => {
        const column = (index % 3) + 1;
        const row = Math.floor(index / 3) + 1;
        const isActive = column <= size.widthUnits && row <= size.heightUnits;

        return (
          <span
            key={`${column}-${row}`}
            className={cn(
              'size-2 rounded-[3px] border transition-colors',
              isActive
                ? 'border-sky-300/80 bg-sky-300/75'
                : 'border-slate-200/80 bg-slate-100/90',
            )}
          />
        );
      })}
    </span>
  );
}

export function FileCanvasView({
  nodes,
  selectedNodeIds,
  onMoveNodes,
  onResizeNode,
  onAddNode,
  onSelectNodes,
}: FileCanvasViewProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const marqueeStateRef = useRef<MarqueeState | null>(null);
  const draftPositionsRef = useRef<Record<string, Point>>({});
  const snapPreviewPositionsRef = useRef<Record<string, Point>>({});
  const draftSelectedNodeIdsRef = useRef<string[] | null>(null);
  const contextMenuPointRef = useRef<Point | null>(null);
  const nodesRef = useRef(nodes);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
  const [draftPositions, setDraftPositions] = useState<Record<string, Point>>({});
  const [snapPreviewPositions, setSnapPreviewPositions] = useState<Record<string, Point>>({});
  const [draftSizes, setDraftSizes] = useState<Record<string, FilePageNode['size']>>({});
  const [draftSelectedNodeIds, setDraftSelectedNodeIds] = useState<string[] | null>(null);
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
    draftPositionsRef.current = draftPositions;
  }, [draftPositions]);

  useEffect(() => {
    snapPreviewPositionsRef.current = snapPreviewPositions;
  }, [snapPreviewPositions]);

  useEffect(() => {
    draftSelectedNodeIdsRef.current = draftSelectedNodeIds;
  }, [draftSelectedNodeIds]);

  useEffect(() => {
    return () => {
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
      }
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const liveDragState = dragStateRef.current;
      const liveMarqueeState = marqueeStateRef.current;

      if (!liveDragState && !liveMarqueeState) {
        return;
      }

      const localPoint = getLocalPoint(event.clientX, event.clientY);

      if (!localPoint) {
        return;
      }

      if (liveDragState) {
        const nextDraftPositions = liveDragState.nodeIds.reduce<Record<string, Point>>(
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
        const desiredSnapPositions = liveDragState.nodeIds.reduce<Record<string, Point>>(
          (positions, nodeId) => {
            const draftPosition = nextDraftPositions[nodeId];

            positions[nodeId] = {
              x: snapToSlotX(draftPosition.x),
              y: snapToSlotY(draftPosition.y),
            };

            return positions;
          },
          {},
        );
        const nextSnapPositions = resolveSnapPositions(
          desiredSnapPositions,
          liveDragState.nodeIds,
          nodesRef.current.filter((node) => !liveDragState.nodeIds.includes(node.id)),
          liveDragState.basePositions,
          Object.fromEntries(
            nodesRef.current.map((node) => [node.id, draftSizes[node.id] ?? node.size]),
          ),
        );

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
          const dimensions = getNodeDimensions(size);

          return rectanglesIntersect(marqueeRect, {
            left: position.x,
            top: position.y,
            right: position.x + dimensions.width,
            bottom: position.y + dimensions.height,
          });
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

      if (liveDragState && Object.keys(liveSnapPreviewPositions).length > 0) {
        onMoveNodes(liveSnapPreviewPositions);
        draftPositionsRef.current = liveSnapPreviewPositions;
        setDraftPositions(liveSnapPreviewPositions);
      }

      if (liveMarqueeState) {
        onSelectNodes(
          draftSelectedNodeIdsRef.current ??
            (liveMarqueeState.additive ? liveMarqueeState.initialSelection : []),
        );
      }

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
  }, [draftSizes, onMoveNodes, onSelectNodes]);

  function getLocalPoint(clientX: number, clientY: number) {
    if (!canvasRef.current) {
      return null;
    }

    const rect = canvasRef.current.getBoundingClientRect();

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
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

    onSelectNodes(nextSelectedIds);
    setDraftSelectedNodeIds(nextSelectedIds);
    const nextDragState = {
      nodeIds: nextSelectedIds,
      origin: localPoint,
      basePositions: nextSelectedIds.reduce<Record<string, Point>>((positions, nodeId) => {
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
    if (event.target !== event.currentTarget) {
      return;
    }

    const localPoint = getLocalPoint(event.clientX, event.clientY);

    contextMenuPointRef.current = localPoint;
  }

  function handleAddBasicElement() {
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
        anchor: {
          widthUnits: 1,
          heightUnits: 1,
        },
      },
    );
    const nextPosition = resolvedPositions.anchor ?? desiredPosition;
    const nextNode: FilePageNode = {
      id: `element-${Date.now()}`,
      label: 'Basic element',
      kind: 'element',
      position: nextPosition,
      size: {
        widthUnits: 1,
        heightUnits: 1,
      },
    };

    onAddNode(nextNode);
    onSelectNodes([nextNode.id]);
    contextMenuPointRef.current = null;
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

  function canResizeNode(nodeId: string, size: FilePageNode['size']) {
    const resizingNode = nodesRef.current.find((node) => node.id === nodeId);

    if (!resizingNode) {
      return false;
    }

    const resizedBounds = getNodeBoundsWithSize(resizingNode.position, size);

    return !nodesRef.current
      .filter((node) => node.id !== nodeId)
      .some((node) => boundsOverlap(resizedBounds, getNodeBoundsWithSize(node.position, node.size)));
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={canvasRef}
          onContextMenu={handleCanvasContextMenu}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            if (event.target === event.currentTarget) {
              const localPoint = getLocalPoint(event.clientX, event.clientY);

              if (!localPoint) {
                onSelectNodes([]);
                return;
              }

              setMarqueeState({
                origin: localPoint,
                current: localPoint,
                additive: event.shiftKey,
                initialSelection: selectedNodeIds,
              });
              marqueeStateRef.current = {
                origin: localPoint,
                current: localPoint,
                additive: event.shiftKey,
                initialSelection: selectedNodeIds,
              };

              if (!event.shiftKey) {
                draftSelectedNodeIdsRef.current = [];
                setDraftSelectedNodeIds([]);
              } else {
                draftSelectedNodeIdsRef.current = selectedNodeIds;
                setDraftSelectedNodeIds(selectedNodeIds);
              }
            }
          }}
          className="relative h-full min-h-[34rem] overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/78 shadow-[0_36px_90px_-58px_rgba(15,23,42,0.22)] touch-none"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(148,163,184,0.28) 1.15px, transparent 1.2px)',
            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
          }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            <span>Canvas</span>
            <span>
              {displaySelectedNodeIds.length > 1
                ? `${displaySelectedNodeIds.length} selected · marquee or drag`
                : 'Drag folders and items · snaps to grid'}
            </span>
          </div>

          {nodes.map((node) => {
            const meta = NODE_META[node.kind];
            const Icon = meta.icon;
            const isSelected = selectedIdSet.has(node.id);
            const displaySize = draftSizes[node.id] ?? node.size;
            const dimensions = getNodeDimensions(displaySize);
            const displayPosition = draftPositions[node.id] ?? node.position;
            const snapPreviewPosition = snapPreviewPositions[node.id];

            return (
              <ContextMenu
                key={node.id}
                onOpenChange={(open) => {
                  if (!open) {
                    clearNodeSizePreview(node.id);
                  }
                }}
              >
                <>
                  {dragState?.nodeIds.includes(node.id) && snapPreviewPosition ? (
                    <div
                      aria-hidden="true"
                      className={cn(
                        NODE_CARD_CLASS,
                        'pointer-events-none border-sky-300/70 bg-sky-100/40 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.15)] transition-[transform,opacity] duration-150 ease-out',
                      )}
                      style={{
                        width: dimensions.width,
                        height: dimensions.height,
                        transform: `translate3d(${snapPreviewPosition.x}px, ${snapPreviewPosition.y}px, 0)`,
                      }}
                    />
                  ) : null}
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      onPointerDown={(event) => handleNodePointerDown(event, node)}
                      onContextMenu={(event) => {
                        event.stopPropagation();
                        onSelectNodes([node.id]);
                        setDraftSelectedNodeIds([node.id]);
                      }}
                      className={cn(
                        NODE_CARD_CLASS,
                        'cursor-grab shadow-[0_18px_40px_-30px_rgba(15,23,42,0.28)] active:cursor-grabbing will-change-transform',
                        meta.className,
                        dragState?.nodeIds.includes(node.id) &&
                          'z-20 shadow-[0_24px_52px_-28px_rgba(15,23,42,0.34)] transition-none',
                        !dragState?.nodeIds.includes(node.id) &&
                          'transition-[transform,box-shadow,border-color,opacity,width,height] duration-150',
                        snapPreviewPosition && dragState?.nodeIds.includes(node.id) && 'opacity-94',
                        isSelected && 'border-slate-900/25 ring-2 ring-slate-900/8',
                      )}
                      style={{
                        width: dimensions.width,
                        height: dimensions.height,
                        transform: `translate3d(${displayPosition.x}px, ${displayPosition.y}px, 0)`,
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white/75">
                            <Icon className="size-4 text-slate-600" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-950">
                              {node.label}
                            </div>
                            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                              {meta.eyebrow}
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent side="right" className="ml-2 w-52">
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <ExpandIcon className="size-4" />
                        Resize
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent
                        className="w-[15rem]"
                        onPointerLeave={() => clearNodeSizePreview(node.id)}
                      >
                        <div className="grid grid-cols-3 gap-1.5 p-1">
                          {RESIZE_OPTIONS.map((size) => {
                            const isAvailable = canResizeNode(node.id, size);
                            const isCurrent =
                              node.size.widthUnits === size.widthUnits &&
                              node.size.heightUnits === size.heightUnits;

                            return (
                              <ContextMenuItem
                                key={`${size.widthUnits}x${size.heightUnits}`}
                                disabled={!isAvailable}
                                onFocus={() => previewNodeResize(node, size)}
                                onPointerEnter={() => previewNodeResize(node, size)}
                                onSelect={() => applyNodeResize(node, size)}
                                className={cn(
                                  'min-h-0 flex-col items-start gap-1.5 rounded-xl p-2',
                                  isCurrent && 'bg-sidebar-accent/55',
                                )}
                              >
                                <span className="flex h-12 w-full items-center justify-center rounded-lg border border-slate-200/80 bg-white/90">
                                  <ResizeOptionSwatch size={size} />
                                </span>
                                <span className="text-[11px] font-medium text-slate-600">
                                  {size.widthUnits} x {size.heightUnits}
                                </span>
                              </ContextMenuItem>
                            );
                          })}
                        </div>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  </ContextMenuContent>
                </>
              </ContextMenu>
            );
          })}

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
      </ContextMenuTrigger>
      <ContextMenuContent className="ml-2 w-52">
        <ContextMenuItem onSelect={handleAddBasicElement}>
          <PlusIcon className="size-4" />
          Add basic element
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
