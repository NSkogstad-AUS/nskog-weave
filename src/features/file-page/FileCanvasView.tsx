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
  selectedNodeId: string | null;
  onMoveNode: (nodeId: string, position: Point) => void;
  onSelectNode: (nodeId: string | null) => void;
}

type DragState = {
  nodeId: string;
  origin: Point;
  basePosition: Point;
};

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
  selectedNodeId,
  onMoveNode,
  onSelectNode,
}: FileCanvasViewProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const localPoint = getLocalPoint(event.clientX, event.clientY);

      if (!localPoint) {
        return;
      }

      onMoveNode(dragState.nodeId, {
        x: Math.max(24, dragState.basePosition.x + (localPoint.x - dragState.origin.x)),
        y: Math.max(24, dragState.basePosition.y + (localPoint.y - dragState.origin.y)),
      });
    };

    const handlePointerUp = () => {
      setDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragState, onMoveNode]);

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

    onSelectNode(node.id);
    setDragState({
      nodeId: node.id,
      origin: localPoint,
      basePosition: node.position,
    });
  }

  return (
    <div
      ref={canvasRef}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onSelectNode(null);
        }
      }}
      className="relative h-full min-h-[34rem] overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/78 shadow-[0_36px_90px_-58px_rgba(15,23,42,0.22)]"
      style={{
        backgroundImage:
          'radial-gradient(circle, rgba(148,163,184,0.28) 1.15px, transparent 1.2px)',
        backgroundSize: '18px 18px',
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
        <span>Canvas</span>
        <span>Drag folders and items</span>
      </div>

      {nodes.map((node) => {
        const meta = NODE_META[node.kind];
        const Icon = meta.icon;
        const isSelected = selectedNodeId === node.id;

        return (
          <button
            key={node.id}
            type="button"
            onPointerDown={(event) => handleNodePointerDown(event, node)}
            className={cn(
              'absolute w-52 cursor-grab rounded-2xl border px-4 py-3 text-left shadow-[0_18px_40px_-30px_rgba(15,23,42,0.28)] transition-transform active:cursor-grabbing',
              meta.className,
              isSelected && 'border-slate-900/25 ring-2 ring-slate-900/8',
            )}
            style={{
              transform: `translate(${node.position.x}px, ${node.position.y}px)`,
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
    </div>
  );
}
