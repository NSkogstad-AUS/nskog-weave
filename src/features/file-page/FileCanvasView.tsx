import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  FileTextIcon,
  FolderIcon,
  SparklesIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { FilePageNode } from '@/types/filePage';
import type { Point } from '@/types/workspace';

interface FileCanvasViewProps {
  nodes: FilePageNode[];
  selectedNodeIds: string[];
  onMoveNodes: (positions: Record<string, Point>) => void;
  onSelectNodes: (nodeIds: string[]) => void;
}

const GRID_SIZE = 64;
const CANVAS_PADDING = 32;
const NODE_WIDTH = 208;
const NODE_HEIGHT = 76;

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

export function FileCanvasView({
  nodes,
  selectedNodeIds,
  onMoveNodes,
  onSelectNodes,
}: FileCanvasViewProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
  const [draftPositions, setDraftPositions] = useState<Record<string, Point>>({});
  const [draftSelectedNodeIds, setDraftSelectedNodeIds] = useState<string[] | null>(null);
  const displaySelectedNodeIds = draftSelectedNodeIds ?? selectedNodeIds;
  const selectedIdSet = new Set(displaySelectedNodeIds);
  const hasDraftPositions = Object.keys(draftPositions).length > 0;

  useEffect(() => {
    if (!dragState && !marqueeState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const localPoint = getLocalPoint(event.clientX, event.clientY);

      if (!localPoint) {
        return;
      }

      if (dragState) {
        const nextPositions = dragState.nodeIds.reduce<Record<string, Point>>(
          (positions, nodeId) => {
            const basePosition = dragState.basePositions[nodeId];
            const nextX = basePosition.x + (localPoint.x - dragState.origin.x);
            const nextY = basePosition.y + (localPoint.y - dragState.origin.y);

            positions[nodeId] = {
              x: clampToCanvas(snapToGrid(nextX)),
              y: clampToCanvas(snapToGrid(nextY)),
            };

            return positions;
          },
          {},
        );

        setDraftPositions((current) =>
          positionsChanged(current, nextPositions) ? nextPositions : current,
        );
        return;
      }

      if (!marqueeState) {
        return;
      }

      const nextMarquee = {
        ...marqueeState,
        current: localPoint,
      };
      const marqueeRect = normalizeRectangle(marqueeState.origin, localPoint);
      const intersectingIds = nodes
        .filter((node) =>
          rectanglesIntersect(marqueeRect, {
            left: (draftPositions[node.id] ?? node.position).x,
            top: (draftPositions[node.id] ?? node.position).y,
            right: (draftPositions[node.id] ?? node.position).x + NODE_WIDTH,
            bottom: (draftPositions[node.id] ?? node.position).y + NODE_HEIGHT,
          }),
        )
        .map((node) => node.id);

      setDraftSelectedNodeIds(
        marqueeState.additive
          ? Array.from(new Set([...marqueeState.initialSelection, ...intersectingIds]))
          : intersectingIds,
      );
      setMarqueeState(nextMarquee);
    };

    const handlePointerUp = () => {
      if (dragState && hasDraftPositions) {
        onMoveNodes(draftPositions);
      }

      if (marqueeState) {
        onSelectNodes(draftSelectedNodeIds ?? (marqueeState.additive ? marqueeState.initialSelection : []));
      }

      setDragState(null);
      setMarqueeState(null);
      setDraftPositions({});
      setDraftSelectedNodeIds(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [
    dragState,
    draftPositions,
    draftSelectedNodeIds,
    hasDraftPositions,
    marqueeState,
    nodes,
    onMoveNodes,
    onSelectNodes,
  ]);

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
    setDragState({
      nodeIds: nextSelectedIds,
      origin: localPoint,
      basePositions: nextSelectedIds.reduce<Record<string, Point>>((positions, nodeId) => {
        const selectedNode = nodes.find((candidate) => candidate.id === nodeId);

        if (selectedNode) {
          positions[nodeId] = selectedNode.position;
        }

        return positions;
      }, {}),
    });
  }

  return (
    <div
      ref={canvasRef}
      onPointerDown={(event) => {
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

          if (!event.shiftKey) {
            setDraftSelectedNodeIds([]);
          } else {
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
        const displayPosition = draftPositions[node.id] ?? node.position;

        return (
          <button
            key={node.id}
            type="button"
            onPointerDown={(event) => handleNodePointerDown(event, node)}
            className={cn(
              'absolute w-52 cursor-grab rounded-2xl border px-4 py-3 text-left shadow-[0_18px_40px_-30px_rgba(15,23,42,0.28)] transition-[transform,box-shadow,border-color] duration-75 active:cursor-grabbing will-change-transform',
              meta.className,
              dragState?.nodeIds.includes(node.id) &&
                'shadow-[0_24px_52px_-28px_rgba(15,23,42,0.34)]',
              isSelected && 'border-slate-900/25 ring-2 ring-slate-900/8',
            )}
            style={{
              transform: `translate3d(${displayPosition.x}px, ${displayPosition.y}px, 0)`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white/75">
                  <Icon className="size-4 text-slate-600" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-950">{node.label}</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                    {meta.eyebrow}
                  </div>
                </div>
              </div>
            </div>
          </button>
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
  );
}
