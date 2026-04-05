import {
  CANVAS_PADDING,
  COLLISION_GAP,
  MAX_NODE_GRID_UNITS,
  NODE_UNIT,
  SLOT_STEP_X,
  SLOT_STEP_Y,
} from './constants';
import type { FilePageNode, FilePageNodeSize } from '@/types/filePage';
import type { Point } from '@/types/geometry';

export function clampToCanvas(value: number) {
  return Math.max(CANVAS_PADDING, value);
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
  return {
    width: NODE_UNIT + (size.widthUnits - 1) * SLOT_STEP_X,
    height: NODE_UNIT + (size.heightUnits - 1) * SLOT_STEP_Y,
  };
}

export function getNodeBoundsWithSize(position: Point, size: FilePageNodeSize) {
  const dimensions = getNodeDimensions(size);

  return {
    left: position.x,
    top: position.y,
    right: position.x + dimensions.width,
    bottom: position.y + dimensions.height,
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

export function getUnitsForDimension(
  dimension: number,
  step: number,
  minimum = 1,
  maximum = MAX_NODE_GRID_UNITS,
) {
  return clampGridUnits(1 + (dimension - NODE_UNIT) / step, minimum, maximum);
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

export function resolveSnapPositions(
  desiredPositions: Record<string, Point>,
  dragNodeIds: string[],
  stationaryNodes: FilePageNode[],
  basePositions: Record<string, Point>,
  nodeSizes: Record<string, FilePageNodeSize>,
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
