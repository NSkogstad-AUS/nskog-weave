/**
 * useWorkerEngine — manages worker node lifecycle.
 *
 * Handles:
 *  - Source file collection from connected canvas nodes
 *  - Signature-based cache invalidation
 *  - Sort worker (synchronous, interval-driven progress)
 *  - Output folder creation / update in canvas nodes
 *  - Cleanup of timers, controllers and refs on unmount
 */

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import {
  DEFAULT_FILE_PAGE_WORKER_FOCUS,
  DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
  DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
  getWorkerModeMeta,
  getWorkerOutputItemLabel,
  resolveWorkerMode,
} from '@/lib/filePageWorkers';
import type {
  FilePageContentItem,
  FilePageNode,
  FilePageNodeUpdates,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';
import { clampNodePositionToBounds, getNodeBoundsWithSize, getNodeDimensionsForKind, resolveSnapPositions } from './utils';
import { SLOT_STEP_X } from './constants';
import { clampToCanvas } from './utils';
import type { NodeBounds } from './canvasTypes';
import {
  createContentHash,
  createFallbackFileItem,
  getContentItemDedupKey,
  sortCanvasContentItems,
} from './canvasUtils';

// ─── Hook options ─────────────────────────────────────────────────────────────

interface UseWorkerEngineOptions {
  nodes: FilePageNode[];
  nodesRef: RefObject<FilePageNode[]>;
  draftPositionsRef: RefObject<Record<string, Point>>;
  draftSizesRef: RefObject<Record<string, FilePageNode['size']>>;
  getNodeById: (id: string) => FilePageNode | undefined;
  getGroupBounds: (groupId: string, positions?: Record<string, Point>) => NodeBounds | null;
  onAddNodeRef: RefObject<(node: FilePageNode) => void>;
  onUpdateNodeRef: RefObject<(id: string, updates: FilePageNodeUpdates) => void>;
  onDeleteNodeRef: RefObject<(id: string) => void>;
  resolveCanvasFileItem?: (node: FilePageNode) => FilePageContentItem | null;
  resolveCanvasFolderSourceFiles?: (node: FilePageNode) => FilePageContentItem[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWorkerEngine({
  nodes,
  nodesRef,
  draftPositionsRef,
  draftSizesRef,
  getNodeById,
  getGroupBounds,
  onAddNodeRef,
  onUpdateNodeRef,
  onDeleteNodeRef,
  resolveCanvasFileItem,
  resolveCanvasFolderSourceFiles,
}: UseWorkerEngineOptions) {
  // ── Internal refs ──────────────────────────────────────────────────────────

  const workerProcessTimersRef = useRef<Record<string, number>>({});

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(
    () => () => {
      Object.values(workerProcessTimersRef.current).forEach((id) => window.clearInterval(id));
      workerProcessTimersRef.current = {};
    },
    [],
  );

  // ── Timer management ───────────────────────────────────────────────────────

  const clearWorkerProcessTimer = useCallback((workerId: string) => {
    const timerId = workerProcessTimersRef.current[workerId];
    if (typeof timerId === 'number') {
      window.clearInterval(timerId);
      delete workerProcessTimersRef.current[workerId];
    }
  }, []);

  const cancelWorkerRequest = useCallback((_workerId: string) => {}, []);

  // ── Source file collection ─────────────────────────────────────────────────

  /** Returns nodes directly connected as inputs to a worker (not generated outputs). */
  const getWorkerInputNodes = useCallback(
    (workerId: string): FilePageNode[] =>
      nodesRef.current.filter(
        (node) =>
          node.parentNodeId === workerId &&
          (node.kind === 'file' || node.kind === 'folder') &&
          node.generatedByWorkerId !== workerId,
      ),
    [],
  );

  const resolveSourceFileItem = useCallback(
    (node: FilePageNode): FilePageContentItem | null => {
      if (node.kind !== 'file') return null;
      return resolveCanvasFileItem?.(node) ?? createFallbackFileItem(node);
    },
    [resolveCanvasFileItem],
  );

  const collectFolderSourceFiles = useCallback(
    (folderId: string, visited = new Set<string>()): FilePageContentItem[] => {
      if (visited.has(folderId)) return [];

      const folderNode = getNodeById(folderId);
      if (!folderNode || folderNode.kind !== 'folder') return [];

      const nextVisited = new Set(visited);
      nextVisited.add(folderId);

      const resolvedFolderFiles = resolveCanvasFolderSourceFiles?.(folderNode) ?? [];
      const directChildFiles = nodesRef.current.flatMap((node) => {
        if (node.parentNodeId !== folderId) return [];
        if (node.kind === 'file') {
          const source = resolveSourceFileItem(node);
          return source ? [source] : [];
        }
        if (node.kind === 'folder') return collectFolderSourceFiles(node.id, nextVisited);
        return [];
      });
      const generatedFiles = (folderNode.contentItems ?? []).filter((item) => item.kind === 'file');

      const dedupedById = new Map<string, FilePageContentItem>();
      [...resolvedFolderFiles, ...directChildFiles, ...generatedFiles].forEach((item) => {
        dedupedById.set(getContentItemDedupKey(item), item);
      });

      return sortCanvasContentItems([...dedupedById.values()]);
    },
    [getNodeById, resolveCanvasFolderSourceFiles, resolveSourceFileItem],
  );

  const collectWorkerSourceFiles = useCallback(
    (workerId: string): FilePageContentItem[] => {
      const sourceFiles = getWorkerInputNodes(workerId).flatMap((node) =>
        node.kind === 'file'
          ? (() => {
              const source = resolveSourceFileItem(node);
              return source ? [source] : [];
            })()
          : collectFolderSourceFiles(node.id),
      );
      const dedupedByKey = new Map<string, FilePageContentItem>();
      sourceFiles.forEach((item) => dedupedByKey.set(getContentItemDedupKey(item), item));
      return sortCanvasContentItems([...dedupedByKey.values()]);
    },
    [collectFolderSourceFiles, getWorkerInputNodes, resolveSourceFileItem],
  );

  // ── Signature building ─────────────────────────────────────────────────────

  const buildWorkerSourceSignature = useCallback(
    (worker: FilePageNode, item: FilePageContentItem): string =>
      JSON.stringify({
        workerMode: resolveWorkerMode(worker.workerMode),
        workerFocus: worker.workerFocus ?? DEFAULT_FILE_PAGE_WORKER_FOCUS,
        workerRunMode: worker.workerRunMode ?? DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
        workerOutputMode: worker.workerOutputMode ?? DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
        workerLabel: worker.label,
        sourceItemId: item.id,
        sourceLabel: item.label,
        mimeType: item.mimeType ?? '',
        textHash: createContentHash(item.textContent),
      }),
    [],
  );

  const buildWorkerInputSignature = useCallback(
    (workerId: string): string => {
      const worker = getNodeById(workerId);
      const workerMode = resolveWorkerMode(worker?.workerMode ?? null);
      const inputs = getWorkerInputNodes(workerId);
      const files = collectWorkerSourceFiles(workerId);

      return JSON.stringify({
        workerMode,
        workerFocus: worker?.workerFocus ?? DEFAULT_FILE_PAGE_WORKER_FOCUS,
        workerRunMode: worker?.workerRunMode ?? DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
        workerOutputMode: worker?.workerOutputMode ?? DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
        workerLabel: worker?.label ?? '',
        inputs: inputs
          .map((n) => `${n.id}:${n.label}:${n.kind}`)
          .sort((a, b) => a.localeCompare(b)),
        files: files
          .map((item) => (worker ? buildWorkerSourceSignature(worker, item) : item.id))
          .sort((a, b) => a.localeCompare(b)),
      });
    },
    [buildWorkerSourceSignature, collectWorkerSourceFiles, getNodeById, getWorkerInputNodes],
  );

  // ── Output folder management ───────────────────────────────────────────────

  const getExistingWorkerOutputFolder = useCallback(
    (worker: FilePageNode): FilePageNode | null =>
      (worker.workerOutputFolderId ? getNodeById(worker.workerOutputFolderId) : null) ??
      nodesRef.current.find(
        (n) => n.kind === 'folder' && n.generatedByWorkerId === worker.id,
      ) ??
      null,
    [getNodeById],
  );

  const removeWorkerOutputFolder = useCallback(
    (worker: FilePageNode) => {
      const outputFolder = getExistingWorkerOutputFolder(worker);
      if (outputFolder) onDeleteNodeRef.current(outputFolder.id);
    },
    [getExistingWorkerOutputFolder],
  );

  const commitWorkerOutput = useCallback(
    (
      workerId: string,
      inputSignature: string,
      outputItems: FilePageContentItem[],
    ) => {
      clearWorkerProcessTimer(workerId);
      const worker = getNodeById(workerId);
      if (!worker || worker.kind !== 'worker') return;

      const workerMeta = getWorkerModeMeta(worker.workerMode);
      const existingOutputFolder = getExistingWorkerOutputFolder(worker);

      if (outputItems.length === 0) {
        if (existingOutputFolder) onDeleteNodeRef.current(existingOutputFolder.id);

        onUpdateNodeRef.current(workerId, {
          workerStatus: 'complete',
          workerProgress: 100,
          workerInputSignature: inputSignature,
          workerOutputFolderId: null,
          workerLastError: null,
        });
        return;
      }

      if (!existingOutputFolder) {
        // Place a new output folder to the right of the worker
        const workerPosition = draftPositionsRef.current[workerId] ?? worker.position;
        const workerSize = draftSizesRef.current[workerId] ?? worker.size;
        const workerDimensions = getNodeDimensionsForKind(workerSize, worker.kind);
        const nextFolderId = `worker-output-${workerId}`;
        const nextFolderSize = { widthUnits: 3, heightUnits: 2 } satisfies FilePageNode['size'];
        const desiredPosition = {
          x: workerPosition.x + workerDimensions.width + SLOT_STEP_X,
          y: workerPosition.y,
        };
        const parentGroupBounds = worker.groupId ? getGroupBounds(worker.groupId) : null;
        const constrainedDesiredPos = parentGroupBounds
          ? clampNodePositionToBounds(desiredPosition, nextFolderSize, parentGroupBounds)
          : { x: clampToCanvas(desiredPosition.x), y: clampToCanvas(desiredPosition.y) };

        const resolvedPosition =
          resolveSnapPositions(
            { [nextFolderId]: constrainedDesiredPos },
            [nextFolderId],
            nodesRef.current,
            { [nextFolderId]: constrainedDesiredPos },
            { [nextFolderId]: nextFolderSize },
            undefined,
            {
              getNodeKind: (nodeId) =>
                nodeId === nextFolderId ? 'folder' : getNodeById(nodeId)?.kind,
              constrainPosition: (position) =>
                parentGroupBounds
                  ? clampNodePositionToBounds(position, nextFolderSize, parentGroupBounds)
                  : { x: clampToCanvas(position.x), y: clampToCanvas(position.y) },
            },
          )[nextFolderId] ?? constrainedDesiredPos;

        onAddNodeRef.current({
          id: nextFolderId,
          label: workerMeta.outputFolderLabel,
          description: workerMeta.outputFolderDescription,
          kind: 'folder',
          icon: 'shapes',
          groupId: worker.groupId ?? null,
          parentNodeId: worker.id,
          contentItems: outputItems,
          generatedByWorkerId: worker.id,
          position: resolvedPosition,
          size: nextFolderSize,
          workerMode: null,
          workerStatus: null,
          workerProgress: null,
          workerOutputFolderId: null,
          workerInputSignature: null,
          workerLastError: null,
        });

        onUpdateNodeRef.current(workerId, {
          workerStatus: 'complete',
          workerProgress: 100,
          workerInputSignature: inputSignature,
          workerOutputFolderId: nextFolderId,
          workerLastError: null,
        });
        return;
      }

      // Update existing output folder in place
      onUpdateNodeRef.current(existingOutputFolder.id, {
        label: workerMeta.outputFolderLabel,
        description: workerMeta.outputFolderDescription,
        groupId: worker.groupId ?? null,
        parentNodeId: worker.id,
        contentItems: outputItems,
        generatedByWorkerId: worker.id,
      });
      onUpdateNodeRef.current(workerId, {
        workerStatus: 'complete',
        workerProgress: 100,
        workerInputSignature: inputSignature,
        workerOutputFolderId: existingOutputFolder.id,
        workerLastError: null,
      });
    },
    [clearWorkerProcessTimer, getExistingWorkerOutputFolder, getGroupBounds, getNodeById],
  );

  // ── Sort worker ────────────────────────────────────────────────────────────

  const buildSortWorkerOutputItems = useCallback(
    (workerId: string): FilePageContentItem[] => {
      const worker = getNodeById(workerId);
      if (!worker || worker.kind !== 'worker') return [];

      const orderedEntries = collectWorkerSourceFiles(workerId)
        .map((item) => [item.label.trim().toLowerCase(), item] as const)
        .sort(([, a], [, b]) =>
          a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
        );

      return sortCanvasContentItems(
        orderedEntries.map(([, item], index, items) => ({
          id: `${workerId}:${item.label.trim().toLowerCase()}`,
          kind: 'file' as const,
          label: getWorkerOutputItemLabel(worker.workerMode, item.label, index, items.length),
          description: item.description ?? `Sorted copy of ${item.label}.`,
          textContent: item.textContent ?? null,
          mimeType: item.mimeType ?? 'text/plain',
          sizeBytes: item.sizeBytes ?? item.textContent?.length ?? null,
        })),
      );
    },
    [collectWorkerSourceFiles, getNodeById],
  );

  const completeSortWorkerProcessing = useCallback(
    (workerId: string, inputSignature: string) => {
      commitWorkerOutput(workerId, inputSignature, buildSortWorkerOutputItems(workerId));
    },
    [buildSortWorkerOutputItems, commitWorkerOutput],
  );

  const startSortWorkerProcessing = useCallback(
    (workerId: string, inputSignature: string) => {
      clearWorkerProcessTimer(workerId);
      onUpdateNodeRef.current(workerId, {
        workerStatus: 'processing',
        workerProgress: 8,
        workerLastError: null,
      });

      let progress = 8;
      const timerId = window.setInterval(() => {
        progress = Math.min(100, progress + 14);
        if (progress >= 100) {
          completeSortWorkerProcessing(workerId, inputSignature);
          return;
        }
        onUpdateNodeRef.current(workerId, { workerStatus: 'processing', workerProgress: progress });
      }, 220);

      workerProcessTimersRef.current[workerId] = timerId;
    },
    [clearWorkerProcessTimer, completeSortWorkerProcessing],
  );

  // ── Worker lifecycle effect ────────────────────────────────────────────────

  useEffect(() => {
    const activeWorkerIds = new Set(
      nodes.filter((n) => n.kind === 'worker').map((n) => n.id),
    );

    // Clean up timers for removed workers
    Object.keys(workerProcessTimersRef.current).forEach((workerId) => {
      if (!activeWorkerIds.has(workerId)) clearWorkerProcessTimer(workerId);
    });

    nodes.forEach((node) => {
      if (node.kind !== 'worker') return;

      const inputNodes = getWorkerInputNodes(node.id);
      const inputSignature = buildWorkerInputSignature(node.id);
      const outputFolderExists = node.workerOutputFolderId
        ? Boolean(getNodeById(node.workerOutputFolderId))
        : Boolean(
            nodesRef.current.find(
              (candidate) => candidate.kind === 'folder' && candidate.generatedByWorkerId === node.id,
            ),
          );

      // No inputs → reset worker state
      if (inputNodes.length === 0) {
        cancelWorkerRequest(node.id);
        clearWorkerProcessTimer(node.id);
        if (outputFolderExists) removeWorkerOutputFolder(node);

        if (
          node.workerStatus !== 'idle' ||
          (node.workerProgress ?? 0) !== 0 ||
          node.workerOutputFolderId ||
          node.workerInputSignature ||
          node.workerLastError
        ) {
          onUpdateNodeRef.current(node.id, {
            workerStatus: 'idle',
            workerProgress: 0,
            workerOutputFolderId: null,
            workerInputSignature: null,
            workerLastError: null,
          });
        }
        return;
      }

      // Sort worker: auto-run when not already processing or complete
      if (node.workerStatus === 'processing') return;

      if (
        node.workerStatus === 'complete' &&
        node.workerInputSignature === inputSignature &&
        outputFolderExists
      ) {
        return;
      }

      startSortWorkerProcessing(node.id, inputSignature);
    });
  }, [
    buildWorkerInputSignature,
    cancelWorkerRequest,
    clearWorkerProcessTimer,
    getNodeById,
    getWorkerInputNodes,
    nodes,
    removeWorkerOutputFolder,
    startSortWorkerProcessing,
  ]);

  return {
    // Source collection (used by floating inspector target resolution)
    resolveSourceFileItem,
    collectWorkerSourceFiles,
    getWorkerInputNodes,
    // Worker management
    cancelWorkerRequest,
    clearWorkerProcessTimer,
    removeWorkerOutputFolder,
    // Connection detection (used in drag handlers)
    buildWorkerInputSignature,
  };
}
