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
  GROUP_MIN_GRID_UNITS,
  SLOT_STEP_X,
  SLOT_STEP_Y,
} from './canvas/constants';
import { FileCanvasNode } from './canvas/FileCanvasNode';
import {
  boundsOverlap,
  clampToCanvas,
  getNodeBoundsWithSize,
  getNodeDimensions,
  getUnitsForDimension,
  normalizeRectangle,
  rectanglesIntersect,
  resolveSnapPositions,
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

type PanState = {
  origin: Point;
  baseViewport: Point;
};

type ResizeState = {
  nodeId: string;
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

        const baseDimensions = getNodeDimensions(liveResizeState.baseSize);
        const currentSize = draftSizes[resizingNode.id] ?? resizingNode.size;
        const candidateSize = {
          widthUnits: getUnitsForDimension(
            baseDimensions.width + (localPoint.x - liveResizeState.origin.x),
            SLOT_STEP_X,
            liveResizeState.minimumSize.widthUnits,
          ),
          heightUnits: getUnitsForDimension(
            baseDimensions.height + (localPoint.y - liveResizeState.origin.y),
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
      const liveResizeState = resizeStateRef.current;

      if (liveDragState && Object.keys(liveSnapPreviewPositions).length > 0) {
        onMoveNodes(liveSnapPreviewPositions);
        draftPositionsRef.current = liveSnapPreviewPositions;
        setDraftPositions(liveSnapPreviewPositions);
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

  function resolveInsertionPosition(size: FilePageNode['size']) {
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
        anchor: size,
      },
    );

    return resolvedPositions.anchor ?? desiredPosition;
  }

  function addNodeAtContext(node: Omit<FilePageNode, 'position'>) {
    const nextNode = {
      ...node,
      position: resolveInsertionPosition(node.size),
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

  function beginNodeResize(
    event: ReactPointerEvent<HTMLSpanElement>,
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

    const nextResizeState = {
      nodeId: node.id,
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
            {nodes.map((node) => {
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
                onDelete={() => onDeleteNode(node.id)}
                onEditingLabelChange={setEditingLabel}
                onHoverChange={(hovered) => setNodeHover(node, hovered)}
                onPointerDown={(event) => handleNodePointerDown(event, node)}
                onPreviewIcon={(icon) => previewNodeIcon(node, icon)}
                onPreviewResize={(size) => previewNodeResize(node, size)}
                onResizeHandlePointerDown={
                  node.kind === 'group'
                    ? (event) => beginNodeResize(event, node)
                    : undefined
                }
                onSelect={() => selectSingleNode(node.id)}
                onStartRename={() => startNodeRename(node)}
                onStopRename={stopNodeRename}
              />
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
