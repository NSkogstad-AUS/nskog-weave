/**
 * useCanvasLayout — spatial/layout computation hook.
 *
 * Provides stable callbacks for group containment, node collision, snap origin
 * resolution, and drag-layout constraint logic. All functions read exclusively
 * from refs and receive explicit position maps, so they remain stable across
 * renders and are safe to call inside pointer-event handlers.
 */

import { useCallback } from 'react';
import type { RefObject } from 'react';

import type { FilePageNode } from '@/types/filePage';
import type { Point } from '@/types/geometry';
import {
  clampNodePositionToBounds,
  boundsOverlap,
  getGroupContentBounds,
  getNodeBoundsWithSize,
  getNodeDimensionsForKind,
} from './utils';
import {
  GROUP_SNAP_TOLERANCE,
  OUTER_WIDGET_SNAP_THRESHOLD,
  WORKER_CONNECTION_THRESHOLD_X,
  WORKER_CONNECTION_THRESHOLD_Y,
} from './canvasUtils';
import {
  CANVAS_WORLD_LIMIT,
  GROUP_CONTENT_INSET_LEFT,
  GROUP_CONTENT_INSET_TOP,
  SLOT_STEP_X,
  SLOT_STEP_Y,
} from './constants';
import type { NodeBounds, SharedOuterSnapTarget, OuterSnapTarget } from './canvasTypes';

interface UseCanvasLayoutOptions {
  nodesRef: RefObject<FilePageNode[]>;
  /** Ref kept in sync with the derived `groupNodes` list from the component. */
  groupNodesRef: RefObject<FilePageNode[]>;
  draftPositionsRef: RefObject<Record<string, Point>>;
  draftSizesRef: RefObject<Record<string, FilePageNode['size']>>;
  getNodeById: (id: string) => FilePageNode | undefined;
}

