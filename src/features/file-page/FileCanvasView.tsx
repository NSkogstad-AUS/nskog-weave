import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  ExpandIcon,
  PencilLineIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/animate-ui/components/animate/tooltip';
import { cn } from '@/lib/utils';
import { CANVAS_PADDING, GRID_SIZE, NODE_CARD_CLASS } from './canvas/constants';
import {
  ELEMENT_ICON_META,
  NODE_META,
  RESIZE_OPTIONS,
  ResizeOptionSwatch,
} from './canvas/meta';
import {
  boundsOverlap,
  clampToCanvas,
  getNodeBoundsWithSize,
  getNodeDimensions,
  normalizeRectangle,
  rectanglesIntersect,
  resolveSnapPositions,
  snapToSlotX,
  snapToSlotY,
} from './canvas/utils';
import type { FilePageElementIcon, FilePageNode } from '@/types/filePage';
import type { Point } from '@/types/geometry';

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
  onUpdateNode: (
    nodeId: string,
    updates: Partial<Pick<FilePageNode, 'label' | 'description' | 'icon' | 'size'>>,
  ) => void;
  onDeleteNode: (nodeId: string) => void;
  onHoverNodeChange: (node: FilePageNode | null) => void;
  onSelectNodes: (nodeIds: string[]) => void;
}

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
  const [draftIcons, setDraftIcons] = useState<Record<string, FilePageElementIcon>>({});
  const [draftSelectedNodeIds, setDraftSelectedNodeIds] = useState<string[] | null>(null);
  const [contextMenuNodeId, setContextMenuNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
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
      description: 'Freeform canvas object for quick thinking and placement.',
      kind: 'element',
      icon: 'sparkles',
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
          className="relative h-full min-h-[34rem] overflow-hidden rounded-none border border-slate-200/80 bg-white/78 shadow-[0_36px_90px_-58px_rgba(15,23,42,0.22)] touch-none"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(148,163,184,0.28) 1.15px, transparent 1.2px)',
            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
          }}
        >
          {nodes.map((node) => {
            const meta = NODE_META[node.kind];
            const elementIcon = draftIcons[node.id] ?? node.icon;
            const elementMeta = node.kind === 'element' ? ELEMENT_ICON_META[elementIcon] : null;
            const Icon = elementMeta?.icon ?? meta.icon;
            const isSelected = selectedIdSet.has(node.id);
            const displaySize = draftSizes[node.id] ?? node.size;
            const dimensions = getNodeDimensions(displaySize);
            const displayPosition = draftPositions[node.id] ?? node.position;
            const snapPreviewPosition = snapPreviewPositions[node.id];
            const isCompactNode = displaySize.widthUnits === 1;
            const showCompactElementTooltip = node.kind === 'element' && isCompactNode;
            const showNodeLabel = displaySize.widthUnits >= 2;
            const showNodeDescription =
              displaySize.widthUnits >= 3 && node.description.trim().length > 0;
            const isEditing = editingNodeId === node.id;
            const buttonNode = (
              <button
                type="button"
                onPointerDown={(event) => handleNodePointerDown(event, node)}
                onPointerEnter={() => onHoverNodeChange(node)}
                onPointerLeave={() => {
                  if (contextMenuNodeId !== node.id) {
                    onHoverNodeChange(null);
                  }
                }}
                onContextMenu={(event) => {
                  event.stopPropagation();
                  setContextMenuNodeId(node.id);
                  onHoverNodeChange(node);
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
                <div
                  className={cn(
                    'flex h-full items-start justify-between gap-3',
                    isCompactNode && 'items-center justify-center p-0',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center gap-2.5',
                      isCompactNode && 'h-full w-full items-center justify-center gap-0',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white/75',
                        isCompactNode &&
                          'size-12 rounded-none border-transparent bg-transparent shadow-none',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-4 text-slate-600',
                          isCompactNode && 'size-7 text-slate-500',
                        )}
                      />
                    </span>
                    {!isCompactNode ? (
                      <div className="min-w-0">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editingLabel}
                            onChange={(event) => setEditingLabel(event.target.value)}
                            onBlur={() => commitNodeRename(node)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                commitNodeRename(node);
                              }
                              if (event.key === 'Escape') {
                                setEditingNodeId(null);
                                setEditingLabel('');
                              }
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            className="w-full rounded-md border border-slate-200/90 bg-white/90 px-2 py-1 text-sm font-medium text-slate-950 outline-none ring-0"
                          />
                        ) : showNodeLabel ? (
                          <div className="truncate text-sm font-medium text-slate-950">
                            {node.label}
                          </div>
                        ) : null}
                        {showNodeDescription ? (
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                            {node.description}
                          </div>
                        ) : (
                          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                            {elementMeta?.label ?? meta.eyebrow}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </button>
            );

            return (
              <ContextMenu
                key={node.id}
                onOpenChange={(open) => {
                  if (open) {
                    setContextMenuNodeId(node.id);
                    onHoverNodeChange(node);
                  } else {
                    setContextMenuNodeId((current) => (current === node.id ? null : current));
                    onHoverNodeChange(null);
                  }

                  if (!open) {
                    clearNodeSizePreview(node.id);
                    clearNodeIconPreview(node.id);
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
                  {showCompactElementTooltip ? (
                    <TooltipProvider openDelay={0}>
                      <Tooltip side="bottom" sideOffset={8}>
                        <TooltipTrigger asChild>
                          <ContextMenuTrigger asChild>{buttonNode}</ContextMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent className="rounded-md border border-slate-200/80 bg-white/95 text-slate-700 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.35)]">
                          {node.label}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <ContextMenuTrigger asChild>{buttonNode}</ContextMenuTrigger>
                  )}
                  <ContextMenuContent side="right" className="ml-2 w-52">
                    <ContextMenuItem
                      onSelect={() => startNodeRename(node)}
                    >
                      <PencilLineIcon className="size-4" />
                      Rename
                    </ContextMenuItem>
                    {node.kind === 'element' ? (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Icon className="size-4" />
                          Change icon
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent
                          className="w-48"
                          onPointerLeave={() => clearNodeIconPreview(node.id)}
                        >
                          <div className="grid grid-cols-2 gap-1.5 p-1">
                            {Object.entries(ELEMENT_ICON_META).map(([iconKey, iconMeta]) => {
                              const IconOption = iconMeta.icon;

                              return (
                                <ContextMenuItem
                                  key={iconKey}
                                  onFocus={() =>
                                    previewNodeIcon(node, iconKey as FilePageElementIcon)
                                  }
                                  onPointerEnter={() =>
                                    previewNodeIcon(node, iconKey as FilePageElementIcon)
                                  }
                                  onSelect={() =>
                                    applyNodeIcon(node, iconKey as FilePageElementIcon)
                                  }
                                  className={cn(
                                    'min-h-0 rounded-xl p-2',
                                    elementIcon === iconKey && 'bg-sidebar-accent/55',
                                  )}
                                >
                                  <span className="flex w-full items-center gap-2">
                                    <span className="flex size-8 items-center justify-center rounded-lg border border-slate-200/80 bg-white/90">
                                      <IconOption className="size-4 text-slate-600" />
                                    </span>
                                    <span className="text-sm text-slate-700">{iconMeta.label}</span>
                                  </span>
                                </ContextMenuItem>
                              );
                            })}
                          </div>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    ) : null}
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
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onSelect={() => onDeleteNode(node.id)}
                    >
                      <Trash2Icon className="size-4" />
                      Delete
                    </ContextMenuItem>
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
