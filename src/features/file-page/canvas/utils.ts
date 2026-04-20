import {
  CANVAS_PADDING,
  CANVAS_WORLD_LIMIT,
  COLLISION_GAP,
  GROUP_CONTENT_INSET_BOTTOM,
  GROUP_CONTENT_INSET_LEFT,
  GROUP_CONTENT_INSET_RIGHT,
  GROUP_CONTENT_INSET_TOP,
  MAX_NODE_GRID_UNITS,
  NODE_UNIT,
  SLOT_STEP_X,
  SLOT_STEP_Y,
} from './constants';
import type { FilePageNode, FilePageNodeSize } from '@/types/filePage';
import type { Point } from '@/types/geometry';

export function clampToCanvas(value: number) {
  return Math.max(-CANVAS_WORLD_LIMIT, Math.min(CANVAS_WORLD_LIMIT, value));
}

export function clampGridUnits(value: number, minimum = 1, maximum = MAX_NODE_GRID_UNITS) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export function snapToSlotX(value: number) {
  return (
    CANVAS_PADDING +
    Math.round((clampToCanvas(value) - CANVAS_PADDING) / SLOT_STEP_X) * SLOT_STEP_X
  );
}

export function snapToSlotY(value: number) {
  return (
    CANVAS_PADDING +
    Math.round((clampToCanvas(value) - CANVAS_PADDING) / SLOT_STEP_Y) * SLOT_STEP_Y
  );
}

export function normalizeRectangle(start: Point, end: Point) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function rectanglesIntersect(
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

export function getNodeDimensions(size: FilePageNodeSize) {
  return getNodeDimensionsForKind(size);
}

export function getNodeDimensionsForKind(
  size: FilePageNodeSize,
  kind: FilePageNode['kind'] = 'element',
) {
  const normalizedSize =
    kind === 'worker'
      ? {
          widthUnits: 3,
          heightUnits: 3,
        }
      : size;

  return {
    width: NODE_UNIT + (normalizedSize.widthUnits - 1) * SLOT_STEP_X,
    height: NODE_UNIT + (normalizedSize.heightUnits - 1) * SLOT_STEP_Y,
  };
}

export function getNodeBoundsWithSize(
  position: Point,
  size: FilePageNodeSize,
  kind: FilePageNode['kind'] = 'element',
) {
  const dimensions = getNodeDimensionsForKind(size, kind);
  const left = kind === 'group' ? position.x - GROUP_CONTENT_INSET_LEFT : position.x;
  const top = kind === 'group' ? position.y - GROUP_CONTENT_INSET_TOP : position.y;

  return {
    left,
    top,
    right: left + dimensions.width,
    bottom: top + dimensions.height,
  };
}

export function getGroupContentBounds(position: Point, size: FilePageNodeSize) {
  const outerDimensions = getNodeDimensionsForKind(size, 'group');
  const innerDimensions = {
    width: Math.max(
      0,
      outerDimensions.width - GROUP_CONTENT_INSET_LEFT - GROUP_CONTENT_INSET_RIGHT,
    ),
    height: Math.max(
      0,
      outerDimensions.height - GROUP_CONTENT_INSET_TOP - GROUP_CONTENT_INSET_BOTTOM,
    ),
  };

  return {
    left: position.x,
    top: position.y,
    right: position.x + innerDimensions.width,
    bottom: position.y + innerDimensions.height,
  };
}

export function boundsOverlap(
  left: ReturnType<typeof getNodeBoundsWithSize>,
  right: ReturnType<typeof getNodeBoundsWithSize>,
) {
  return !(
    left.right + COLLISION_GAP <= right.left ||
    left.left >= right.right + COLLISION_GAP ||
    left.bottom + COLLISION_GAP <= right.top ||
    left.top >= right.bottom + COLLISION_GAP
  );
}

export function clampNodePositionToBounds(
  position: Point,
  size: FilePageNodeSize,
  bounds: ReturnType<typeof getGroupContentBounds>,
) {
  const dimensions = getNodeDimensions(size);
  const maxX = Math.max(bounds.left, bounds.right - dimensions.width);
  const maxY = Math.max(bounds.top, bounds.bottom - dimensions.height);

  return {
    x: Math.min(Math.max(position.x, bounds.left), maxX),
    y: Math.min(Math.max(position.y, bounds.top), maxY),
  };
}

export function snapPointToBoundsGrid(
  position: Point,
  size: FilePageNodeSize,
  bounds: ReturnType<typeof getGroupContentBounds>,
) {
  const snapped = {
    x: bounds.left + Math.round((position.x - bounds.left) / SLOT_STEP_X) * SLOT_STEP_X,
    y: bounds.top + Math.round((position.y - bounds.top) / SLOT_STEP_Y) * SLOT_STEP_Y,
  };

  return clampNodePositionToBounds(snapped, size, bounds);
}

export function getUnitsForDimension(
  dimension: number,
  step: number,
  minimum = 1,
  maximum = MAX_NODE_GRID_UNITS,
) {
  return clampGridUnits(1 + (dimension - NODE_UNIT) / step, minimum, maximum);
}

function buildCandidateAnchors(origin: Point, gridOrigin: Point = { x: CANVAS_PADDING, y: CANVAS_PADDING }) {
  const baseColumn = Math.round((origin.x - gridOrigin.x) / SLOT_STEP_X);
  const baseRow = Math.round((origin.y - gridOrigin.y) / SLOT_STEP_Y);
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
        x: gridOrigin.x + column * SLOT_STEP_X,
        y: gridOrigin.y + row * SLOT_STEP_Y,
      });
    });
  }

  return candidates;
}