function getOuterSnapPosition(node: FilePageNode, position: Point): Point {
  return node.kind === 'group'
    ? {
        x: position.x - GROUP_CONTENT_INSET_LEFT,
        y: position.y - GROUP_CONTENT_INSET_TOP,
      }
    : position;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCanvasLayout({
  nodesRef,
  groupNodesRef,
  draftPositionsRef,
  draftSizesRef,
  getNodeById,
}: UseCanvasLayoutOptions) {
  // ── Group bounds ───────────────────────────────────────────────────────────

  const getGroupBounds = useCallback(
    (groupId: string, positions?: Record<string, Point>): NodeBounds | null => {
      const groupNode = getNodeById(groupId);
      if (!groupNode || groupNode.kind !== 'group') return null;

      return getGroupContentBounds(
        positions?.[groupNode.id] ??
          draftPositionsRef.current[groupNode.id] ??
          groupNode.position,
        draftSizesRef.current[groupNode.id] ?? groupNode.size,
      );
    },
    [getNodeById],
  );

  // ── Space sharing ──────────────────────────────────────────────────────────

  /**
   * Returns true when two nodes are allowed to occupy the same grid cells
   * (e.g. a group node and one of its children).
   */
  const canNodesShareSpace = useCallback(
    (
      leftNode: FilePageNode | undefined,
      rightNode: FilePageNode | undefined,
      candidateGroupIds?: Map<string, string | null>,
    ): boolean => {
      if (!leftNode || !rightNode || leftNode.id === rightNode.id) return false;

      const getEffectiveGroupId = (node: FilePageNode) =>
        candidateGroupIds?.has(node.id)
          ? (candidateGroupIds.get(node.id) ?? null)
          : (node.groupId ?? null);

      if (leftNode.kind === 'group' && rightNode.kind !== 'group') {
        return getEffectiveGroupId(rightNode) === leftNode.id;
      }
      if (rightNode.kind === 'group' && leftNode.kind !== 'group') {
        return getEffectiveGroupId(leftNode) === rightNode.id;
      }
      return false;
    },
    [],
  );

  // ── Layout bounds ──────────────────────────────────────────────────────────

  /** Returns the combined AABB of all listed nodes using draft or committed positions. */
  const getLayoutBounds = useCallback(
    (positions: Record<string, Point>, nodeIds: string[]): NodeBounds | null =>
      nodeIds.reduce<NodeBounds | null>((current, nodeId) => {
        const node = getNodeById(nodeId);
        const position = positions[nodeId];
        if (!node || !position) return current;

        const nb = getNodeBoundsWithSize(
          position,
          draftSizesRef.current[nodeId] ?? node.size,
          node.kind,
        );
        if (!current) return nb;

        return {
          left: Math.min(current.left, nb.left),
          top: Math.min(current.top, nb.top),
          right: Math.max(current.right, nb.right),
          bottom: Math.max(current.bottom, nb.bottom),
        };
      }, null),
    [getNodeById],
  );

  // ── Layout constraint helpers ──────────────────────────────────────────────

  /**
   * Shifts a set of nodes as a unit so their combined layout fits within
   * `bounds`. Distributes overshoot evenly when the layout is larger than the
   * bounds on any axis.
   */
  const constrainNodeLayoutToBounds = useCallback(
    (
      positions: Record<string, Point>,
      nodeIds: string[],
      bounds: NodeBounds,
    ): Record<string, Point> => {
      const layoutBounds = getLayoutBounds(positions, nodeIds);
      if (!layoutBounds) return positions;

      const resolveShift = (min: number, max: number) => {
        if (min <= max) return Math.min(Math.max(0, min), max);
        return (min + max) / 2;
      };

      const shiftX = resolveShift(bounds.left - layoutBounds.left, bounds.right - layoutBounds.right);
      const shiftY = resolveShift(bounds.top - layoutBounds.top, bounds.bottom - layoutBounds.bottom);

      if (shiftX === 0 && shiftY === 0) return positions;

      return nodeIds.reduce<Record<string, Point>>(
        (next, nodeId) => {
          const pos = next[nodeId];
          if (pos) next[nodeId] = { x: pos.x + shiftX, y: pos.y + shiftY };
          return next;
        },
        { ...positions },
      );
    },
    [getLayoutBounds],
  );

  /**
   * For each group a dragged node targets, constrains the layout of that
   * group's members to fit within the group's content bounds. If the layout
   * cannot fit, clears the candidateGroupId for those nodes (they land outside).
   */
  const constrainDraggedLayoutsToTargetGroups = useCallback(
    (
      positions: Record<string, Point>,
      nodeIds: string[],
      candidateGroupIds: Map<string, string | null>,
    ): { positions: Record<string, Point>; candidateGroupIds: Map<string, string | null> } => {
      const nodeIdsByGroup = nodeIds.reduce<Map<string, string[]>>((groups, nodeId) => {
        const groupId = candidateGroupIds.get(nodeId);
        if (typeof groupId !== 'string') return groups;

        const existing = groups.get(groupId) ?? [];
        existing.push(nodeId);
        groups.set(groupId, existing);
        return groups;
      }, new Map());

      let nextPositions = { ...positions };
      const nextCandidateGroupIds = new Map(candidateGroupIds);

      nodeIdsByGroup.forEach((groupNodeIds, groupId) => {
        const groupBounds = getGroupBounds(groupId, nextPositions);
        if (!groupBounds) return;

        const layoutBounds = getLayoutBounds(nextPositions, groupNodeIds);
        if (!layoutBounds) return;

        const layoutWidth = layoutBounds.right - layoutBounds.left;
        const layoutHeight = layoutBounds.bottom - layoutBounds.top;
        const boundsWidth = groupBounds.right - groupBounds.left;
        const boundsHeight = groupBounds.bottom - groupBounds.top;

        if (layoutWidth > boundsWidth || layoutHeight > boundsHeight) {
          groupNodeIds.forEach((nodeId) => nextCandidateGroupIds.set(nodeId, null));
          return;
        }

        nextPositions = constrainNodeLayoutToBounds(nextPositions, groupNodeIds, groupBounds);
      });

      return { positions: nextPositions, candidateGroupIds: nextCandidateGroupIds };
    },
    [constrainNodeLayoutToBounds, getGroupBounds, getLayoutBounds],
  );

  /**
   * Pushes nodes that are not inside any group out of overlapping group
   * boundaries, resolving collisions with stationary nodes iteratively.
   */
  const pushDraggedLayoutsOutsideGroups = useCallback(
    (
      positions: Record<string, Point>,
      nodeIds: string[],
      candidateGroupIds: Map<string, string | null>,
    ): Record<string, Point> => {
      const getEffectiveGroupId = (nodeId: string): string | null => {
        const node = getNodeById(nodeId);
        if (!node) return null;
        if (!candidateGroupIds.has(nodeId)) return node.groupId ?? null;
        return candidateGroupIds.get(nodeId) ?? null;
      };

      const outsideNodeIds = nodeIds.filter(
        (nodeId) =>
          getNodeById(nodeId)?.kind !== 'group' && getEffectiveGroupId(nodeId) === null,
      );

      if (outsideNodeIds.length === 0) return positions;

      const stationaryNodes = nodesRef.current.filter((n) => !nodeIds.includes(n.id));

      const applySharedShift = (
        sourcePositions: Record<string, Point>,
        shiftX: number,
        shiftY: number,
      ): Record<string, Point> | null => {
        const layoutBounds = getLayoutBounds(sourcePositions, outsideNodeIds);
        if (!layoutBounds) return null;

        if (
          layoutBounds.left + shiftX < -CANVAS_WORLD_LIMIT ||
          layoutBounds.top + shiftY < -CANVAS_WORLD_LIMIT ||
          layoutBounds.right + shiftX > CANVAS_WORLD_LIMIT ||
          layoutBounds.bottom + shiftY > CANVAS_WORLD_LIMIT
        ) {
          return null;
        }

        return outsideNodeIds.reduce<Record<string, Point>>(
          (acc, nodeId) => {
            const pos = acc[nodeId];
            if (pos) acc[nodeId] = { x: pos.x + shiftX, y: pos.y + shiftY };
            return acc;
          },
          { ...sourcePositions },
        );
      };

      let nextPositions = { ...positions };

      groupNodesRef.current.forEach((groupNode) => {
        const layoutBounds = getLayoutBounds(nextPositions, outsideNodeIds);
        if (!layoutBounds) return;

        const groupBounds = getNodeBoundsWithSize(
          nextPositions[groupNode.id] ?? groupNode.position,
          draftSizesRef.current[groupNode.id] ?? groupNode.size,
          groupNode.kind,
        );

        const noOverlap =
          layoutBounds.right <= groupBounds.left ||
          layoutBounds.left >= groupBounds.right ||
          layoutBounds.bottom <= groupBounds.top ||
          layoutBounds.top >= groupBounds.bottom;

        if (noOverlap) return;

        const candidateShifts = [
          { x: groupBounds.left - layoutBounds.right, y: 0 },
          { x: groupBounds.right - layoutBounds.left, y: 0 },
          { x: 0, y: groupBounds.top - layoutBounds.bottom },
          { x: 0, y: groupBounds.bottom - layoutBounds.top },
        ].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

        let resolvedPositions: Record<string, Point> | null = null;

        for (const chosenShift of candidateShifts) {
          let candidatePositions = applySharedShift(
            nextPositions,
            chosenShift.x,
            chosenShift.y,
          );
          if (!candidatePositions) continue;

          const axis = Math.abs(chosenShift.x) > Math.abs(chosenShift.y) ? 'x' : 'y';
          const dir = axis === 'x'
            ? Math.sign(chosenShift.x || 1)
            : Math.sign(chosenShift.y || 1);
          let candidateValid = true;

          for (let iter = 0; iter < 12; iter += 1) {
            let extraShift = 0;
            const snapshot = candidatePositions;

            outsideNodeIds.forEach((nodeId) => {
              const movingNode = getNodeById(nodeId);
              const movingPos = snapshot[nodeId];
              if (!movingNode || !movingPos) return;

              const movingBounds = getNodeBoundsWithSize(
                movingPos,
                draftSizesRef.current[nodeId] ?? movingNode.size,
                movingNode.kind,
              );

              stationaryNodes.forEach((stationaryNode) => {
                if (canNodesShareSpace(movingNode, stationaryNode, candidateGroupIds)) return;

                const stationaryBounds = getNodeBoundsWithSize(
                  snapshot[stationaryNode.id] ?? stationaryNode.position,
                  draftSizesRef.current[stationaryNode.id] ?? stationaryNode.size,
                  stationaryNode.kind,
                );

                if (!boundsOverlap(movingBounds, stationaryBounds)) return;

                if (axis === 'x') {
                  extraShift = Math.max(
                    extraShift,
                    dir < 0
                      ? movingBounds.right - stationaryBounds.left + 1
                      : stationaryBounds.right - movingBounds.left + 1,
                  );
                } else {
                  extraShift = Math.max(
                    extraShift,
                    dir < 0
                      ? movingBounds.bottom - stationaryBounds.top + 1
                      : stationaryBounds.bottom - movingBounds.top + 1,
                  );
                }
              });
            });

            if (extraShift <= 0) {
              resolvedPositions = candidatePositions;
              break;
            }

            candidatePositions = applySharedShift(
              candidatePositions,
              axis === 'x' ? dir * extraShift : 0,
              axis === 'y' ? dir * extraShift : 0,
            );

            if (!candidatePositions) {
              candidateValid = false;
              break;
            }
          }

          if (resolvedPositions) break;
          if (!candidateValid) continue;
        }

        if (resolvedPositions) nextPositions = resolvedPositions;
      });

      return nextPositions;
    },
    [canNodesShareSpace, getLayoutBounds, getNodeById],
  );

  // ── Group membership helpers ───────────────────────────────────────────────

  /**
   * Walks the parent chain of a node to find which group its ultimate parent
   * belongs to. Returns `undefined` if none of the ancestors are in a group.
   */
  const getLockedConnectedGroupId = useCallback(
    (
      node: FilePageNode,
      candidateGroupIds?: Map<string, string | null>,
      visited = new Set<string>(),
    ): string | null | undefined => {
      if (!node.parentNodeId || visited.has(node.id)) return undefined;

      const parentNode = getNodeById(node.parentNodeId);
      if (!parentNode) return null;

      if (candidateGroupIds?.has(parentNode.id)) {
        return candidateGroupIds.get(parentNode.id) ?? null;
      }

      if (parentNode.groupId) return parentNode.groupId;

      const nextVisited = new Set(visited);
      nextVisited.add(node.id);
      return getLockedConnectedGroupId(parentNode, candidateGroupIds, nextVisited) ?? null;
    },
    [getNodeById],
  );

  /**
   * Expands a selection to include all group children and connected sub-trees
   * so that dragging a group moves everything inside it.
   */
  const expandDragNodeIds = useCallback(
    (selectedIds: string[]): string[] => {
      const seen = new Set(selectedIds);
      const queue = [...selectedIds];

      while (queue.length > 0) {
        const nodeId = queue.shift();
        if (!nodeId) continue;

        nodesRef.current
          .filter((n) => n.groupId === nodeId || n.parentNodeId === nodeId)
          .forEach((n) => {
            if (!seen.has(n.id)) {
              seen.add(n.id);
              queue.push(n.id);
            }
          });
      }

      return [...seen];
    },
    [],
  );

  /**
   * Finds the smallest group whose content area contains or nearly contains
   * `node` at `position`. Returns null for group nodes themselves.
   */
  const findContainingGroupId = useCallback(
    (
      node: FilePageNode,
      position: Point,
      size: FilePageNode['size'],
      positions: Record<string, Point>,
    ): string | null => {
      if (node.kind === 'group') return null;

      const nodeBounds = getNodeBoundsWithSize(position, size, node.kind);
      const nodeCenter = {
        x: (nodeBounds.left + nodeBounds.right) / 2,
        y: (nodeBounds.top + nodeBounds.bottom) / 2,
      };

      const containingGroups = nodesRef.current
        .filter((candidate) => candidate.kind === 'group' && candidate.id !== node.id)
        .filter((candidate) => {
          const groupBounds = getGroupBounds(candidate.id, positions);
          if (!groupBounds) return false;

          const expanded = {
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
            nodeCenter.x >= expanded.left &&
            nodeCenter.x <= expanded.right &&
            nodeCenter.y >= expanded.top &&
            nodeCenter.y <= expanded.bottom;

          return fullyContained || centerInside;
        })
        .sort((a, b) => {
          // prefer the smallest enclosing group
          const aBounds = getNodeBoundsWithSize(
            positions[a.id] ?? a.position,
            draftSizesRef.current[a.id] ?? a.size,
            a.kind,
          );
          const bBounds = getNodeBoundsWithSize(
            positions[b.id] ?? b.position,
            draftSizesRef.current[b.id] ?? b.size,
            b.kind,
          );
          const aArea = (aBounds.right - aBounds.left) * (aBounds.bottom - aBounds.top);
          const bArea = (bBounds.right - bBounds.left) * (bBounds.bottom - bBounds.top);
          return aArea - bArea;
        });

      return containingGroups[0]?.id ?? null;
    },
    [getGroupBounds],
  );

  // ── Snap origin resolution ─────────────────────────────────────────────────

  /** Finds the nearest stationary outer node close enough to trigger snapping. */
  const getNearbyOuterGridOrigin = useCallback(
    (
      anchorNodeId: string,
      desiredPositions: Record<string, Point>,
      dragNodeIds: string[],
    ): OuterSnapTarget | null => {
      const anchorNode = getNodeById(anchorNodeId);
      if (!anchorNode) return null;

      const anchorBounds = getNodeBoundsWithSize(
        desiredPositions[anchorNodeId] ?? anchorNode.position,
        draftSizesRef.current[anchorNodeId] ?? anchorNode.size,
        anchorNode.kind,
      );
      const padX = SLOT_STEP_X * 0.18;
      const padY = SLOT_STEP_Y * 0.18;
      let closestTarget: OuterSnapTarget | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      nodesRef.current.forEach((candidate) => {
        if (candidate.id === anchorNodeId || dragNodeIds.includes(candidate.id) || candidate.groupId) {
          return;
        }

        const origin =
          desiredPositions[candidate.id] ??
          draftPositionsRef.current[candidate.id] ??
          candidate.position;
        const candidateBounds = getNodeBoundsWithSize(
          origin,
          draftSizesRef.current[candidate.id] ?? candidate.size,
          candidate.kind,
        );
        const expanded = {
          left: candidateBounds.left - padX,
          top: candidateBounds.top - padY,
          right: candidateBounds.right + padX,
          bottom: candidateBounds.bottom + padY,
        };
        const distX = Math.max(0, expanded.left - anchorBounds.right, anchorBounds.left - expanded.right);
        const distY = Math.max(0, expanded.top - anchorBounds.bottom, anchorBounds.top - expanded.bottom);
        const distance = Math.hypot(distX, distY);

        if (distance <= OUTER_WIDGET_SNAP_THRESHOLD && distance < closestDistance) {
          closestTarget = {
            nodeId: candidate.id,
            origin: getOuterSnapPosition(candidate, origin),
          };
          closestDistance = distance;
        }
      });

      return closestTarget;
    },
    [getNodeById],
  );

  /** Resolves the shared snap grid origin for a set of dragged nodes in outer space. */
  const getSharedOuterSnapOrigin = useCallback(
    (
      dragNodeIds: string[],
      desiredPositions: Record<string, Point>,
      basePositions: Record<string, Point>,
      candidateGroupIds: Map<string, string | null>,
    ): SharedOuterSnapTarget | null => {
      if (dragNodeIds.length === 0) return null;

      const dragNodeIdSet = new Set(dragNodeIds);
      const canUseOuterSnap = dragNodeIds.every((nodeId) => {
        const node = getNodeById(nodeId);
        const candidateGroupId = candidateGroupIds.get(nodeId) ?? null;
        return Boolean(node && (!candidateGroupId || dragNodeIdSet.has(candidateGroupId)));
      });

      if (!canUseOuterSnap) return null;

      const baseAnchorId = dragNodeIds[0];
      const baseAnchorNode = getNodeById(baseAnchorId);
      const baseAnchorPos = basePositions[baseAnchorId] ?? desiredPositions[baseAnchorId] ?? baseAnchorNode?.position;
      if (!baseAnchorNode || !baseAnchorPos) return null;

      const baseAnchorSnapPos = getOuterSnapPosition(baseAnchorNode, baseAnchorPos);

      for (const triggerNodeId of dragNodeIds) {
        const nearbyTarget = getNearbyOuterGridOrigin(triggerNodeId, desiredPositions, dragNodeIds);
        if (!nearbyTarget) continue;

        const triggerNode = getNodeById(triggerNodeId);
        const triggerBasePos = basePositions[triggerNodeId] ?? desiredPositions[triggerNodeId] ?? triggerNode?.position;
        if (!triggerNode || !triggerBasePos) continue;

        const triggerBaseSnapPos = getOuterSnapPosition(triggerNode, triggerBasePos);
        const offsetX = triggerBaseSnapPos.x - baseAnchorSnapPos.x;
        const offsetY = triggerBaseSnapPos.y - baseAnchorSnapPos.y;
        const resolvedOrigin = nearbyTarget.origin;
        const targetNode = getNodeById(nearbyTarget.nodeId);
        const targetPos =
          desiredPositions[nearbyTarget.nodeId] ??
          draftPositionsRef.current[nearbyTarget.nodeId] ??
          targetNode?.position;

        if (!targetNode || !targetPos) {
          return {
            gridOrigin: {
              x: resolvedOrigin.x - offsetX,
              y: resolvedOrigin.y - offsetY,
            },
          };
        }

        const targetSize = draftSizesRef.current[nearbyTarget.nodeId] ?? targetNode.size;
        const triggerSize = draftSizesRef.current[triggerNodeId] ?? triggerNode.size;
        const targetSnapPos = getOuterSnapPosition(targetNode, targetPos);
        const needsEdgeCandidates = triggerNode.kind === 'group' || targetNode.kind === 'group';
        const outsideTopY = targetSnapPos.y - triggerSize.heightUnits * SLOT_STEP_Y - offsetY;
        const outsideBottomY = targetSnapPos.y + targetSize.heightUnits * SLOT_STEP_Y - offsetY;
        const outsideLeftX = targetSnapPos.x - triggerSize.widthUnits * SLOT_STEP_X - offsetX;
        const outsideRightX = targetSnapPos.x + targetSize.widthUnits * SLOT_STEP_X - offsetX;

        const buildSlots = (startOff: number, endOff: number, step: number) =>
          Array.from({ length: endOff - startOff + 1 }, (_, i) => (startOff + i) * step);

        const hSlots = buildSlots(-(triggerSize.widthUnits - 1), targetSize.widthUnits - 1, SLOT_STEP_X)
          .map((off) => targetSnapPos.x + off - offsetX);
        const vSlots = buildSlots(-(triggerSize.heightUnits - 1), targetSize.heightUnits - 1, SLOT_STEP_Y)
          .map((off) => targetSnapPos.y + off - offsetY);

        return {
          gridOrigin: { x: resolvedOrigin.x - offsetX, y: resolvedOrigin.y - offsetY },
          preferredAnchorCandidates: needsEdgeCandidates
            ? [
                ...hSlots.map((x) => ({ x, y: outsideTopY })),
                ...hSlots.map((x) => ({ x, y: outsideBottomY })),
                ...vSlots.map((y) => ({ x: outsideLeftX, y })),
                ...vSlots.map((y) => ({ x: outsideRightX, y })),
                { x: outsideLeftX, y: outsideTopY },
                { x: outsideRightX, y: outsideTopY },
                { x: outsideLeftX, y: outsideBottomY },
                { x: outsideRightX, y: outsideBottomY },
              ]
            : undefined,
        };
      }

      return null;
    },
    [getNearbyOuterGridOrigin, getNodeById],
  );

  /** Finds the nearest stationary node inside `groupId` close enough to trigger snapping. */
  const getNearbyGroupGridOrigin = useCallback(
    (
      anchorNodeId: string,
      desiredPositions: Record<string, Point>,
      dragNodeIds: string[],
      groupId: string,
    ): Point | null => {
      const anchorNode = getNodeById(anchorNodeId);
      if (!anchorNode || anchorNode.kind === 'group') return null;

      const anchorBounds = getNodeBoundsWithSize(
        desiredPositions[anchorNodeId] ?? anchorNode.position,
        draftSizesRef.current[anchorNodeId] ?? anchorNode.size,
        anchorNode.kind,
      );
      const padX = SLOT_STEP_X * 0.18;
      const padY = SLOT_STEP_Y * 0.18;
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
        const candidateBounds = getNodeBoundsWithSize(
          origin,
          draftSizesRef.current[candidate.id] ?? candidate.size,
          candidate.kind,
        );
        const expanded = {
          left: candidateBounds.left - padX,
          top: candidateBounds.top - padY,
          right: candidateBounds.right + padX,
          bottom: candidateBounds.bottom + padY,
        };
        const distX = Math.max(0, expanded.left - anchorBounds.right, anchorBounds.left - expanded.right);
        const distY = Math.max(0, expanded.top - anchorBounds.bottom, anchorBounds.top - expanded.bottom);
        const distance = Math.hypot(distX, distY);

        if (distance <= OUTER_WIDGET_SNAP_THRESHOLD && distance < closestDistance) {
          closestOrigin = origin;
          closestDistance = distance;
        }
      });

      return closestOrigin;
    },
    [getNodeById],
  );

  /** Resolves the shared snap grid origin for nodes dragging inside a group. */
  const getSharedGroupSnapOrigin = useCallback(
    (
      dragNodeIds: string[],
      desiredPositions: Record<string, Point>,
      basePositions: Record<string, Point>,
      candidateGroupIds: Map<string, string | null>,
      groupId: string,
    ): Point | null => {
      if (dragNodeIds.length === 0) return null;

      const canUseGroupSnap = dragNodeIds.every(
        (nodeId) =>
          getNodeById(nodeId)?.kind !== 'group' && candidateGroupIds.get(nodeId) === groupId,
      );
      if (!canUseGroupSnap) return null;

      const baseAnchorId = dragNodeIds[0];
      const baseAnchorPos =
        basePositions[baseAnchorId] ??
        desiredPositions[baseAnchorId] ??
        getNodeById(baseAnchorId)?.position;
      if (!baseAnchorPos) return null;

      for (const triggerNodeId of dragNodeIds) {
        const nearbyOrigin = getNearbyGroupGridOrigin(
          triggerNodeId,
          desiredPositions,
          dragNodeIds,
          groupId,
        );
        if (!nearbyOrigin) continue;

        const triggerBasePos =
          basePositions[triggerNodeId] ??
          desiredPositions[triggerNodeId] ??
          getNodeById(triggerNodeId)?.position;
        if (!triggerBasePos) continue;

        return {
          x: nearbyOrigin.x - (triggerBasePos.x - baseAnchorPos.x),
          y: nearbyOrigin.y - (triggerBasePos.y - baseAnchorPos.y),
        };
      }

      return null;
    },
    [getNearbyGroupGridOrigin, getNodeById],
  );

  // ── Worker connection proximity ────────────────────────────────────────────

  /**
   * Given a dragged file/folder node, returns the id of the nearest worker
   * node within connection range on the node's left side, or null.
   */
  const getWorkerInputConnectionTarget = useCallback(
    (
      nodeId: string,
      positions: Record<string, Point>,
      dragNodeIds: string[],
    ): string | null => {
      const node = getNodeById(nodeId);
      if (
        !node ||
        (node.kind !== 'file' && node.kind !== 'folder') ||
        node.generatedByWorkerId
      ) {
        return null;
      }

      const nodeBounds = getNodeBoundsWithSize(
        positions[nodeId] ?? node.position,
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

        const candidateBounds = getNodeBoundsWithSize(
          positions[candidate.id] ?? candidate.position,
          draftSizesRef.current[candidate.id] ?? candidate.size,
          candidate.kind,
        );
        const candidateCenterX = (candidateBounds.left + candidateBounds.right) / 2;

        if (nodeCenter.x > candidateCenterX + SLOT_STEP_X * 0.2) return;

        const inputZone = {
          left: candidateBounds.left - WORKER_CONNECTION_THRESHOLD_X,
          right: candidateBounds.left + SLOT_STEP_X * 0.35,
          top: candidateBounds.top - WORKER_CONNECTION_THRESHOLD_Y,
          bottom: candidateBounds.bottom + WORKER_CONNECTION_THRESHOLD_Y,
        };
        const distX = Math.max(0, inputZone.left - nodeBounds.right, nodeBounds.left - inputZone.right);
        const distY = Math.max(0, inputZone.top - nodeBounds.bottom, nodeBounds.top - inputZone.bottom);
        const distance = Math.hypot(distX, distY);

        if (distance < closestDistance) {
          closestWorkerId = candidate.id;
          closestDistance = distance;
        }
      });

      return closestDistance <= SLOT_STEP_X ? closestWorkerId : null;
    },
    [getNodeById],
  );

  /**
   * For each dragged file/folder node, determines whether it should be
   * connected to (or disconnected from) a worker node based on final positions.
   */
  const getDraggedWorkerConnectionAssignments = useCallback(
    (
      nodeIds: string[],
      positions: Record<string, Point>,
    ): Map<string, string | null> => {
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

        // If dragging the parent worker alongside, keep relationship unchanged
        if (currentParent?.kind === 'worker' && nodeIds.includes(currentParent.id)) return;

        if (nextWorkerId || currentParent?.kind === 'worker') {
          assignments.set(nodeId, nextWorkerId);
        }
      });

      return assignments;
    },
    [getNodeById, getWorkerInputConnectionTarget],
  );

  return {
    getGroupBounds,
    canNodesShareSpace,
    getLayoutBounds,
    constrainNodeLayoutToBounds,
    constrainDraggedLayoutsToTargetGroups,
    pushDraggedLayoutsOutsideGroups,
    getLockedConnectedGroupId,
    expandDragNodeIds,
    findContainingGroupId,
    getSharedOuterSnapOrigin,
    getSharedGroupSnapOrigin,
    getWorkerInputConnectionTarget,
    getDraggedWorkerConnectionAssignments,
  };
}
