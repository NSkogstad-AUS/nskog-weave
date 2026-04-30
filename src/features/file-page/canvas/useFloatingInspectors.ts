/**
 * useFloatingInspectors — manages floating file/folder inspector windows.
 *
 * Handles:
 *  - Inspector open/close/tab lifecycle with enter/leave animations
 *  - Drag-to-move and resize via pointer events
 *  - Tab merging when an inspector is dropped onto another
 *  - Target resolution from canvas nodes and content items
 *  - Inline text editing (propagated to workspace file content)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

import type { FilePageContentItem, FilePageNode } from '@/types/filePage';
import type { Point } from '@/types/geometry';
import type {
  CanvasFloatingInspectorRect,
  CanvasFloatingInspectorTarget,
} from './FileCanvasFloatingInspector';
import {
  buildFloatingInspectorId,
  createFallbackFileItem,
  FLOATING_INSPECTOR_HEADER_HEIGHT,
  FLOATING_INSPECTOR_MIN_FILE_HEIGHT,
  FLOATING_INSPECTOR_MIN_HEIGHT,
  FLOATING_INSPECTOR_MIN_WIDTH,
  FLOATING_INSPECTOR_STACK_OFFSET,
  FLOATING_INSPECTOR_TRANSITION_MS,
  moveFloatingInspectorToFront,
  pointIsWithinRect,
} from './canvasUtils';
import type {
  FloatingInspectorDragState,
  FloatingInspectorResizeState,
  FloatingInspectorState,
  FloatingInspectorTabState,
} from './canvasTypes';

// ─── Hook options ─────────────────────────────────────────────────────────────

interface UseFloatingInspectorsOptions {
  canvasRef: RefObject<HTMLDivElement | null>;
  suppressPreviewOpenUntilRef: RefObject<number>;
  getNodeById: (id: string) => FilePageNode | undefined;
  /** Resolves the folder/worker contents list displayed for a node. */
  resolveNodeFolderContents: (node: FilePageNode) => FilePageContentItem[];
  resolveCanvasFileItem?: (node: FilePageNode) => FilePageContentItem | null;
  resolveCanvasFileId?: (node: FilePageNode) => string | null;
  onUpdateWorkspaceFileContent?: (fileId: string, contentText: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFloatingInspectors({
  canvasRef,
  suppressPreviewOpenUntilRef,
  getNodeById,
  resolveNodeFolderContents,
  resolveCanvasFileItem,
  resolveCanvasFileId,
  onUpdateWorkspaceFileContent,
}: UseFloatingInspectorsOptions) {
  const [floatingInspectors, setFloatingInspectors] = useState<FloatingInspectorState[]>([]);
  const floatingInspectorsRef = useRef<FloatingInspectorState[]>([]);
  const floatingInspectorDragStateRef = useRef<FloatingInspectorDragState | null>(null);
  const floatingInspectorResizeStateRef = useRef<FloatingInspectorResizeState | null>(null);
  const floatingInspectorCloseTimerRef = useRef<number | null>(null);
  const floatingInspectorFrameRef = useRef<number | null>(null);
  const floatingInspectorPointerRef = useRef<Point | null>(null);

  // Keep ref in sync for stable access inside pointer handlers
  useEffect(() => {
    floatingInspectorsRef.current = floatingInspectors;
  }, [floatingInspectors]);

  // ── Animation phases ───────────────────────────────────────────────────────

  // Advance inspectors from 'opening' → 'open' on the next animation frame
  useEffect(() => {
    if (!floatingInspectors.some((inspector) => inspector.phase === 'opening')) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      setFloatingInspectors((current) =>
        current.map((inspector) =>
          inspector.phase === 'opening' ? { ...inspector, phase: 'open' } : inspector,
        ),
      );
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [floatingInspectors]);

  // Remove 'closing' inspectors after the CSS transition completes
  useEffect(() => {
    if (!floatingInspectors.some((inspector) => inspector.phase === 'closing')) {
      if (floatingInspectorCloseTimerRef.current !== null) {
        window.clearTimeout(floatingInspectorCloseTimerRef.current);
        floatingInspectorCloseTimerRef.current = null;
      }
      return undefined;
    }

    floatingInspectorCloseTimerRef.current = window.setTimeout(() => {
      setFloatingInspectors((current) =>
        current.filter((inspector) => inspector.phase !== 'closing'),
      );
      floatingInspectorCloseTimerRef.current = null;
    }, FLOATING_INSPECTOR_TRANSITION_MS);

    return () => {
      if (floatingInspectorCloseTimerRef.current !== null) {
        window.clearTimeout(floatingInspectorCloseTimerRef.current);
        floatingInspectorCloseTimerRef.current = null;
      }
    };
  }, [floatingInspectors]);

  // ── Geometry helpers ───────────────────────────────────────────────────────

  const clampFloatingInspectorRect = useCallback(
    (
      rect: CanvasFloatingInspectorRect,
      targetType: CanvasFloatingInspectorTarget['type'] = 'folder',
      minimized = false,
    ): CanvasFloatingInspectorRect => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return rect;

      const width = Math.max(FLOATING_INSPECTOR_MIN_WIDTH, Math.min(rect.width, canvasRect.width - 24));
      const minimumHeight =
        targetType === 'file' ? FLOATING_INSPECTOR_MIN_FILE_HEIGHT : FLOATING_INSPECTOR_MIN_HEIGHT;
      const height = minimized
        ? FLOATING_INSPECTOR_HEADER_HEIGHT
        : Math.max(minimumHeight, Math.min(rect.height, canvasRect.height - 24));
      const maxX = Math.max(12, canvasRect.width - width - 12);
      const maxY = Math.max(12, canvasRect.height - height - 12);

      return {
        x: Math.min(Math.max(rect.x, 12), maxX),
        y: Math.min(Math.max(rect.y, 12), maxY),
        width,
        height,
      };
    },
    [],
  );

  function estimateFloatingInspectorHeight(target: CanvasFloatingInspectorTarget): number {
    const descriptionHeight = target.description.trim().length > 0 ? 54 : 0;

    if (target.type === 'folder') {
      const itemCount = target.items.length;
      const folderBodyHeight =
        itemCount === 0 ? 132 : 28 + Math.min(6, Math.max(2, itemCount)) * 72;
      return FLOATING_INSPECTOR_HEADER_HEIGHT + descriptionHeight + folderBodyHeight;
    }

    const wrappedLineEstimate = target.textContent
      .split(/\r?\n/g)
      .slice(0, 12)
      .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 78)), 0);
    const visibleLineCount = Math.min(6, Math.max(3, wrappedLineEstimate || 1));
    return FLOATING_INSPECTOR_HEADER_HEIGHT + descriptionHeight + 32 + visibleLineCount * 24;
  }

  const getDefaultFloatingInspectorRectForTarget = useCallback(
    (target: CanvasFloatingInspectorTarget): CanvasFloatingInspectorRect => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const defaultRect = {
        x: 72,
        y: 88,
        width: 620,
        height: estimateFloatingInspectorHeight(target),
      };

      if (!canvasRect) return defaultRect;

      return clampFloatingInspectorRect(
        {
          x: Math.max(24, Math.round((canvasRect.width - defaultRect.width) / 2)),
          y: Math.max(32, Math.round((canvasRect.height - defaultRect.height) / 4)),
          width: Math.min(defaultRect.width, canvasRect.width - 24),
          height: Math.min(defaultRect.height, canvasRect.height - 24),
        },
        target.type,
      );
    },
    [clampFloatingInspectorRect],
  );

  const getFloatingInspectorRectForTarget = useCallback(
    (
      target: CanvasFloatingInspectorTarget,
      baseRect?: CanvasFloatingInspectorRect | null,
    ): CanvasFloatingInspectorRect => {
      if (!baseRect) return getDefaultFloatingInspectorRectForTarget(target);
      return clampFloatingInspectorRect(
        { ...baseRect, height: estimateFloatingInspectorHeight(target) },
        target.type,
      );
    },
    [clampFloatingInspectorRect, getDefaultFloatingInspectorRectForTarget],
  );

  // ── Inspector lifecycle ────────────────────────────────────────────────────

  const activateFloatingInspector = useCallback((inspectorId: string) => {
    setFloatingInspectors((current) => moveFloatingInspectorToFront(current, inspectorId));
  }, []);

  const closeFloatingInspector = useCallback((inspectorId: string) => {
    // Cancel any in-progress drag/resize for the closing inspector
    if (floatingInspectorDragStateRef.current?.inspectorId === inspectorId) {
      floatingInspectorDragStateRef.current = null;
    }
    if (floatingInspectorResizeStateRef.current?.inspectorId === inspectorId) {
      floatingInspectorResizeStateRef.current = null;
    }
    setFloatingInspectors((current) =>
      current.map((inspector) =>
        inspector.id === inspectorId ? { ...inspector, phase: 'closing' } : inspector,
      ),
    );
  }, []);

  const selectFloatingInspectorTab = useCallback(
    (inspectorId: string, tabId: string) => {
      setFloatingInspectors((current) => {
        const nextInspectors = current.map((inspector) => {
          if (inspector.id !== inspectorId || !inspector.tabs.some((tab) => tab.id === tabId)) {
            return inspector;
          }

          const nextActiveTab = inspector.tabs.find((tab) => tab.id === tabId);
          if (!nextActiveTab) return inspector;

          const baseRect = inspector.window.maximized
            ? inspector.window.restoreRect ?? inspector.window.rect
            : inspector.window.rect;
          const nextRect = getFloatingInspectorRectForTarget(nextActiveTab.target, baseRect);

          return {
            ...inspector,
            activeTabId: tabId,
            phase: 'open' as const,
            window: {
              rect: inspector.window.maximized ? inspector.window.rect : nextRect,
              minimized: false,
              maximized: inspector.window.maximized,
              restoreRect: inspector.window.maximized ? nextRect : inspector.window.restoreRect,
            },
          };
        });

        return moveFloatingInspectorToFront(nextInspectors, inspectorId);
      });
    },
    [getFloatingInspectorRectForTarget],
  );

  const closeFloatingInspectorTab = useCallback(
    (inspectorId: string, tabId: string) => {
      if (floatingInspectorDragStateRef.current?.inspectorId === inspectorId) {
        floatingInspectorDragStateRef.current = null;
      }
      if (floatingInspectorResizeStateRef.current?.inspectorId === inspectorId) {
        floatingInspectorResizeStateRef.current = null;
      }

      setFloatingInspectors((current) => {
        const nextInspectors = current.flatMap<FloatingInspectorState>((inspector) => {
          if (inspector.id !== inspectorId) return [inspector];

          const nextTabs = inspector.tabs.filter((tab) => tab.id !== tabId);
          if (nextTabs.length === inspector.tabs.length) return [inspector];
          if (nextTabs.length === 0) return [{ ...inspector, phase: 'closing' }];

          const closedTabIndex = inspector.tabs.findIndex((tab) => tab.id === tabId);
          const nextActiveTabId =
            inspector.activeTabId === tabId
              ? (nextTabs[Math.max(0, Math.min(closedTabIndex, nextTabs.length - 1))]?.id ??
                nextTabs[0].id)
              : inspector.activeTabId;
          const nextActiveTab = nextTabs.find((tab) => tab.id === nextActiveTabId) ?? nextTabs[0];
          const baseRect = inspector.window.maximized
            ? inspector.window.restoreRect ?? inspector.window.rect
            : inspector.window.rect;
          const nextRect = getFloatingInspectorRectForTarget(nextActiveTab.target, baseRect);

          return [
            {
              ...inspector,
              activeTabId: nextActiveTab.id,
              tabs: nextTabs,
              phase: 'open' as const,
              window: {
                rect: inspector.window.maximized ? inspector.window.rect : nextRect,
                minimized: false,
                maximized: inspector.window.maximized,
                restoreRect: inspector.window.maximized ? nextRect : inspector.window.restoreRect,
              },
            },
          ];
        });

        return moveFloatingInspectorToFront(nextInspectors, inspectorId);
      });
    },
    [getFloatingInspectorRectForTarget],
  );

  const toggleFloatingInspectorMinimize = useCallback((inspectorId: string) => {
    setFloatingInspectors((current) => {
      const nextInspectors = current.map((inspector) =>
        inspector.id === inspectorId
          ? { ...inspector, window: { ...inspector.window, minimized: !inspector.window.minimized } }
          : inspector,
      );
      return moveFloatingInspectorToFront(nextInspectors, inspectorId);
    });
  }, []);

  const toggleFloatingInspectorMaximize = useCallback((inspectorId: string) => {
    setFloatingInspectors((current) => {
      const nextInspectors = current.map((inspector) => {
        if (inspector.id !== inspectorId) return inspector;

        if (inspector.window.maximized) {
          return {
            ...inspector,
            window: {
              ...inspector.window,
              rect: inspector.window.restoreRect ?? inspector.window.rect,
              minimized: false,
              maximized: false,
              restoreRect: null,
            },
          };
        }

        const canvasRect = canvasRef.current?.getBoundingClientRect();
        if (!canvasRect) return inspector;

        return {
          ...inspector,
          window: {
            ...inspector.window,
            rect: {
              x: 16,
              y: 16,
              width: Math.max(FLOATING_INSPECTOR_MIN_WIDTH, canvasRect.width - 32),
              height: Math.max(FLOATING_INSPECTOR_MIN_HEIGHT, canvasRect.height - 32),
            },
            minimized: false,
            maximized: true,
            restoreRect: inspector.window.rect,
          },
        };
      });

      return moveFloatingInspectorToFront(nextInspectors, inspectorId);
    });
  }, []);

  // ── Drag and resize initiation ─────────────────────────────────────────────

  const handleFloatingInspectorHeaderPointerDown = useCallback(
    (inspectorId: string, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      setFloatingInspectors((current) => {
        const inspector = current.find((entry) => entry.id === inspectorId);
        if (!inspector || inspector.window.maximized) return current;

        floatingInspectorDragStateRef.current = {
          inspectorId,
          origin: { x: event.clientX, y: event.clientY },
          baseRect: inspector.window.rect,
        };

        return moveFloatingInspectorToFront(current, inspectorId);
      });
    },
    [],
  );

  const handleFloatingInspectorResizePointerDown = useCallback(
    (inspectorId: string, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      setFloatingInspectors((current) => {
        const inspector = current.find((entry) => entry.id === inspectorId);
        if (!inspector || inspector.window.maximized || inspector.window.minimized) return current;

        floatingInspectorResizeStateRef.current = {
          inspectorId,
          origin: { x: event.clientX, y: event.clientY },
          baseRect: inspector.window.rect,
        };

        return moveFloatingInspectorToFront(current, inspectorId);
      });
    },
    [],
  );

  // ── Text editing ───────────────────────────────────────────────────────────

  const handleFloatingInspectorTextChange = useCallback(
    (inspectorId: string, value: string) => {
      let activeFileId: string | null = null;

      setFloatingInspectors((current) =>
        current.map((inspector) => {
          if (inspector.id !== inspectorId) return inspector;

          const activeTab = inspector.tabs.find((tab) => tab.id === inspector.activeTabId);
          if (!activeTab || activeTab.target.type !== 'file') return inspector;

          activeFileId = activeTab.fileId;

          return {
            ...inspector,
            tabs: inspector.tabs.map((tab) =>
              tab.id === inspector.activeTabId && tab.target.type === 'file'
                ? {
                    ...tab,
                    target: {
                      ...tab.target,
                      textContent: value,
                      sizeBytes: value.length,
                    },
                  }
                : tab,
            ),
          };
        }),
      );

      if (activeFileId && onUpdateWorkspaceFileContent) {
        onUpdateWorkspaceFileContent(activeFileId, value);
      }
    },
    [onUpdateWorkspaceFileContent],
  );

  // ── Inspector drag / resize pointer handlers ───────────────────────────────

  useEffect(() => {
    const commitPointerMove = (point: Point) => {
      const liveDrag = floatingInspectorDragStateRef.current;
      const liveResize = floatingInspectorResizeStateRef.current;
      if (!liveDrag && !liveResize) return;

      if (liveDrag) {
        setFloatingInspectors((current) =>
          current.map((inspector) => {
            if (inspector.id !== liveDrag.inspectorId) return inspector;
            const activeTab =
              inspector.tabs.find((tab) => tab.id === inspector.activeTabId) ?? inspector.tabs[0];
            return {
              ...inspector,
              window: {
                ...inspector.window,
                rect: clampFloatingInspectorRect(
                  {
                    ...liveDrag.baseRect,
                    x: liveDrag.baseRect.x + (point.x - liveDrag.origin.x),
                    y: liveDrag.baseRect.y + (point.y - liveDrag.origin.y),
                  },
                  activeTab?.target.type ?? 'file',
                ),
              },
            };
          }),
        );
        return;
      }

      if (!liveResize) return;

      setFloatingInspectors((current) =>
        current.map((inspector) => {
          if (inspector.id !== liveResize.inspectorId) return inspector;
          const activeTab =
            inspector.tabs.find((tab) => tab.id === inspector.activeTabId) ?? inspector.tabs[0];
          return {
            ...inspector,
            window: {
              ...inspector.window,
              rect: clampFloatingInspectorRect(
                {
                  ...liveResize.baseRect,
                  width: liveResize.baseRect.width + (point.x - liveResize.origin.x),
                  height: liveResize.baseRect.height + (point.y - liveResize.origin.y),
                },
                activeTab?.target.type ?? 'file',
              ),
            },
          };
        }),
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      const liveDrag = floatingInspectorDragStateRef.current;
      const liveResize = floatingInspectorResizeStateRef.current;
      if (!liveDrag && !liveResize) return;

      floatingInspectorPointerRef.current = { x: event.clientX, y: event.clientY };
      if (floatingInspectorFrameRef.current !== null) return;

      floatingInspectorFrameRef.current = window.requestAnimationFrame(() => {
        floatingInspectorFrameRef.current = null;
        const point = floatingInspectorPointerRef.current;
        if (point) commitPointerMove(point);
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      const liveDrag = floatingInspectorDragStateRef.current;
      if (floatingInspectorFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingInspectorFrameRef.current);
        floatingInspectorFrameRef.current = null;
      }
      const latestPoint = floatingInspectorPointerRef.current;
      if (latestPoint) {
        commitPointerMove(latestPoint);
        floatingInspectorPointerRef.current = null;
      }
      floatingInspectorDragStateRef.current = null;
      floatingInspectorResizeStateRef.current = null;

      if (!liveDrag || !canvasRef.current) return;

      const canvasRect = canvasRef.current.getBoundingClientRect();
      const releasePoint: Point = {
        x: event.clientX - canvasRect.left,
        y: event.clientY - canvasRect.top,
      };

      // Find if the release is over another inspector — if so, merge tabs
      const targetInspector = [...floatingInspectorsRef.current]
        .reverse()
        .find(
          (inspector) =>
            inspector.id !== liveDrag.inspectorId &&
            inspector.phase !== 'closing' &&
            pointIsWithinRect(releasePoint, inspector.window.rect),
        );

      if (!targetInspector) return;

      setFloatingInspectors((current) => {
        const sourceInspector = current.find((i) => i.id === liveDrag.inspectorId);
        const mergeTarget = current.find((i) => i.id === targetInspector.id);
        if (!sourceInspector || !mergeTarget) return current;

        const mergedTabsById = new Map<string, FloatingInspectorTabState>();
        mergeTarget.tabs.forEach((tab) => mergedTabsById.set(tab.id, tab));
        sourceInspector.tabs.forEach((tab) => mergedTabsById.set(tab.id, tab));

        const mergedTabs = [...mergedTabsById.values()];
        const nextInspectors = current
          .filter((i) => i.id !== sourceInspector.id)
          .map((i) =>
            i.id === mergeTarget.id
              ? { ...i, tabs: mergedTabs, phase: 'open' as const, window: { ...i.window, minimized: false } }
              : i,
          );

        return moveFloatingInspectorToFront(nextInspectors, mergeTarget.id);
      });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (floatingInspectorFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingInspectorFrameRef.current);
        floatingInspectorFrameRef.current = null;
      }
    };
  }, [clampFloatingInspectorRect]);

  // ── Target building ────────────────────────────────────────────────────────

  const resolveSourceFileItem = useCallback(
    (node: FilePageNode): FilePageContentItem | null => {
      if (node.kind !== 'file') return null;
      return resolveCanvasFileItem?.(node) ?? createFallbackFileItem(node);
    },
    [resolveCanvasFileItem],
  );

  const buildFloatingInspectorTargetFromNode = useCallback(
    (
      node: FilePageNode,
    ): { tabId: string; target: CanvasFloatingInspectorTarget; fileId: string | null } | null => {
      if (node.kind === 'file') {
        const sourceItem = resolveSourceFileItem(node);
        if (!sourceItem) return null;

        const fileId = resolveCanvasFileId?.(node) ?? null;
        return {
          fileId,
          tabId: fileId ? `file:${fileId}` : `node:${node.id}`,
          target: {
            type: 'file',
            label: node.label,
            description: sourceItem.description ?? node.description,
            textContent: sourceItem.textContent ?? '',
            editable: fileId !== null && typeof onUpdateWorkspaceFileContent === 'function',
            mimeType: sourceItem.mimeType ?? null,
            sizeBytes: sourceItem.sizeBytes ?? null,
          },
        };
      }

      if (node.kind === 'folder') {
        return {
          fileId: null,
          tabId: `node:${node.id}`,
          target: {
            type: 'folder',
            label: node.label,
            description: node.description,
            items: resolveNodeFolderContents(node),
          },
        };
      }

      return null;
    },
    [
      onUpdateWorkspaceFileContent,
      resolveCanvasFileId,
      resolveNodeFolderContents,
      resolveSourceFileItem,
    ],
  );

  const buildFloatingInspectorTargetFromItem = useCallback(
    (
      item: FilePageContentItem,
    ): { tabId: string; target: CanvasFloatingInspectorTarget; fileId: string | null } | null => {
      if (item.kind !== 'file') return null;

      const fileId = item.id.startsWith('file:') ? item.id.slice('file:'.length) : null;
      return {
        fileId,
        tabId: fileId ? `file:${fileId}` : `item:${item.id}`,
        target: {
          type: 'file',
          label: item.label,
          description: item.description ?? '',
          textContent: item.textContent ?? '',
          editable: fileId !== null && typeof onUpdateWorkspaceFileContent === 'function',
          mimeType: item.mimeType ?? null,
          sizeBytes: item.sizeBytes ?? null,
        },
      };
    },
    [onUpdateWorkspaceFileContent],
  );

  // ── Open inspectors ────────────────────────────────────────────────────────

  const openFloatingInspector = useCallback(
    (
      tabId: string,
      nextTarget: CanvasFloatingInspectorTarget,
      fileId: string | null = null,
    ) => {
      setFloatingInspectors((current) => {
        const existingInspector = current.find((inspector) =>
          inspector.tabs.some((tab) => tab.id === tabId),
        );

        if (existingInspector) {
          const nextInspectors = current.map((inspector) => {
            if (inspector.id !== existingInspector.id) return inspector;

            const baseRect = inspector.window.maximized
              ? inspector.window.restoreRect ?? inspector.window.rect
              : inspector.window.rect;
            const nextRect = getFloatingInspectorRectForTarget(nextTarget, baseRect);

            return {
              ...inspector,
              activeTabId: tabId,
              phase: 'open' as const,
              tabs: inspector.tabs.map((tab) =>
                tab.id === tabId ? { ...tab, fileId, target: nextTarget } : tab,
              ),
              window: {
                rect: inspector.window.maximized ? inspector.window.rect : nextRect,
                minimized: false,
                maximized: inspector.window.maximized,
                restoreRect: inspector.window.maximized ? nextRect : inspector.window.restoreRect,
              },
            };
          });

          return moveFloatingInspectorToFront(nextInspectors, existingInspector.id);
        }

        // Stack new inspector slightly offset from the top one
        const topInspector = current[current.length - 1];
        const baseRect = topInspector
          ? topInspector.window.maximized
            ? topInspector.window.restoreRect ?? topInspector.window.rect
            : topInspector.window.rect
          : null;
        const stackedBaseRect = baseRect
          ? {
              ...baseRect,
              x: baseRect.x + FLOATING_INSPECTOR_STACK_OFFSET,
              y: baseRect.y + FLOATING_INSPECTOR_STACK_OFFSET,
            }
          : null;
        const nextRect = getFloatingInspectorRectForTarget(nextTarget, stackedBaseRect);

        const nextInspector: FloatingInspectorState = {
          id: buildFloatingInspectorId(),
          activeTabId: tabId,
          tabs: [{ id: tabId, fileId, target: nextTarget }],
          phase: 'opening',
          window: { rect: nextRect, minimized: false, maximized: false, restoreRect: null },
        };

        return [...current, nextInspector];
      });
    },
    [getFloatingInspectorRectForTarget],
  );

  const openFloatingInspectorForNode = useCallback(
    (node: FilePageNode) => {
      if (Date.now() < suppressPreviewOpenUntilRef.current) return;

      const previewTarget = buildFloatingInspectorTargetFromNode(node);
      if (!previewTarget) return;

      openFloatingInspector(previewTarget.tabId, previewTarget.target, previewTarget.fileId);
    },
    [buildFloatingInspectorTargetFromNode, openFloatingInspector],
  );

  const openFloatingInspectorForItem = useCallback(
    (item: FilePageContentItem) => {
      if (Date.now() < suppressPreviewOpenUntilRef.current) return;

      // If the item is a canvas node, open via the node path to get full context
      const nodeMatch = getNodeById(item.id);
      if (nodeMatch && (nodeMatch.kind === 'file' || nodeMatch.kind === 'folder')) {
        openFloatingInspectorForNode(nodeMatch);
        return;
      }

      const previewTarget = buildFloatingInspectorTargetFromItem(item);
      if (!previewTarget) return;

      openFloatingInspector(previewTarget.tabId, previewTarget.target, previewTarget.fileId);
    },
    [
      buildFloatingInspectorTargetFromItem,
      getNodeById,
      openFloatingInspector,
      openFloatingInspectorForNode,
    ],
  );

  return {
    floatingInspectors,
    floatingInspectorsRef,
    activateFloatingInspector,
    closeFloatingInspector,
    selectFloatingInspectorTab,
    closeFloatingInspectorTab,
    toggleFloatingInspectorMinimize,
    toggleFloatingInspectorMaximize,
    handleFloatingInspectorHeaderPointerDown,
    handleFloatingInspectorResizePointerDown,
    handleFloatingInspectorTextChange,
    openFloatingInspectorForNode,
    openFloatingInspectorForItem,
  };
}
