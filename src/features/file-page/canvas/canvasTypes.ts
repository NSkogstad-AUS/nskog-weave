import type {
  FilePageElementIcon,
  FilePageNode,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';
import type { CanvasFloatingInspectorRect, CanvasFloatingInspectorTarget } from './FileCanvasFloatingInspector';
import type { GroupResizeAxis } from './groupChrome';

// ─── Interaction state ────────────────────────────────────────────────────────

export type DragState = {
  nodeIds: string[];
  selectedNodeIds: string[];
  origin: Point;
  basePositions: Record<string, Point>;
};

export type MarqueeState = {
  origin: Point;
  current: Point;
  additive: boolean;
  initialSelection: string[];
};

export type PanState = {
  origin: Point;
  baseViewport: Point;
};

export type ResizeState = {
  nodeId: string;
  axis: GroupResizeAxis;
  origin: Point;
  basePosition: Point;
  baseSize: FilePageNode['size'];
  minimumSize: FilePageNode['size'];
};

export type WorkerConnectionDragState = {
  workerId: string;
  current: Point;
  targetNodeId: string | null;
};

// ─── Snap targets ─────────────────────────────────────────────────────────────

export type OuterSnapTarget = {
  nodeId: string;
  origin: Point;
};

export type SharedOuterSnapTarget = {
  gridOrigin: Point;
  preferredAnchorCandidates?: Point[];
};

// ─── Connectors ───────────────────────────────────────────────────────────────

export type ConnectorPath = {
  id: string;
  parentNodeId: string;
  childNodeId: string;
  path: string;
  layer: 'below-group' | 'above-group';
  deletable: boolean;
};

// ─── Floating inspectors ──────────────────────────────────────────────────────

export type FloatingInspectorWindowState = {
  rect: CanvasFloatingInspectorRect;
  minimized: boolean;
  maximized: boolean;
  restoreRect: CanvasFloatingInspectorRect | null;
};

export type FloatingInspectorTabState = {
  id: string;
  target: CanvasFloatingInspectorTarget;
  fileId: string | null;
};

export type FloatingInspectorState = {
  id: string;
  tabs: FloatingInspectorTabState[];
  activeTabId: string;
  window: FloatingInspectorWindowState;
  phase: 'opening' | 'open' | 'closing';
};

export type FloatingInspectorDragState = {
  inspectorId: string;
  origin: Point;
  baseRect: CanvasFloatingInspectorRect;
};

export type FloatingInspectorResizeState = {
  inspectorId: string;
  origin: Point;
  baseRect: CanvasFloatingInspectorRect;
};

// ─── Shared geometry ──────────────────────────────────────────────────────────

/** Axis-aligned bounding box used across canvas utilities. */
export type NodeBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type { FilePageElementIcon };
