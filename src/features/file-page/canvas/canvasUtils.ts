/**
 * Pure utility functions and constants for the canvas view.
 * No React dependencies — safe to import anywhere.
 */

import type { FilePageContentItem, FilePageNode } from '@/types/filePage';
import type { Point } from '@/types/geometry';
import type { CanvasFloatingInspectorRect } from './FileCanvasFloatingInspector';
import type { CanvasPaletteTemplateId } from './CanvasPaletteSidebar';
import type { FloatingInspectorState, NodeBounds } from './canvasTypes';
import { SLOT_STEP_X, SLOT_STEP_Y } from './constants';

// ─── Canvas / snap constants ─────────────────────────────────────────────────

export const OUTER_WIDGET_SNAP_THRESHOLD = 4;
export const GROUP_SNAP_TOLERANCE = Math.round(Math.min(SLOT_STEP_X, SLOT_STEP_Y) * 0.25);
export const WORKER_CONNECTION_THRESHOLD_X = SLOT_STEP_X * 1.25;
export const WORKER_CONNECTION_THRESHOLD_Y = SLOT_STEP_Y * 1.25;

// ─── Floating inspector constants ────────────────────────────────────────────

export const FLOATING_INSPECTOR_MIN_WIDTH = 360;
export const FLOATING_INSPECTOR_MIN_HEIGHT = 240;
export const FLOATING_INSPECTOR_MIN_FILE_HEIGHT = 168;
export const FLOATING_INSPECTOR_HEADER_HEIGHT = 60;
export const FLOATING_INSPECTOR_TRANSITION_MS = 280;
export const FLOATING_INSPECTOR_STACK_OFFSET = 28;

// ─── Palette drag constants ───────────────────────────────────────────────────

export const CANVAS_PALETTE_DATA_TRANSFER_TYPE = 'application/x-weave-canvas-palette-template';
export const CANVAS_PALETTE_TEXT_PREFIX = 'weave-canvas-palette-template:';

// ─── Floating inspector helpers ───────────────────────────────────────────────

export function buildFloatingInspectorId(): string {
  return `inspector-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function moveFloatingInspectorToFront(
  inspectors: FloatingInspectorState[],
  inspectorId: string,
): FloatingInspectorState[] {
  const inspector = inspectors.find((entry) => entry.id === inspectorId);
  if (!inspector) return inspectors;
  return [...inspectors.filter((entry) => entry.id !== inspectorId), inspector];
}

export function pointIsWithinRect(point: Point, rect: CanvasFloatingInspectorRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// ─── Palette drag helpers ─────────────────────────────────────────────────────

export function isCanvasPaletteTemplateId(value: string): value is CanvasPaletteTemplateId {
  return (
    value === 'sort-worker' ||
    value === 'group' ||
    value === 'element'
  );
}

export function hasCanvasPaletteTemplate(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(CANVAS_PALETTE_DATA_TRANSFER_TYPE);
}

export function setTransparentDragImage(dataTransfer: DataTransfer): void {
  const dragImage = document.createElement('div');
  dragImage.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(dragImage);
  dataTransfer.setDragImage(dragImage, 0, 0);
  window.requestAnimationFrame(() => dragImage.remove());
}

export function readCanvasPaletteTemplate(
  dataTransfer: DataTransfer,
): CanvasPaletteTemplateId | null {
  const direct = dataTransfer.getData(CANVAS_PALETTE_DATA_TRANSFER_TYPE);
  if (isCanvasPaletteTemplateId(direct)) return direct;

  const fallback = dataTransfer.getData('text/plain');
  if (!fallback.startsWith(CANVAS_PALETTE_TEXT_PREFIX)) return null;

  const candidate = fallback.slice(CANVAS_PALETTE_TEXT_PREFIX.length);
  return isCanvasPaletteTemplateId(candidate) ? candidate : null;
}

// ─── Content item helpers ─────────────────────────────────────────────────────

export function sortCanvasContentItems(items: FilePageContentItem[]): FilePageContentItem[] {
  return [...items].sort((left, right) =>
    left.kind === right.kind
      ? left.label.localeCompare(right.label)
      : left.kind === 'folder'
        ? -1
        : 1,
  );
}

export function getContentItemDedupKey(item: FilePageContentItem): string {
  return item.id || `${item.kind}:${item.label.trim().toLowerCase()}`;
}

export function createFallbackFileItem(node: FilePageNode): FilePageContentItem {
  return {
    id: node.id,
    kind: 'file',
    label: node.label,
    description: node.description,
    textContent: null,
    mimeType: null,
    sizeBytes: null,
  };
}

export function createContentHash(value: string | null | undefined): string {
  const input = value ?? '';
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

export function getPointBounds(point: Point): NodeBounds {
  return { left: point.x, top: point.y, right: point.x, bottom: point.y };
}

export function arePointsEqual(left?: Point, right?: Point): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

export function pointIsWithinBounds(point: Point, bounds: NodeBounds): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

/**
 * Generates an SVG cubic-bezier path string connecting two bounding boxes.
 * Routes horizontally when ΔX ≥ ΔY, otherwise vertically.
 */
export function getConnectorPath(parentBounds: NodeBounds, childBounds: NodeBounds): string {
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
    const dir = deltaX >= 0 ? 1 : -1;
    const start = { x: dir > 0 ? parentBounds.right : parentBounds.left, y: parentCenter.y };
    const end = { x: dir > 0 ? childBounds.left : childBounds.right, y: childCenter.y };
    const ctrl = Math.max(32, Math.abs(end.x - start.x) * 0.45);
    return `M ${start.x} ${start.y} C ${start.x + ctrl * dir} ${start.y}, ${end.x - ctrl * dir} ${end.y}, ${end.x} ${end.y}`;
  }

  const dir = deltaY >= 0 ? 1 : -1;
  const start = { x: parentCenter.x, y: dir > 0 ? parentBounds.bottom : parentBounds.top };
  const end = { x: childCenter.x, y: dir > 0 ? childBounds.top : childBounds.bottom };
  const ctrl = Math.max(28, Math.abs(end.y - start.y) * 0.45);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + ctrl * dir}, ${end.x} ${end.y - ctrl * dir}, ${end.x} ${end.y}`;
}