interface ResolveSnapOptions {
  anchorGridOrigin?: Point;
  preferredAnchorCandidates?: Point[];
  constrainPosition?: (position: Point, nodeId: string) => Point | null;
  getNodeKind?: (nodeId: string) => FilePageNode['kind'] | undefined;
  toSnapPosition?: (position: Point, nodeId: string) => Point;
  fromSnapPosition?: (position: Point, nodeId: string) => Point;
}

export function resolveSnapPositions(
  desiredPositions: Record<string, Point>,
  dragNodeIds: string[],
  stationaryNodes: FilePageNode[],
  basePositions: Record<string, Point>,
  nodeSizes: Record<string, FilePageNodeSize>,
  canOverlap?: (leftNodeId: string, rightNodeId: string) => boolean,
  options?: ResolveSnapOptions,
) {
  const anchorId = dragNodeIds[0];
  const anchorBasePositionRaw = basePositions[anchorId];
  const anchorDesiredPositionRaw = desiredPositions[anchorId];
  const anchorBasePosition =
    anchorBasePositionRaw &&
    (options?.toSnapPosition?.(anchorBasePositionRaw, anchorId) ?? anchorBasePositionRaw);
  const anchorDesiredPosition =
    anchorDesiredPositionRaw &&
    (options?.toSnapPosition?.(anchorDesiredPositionRaw, anchorId) ?? anchorDesiredPositionRaw);

  if (!anchorBasePosition || !anchorDesiredPosition) {
    return desiredPositions;
  }

  const relativeOffsets = dragNodeIds.reduce<Record<string, Point>>((offsets, nodeId) => {
    const basePositionRaw = basePositions[nodeId];
    const basePosition =
      basePositionRaw &&
      (options?.toSnapPosition?.(basePositionRaw, nodeId) ?? basePositionRaw);

    if (basePosition) {
      offsets[nodeId] = {
        x: basePosition.x - anchorBasePosition.x,
        y: basePosition.y - anchorBasePosition.y,
      };
    }

    return offsets;
  }, {});
  const stationaryBounds = stationaryNodes.map((node) => ({
    nodeId: node.id,
    bounds: getNodeBoundsWithSize(node.position, node.size, node.kind),
  }));

  const preferredAnchorCandidates = [...(options?.preferredAnchorCandidates ?? [])].sort(
    (left, right) =>
      Math.hypot(left.x - anchorDesiredPosition.x, left.y - anchorDesiredPosition.y) -
      Math.hypot(right.x - anchorDesiredPosition.x, right.y - anchorDesiredPosition.y),
  );
  const anchorCandidates = [
    ...preferredAnchorCandidates,
    ...buildCandidateAnchors(
      anchorDesiredPosition,
      options?.anchorGridOrigin,
    ),
  ];

  for (const anchorCandidate of anchorCandidates) {
    let hasInvalidCandidate = false;
    const candidatePositions = dragNodeIds.reduce<Record<string, Point>>((positions, nodeId) => {
      const offset = relativeOffsets[nodeId] ?? { x: 0, y: 0 };
      const unclampedSnapPosition = {
        x: anchorCandidate.x + offset.x,
        y: anchorCandidate.y + offset.y,
      };
      const unclampedPosition =
        options?.fromSnapPosition?.(unclampedSnapPosition, nodeId) ?? unclampedSnapPosition;
      const constrainedPosition = options?.constrainPosition?.(unclampedPosition, nodeId);

      if (constrainedPosition === null) {
        hasInvalidCandidate = true;
        return positions;
      }

      positions[nodeId] = constrainedPosition ?? {
        x: clampToCanvas(unclampedPosition.x),
        y: clampToCanvas(unclampedPosition.y),
      };

      return positions;
    }, {});

    if (hasInvalidCandidate) {
      continue;
    }

    const candidateBounds = dragNodeIds.map((nodeId) => ({
      nodeId,
      bounds: getNodeBoundsWithSize(
        candidatePositions[nodeId],
        nodeSizes[nodeId] ?? { widthUnits: 1, heightUnits: 1 },
        options?.getNodeKind?.(nodeId),
      ),
    }));
    const collidesWithStationary = candidateBounds.some(({ nodeId, bounds }) =>
      stationaryBounds.some(
        ({ nodeId: stationaryNodeId, bounds: stationaryBoundsItem }) =>
          !(canOverlap?.(nodeId, stationaryNodeId) ?? false) &&
          boundsOverlap(bounds, stationaryBoundsItem),
      ),
    );

    if (collidesWithStationary) {
      continue;
    }

    const collidesWithinGroup = candidateBounds.some(({ nodeId, bounds }, index) =>
      candidateBounds.some(
        ({ nodeId: otherNodeId, bounds: otherBounds }, otherIndex) =>
          index !== otherIndex &&
          !(canOverlap?.(nodeId, otherNodeId) ?? false) &&
          boundsOverlap(bounds, otherBounds),
      ),
    );

    if (!collidesWithinGroup) {
      return candidatePositions;
    }
  }

  return dragNodeIds.reduce<Record<string, Point>>((positions, nodeId) => {
    positions[nodeId] = basePositions[nodeId] ?? desiredPositions[nodeId];
    return positions;
  }, {});
}
