/**
 * useWorkerEngine — manages worker node lifecycle.
 *
 * Handles:
 *  - Source file collection from connected canvas nodes
 *  - Signature-based cache invalidation
 *  - Sort worker (synchronous, interval-driven progress)
 *  - AI worker (async, batched fetch requests with timeout)
 *  - Output folder creation / update in canvas nodes
 *  - Cleanup of timers, controllers and refs on unmount
 */

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import {
  DEFAULT_FILE_PAGE_WORKER_FOCUS,
  DEFAULT_FILE_PAGE_WORKER_OUTPUT_MODE,
  DEFAULT_FILE_PAGE_WORKER_RUN_MODE,
  getWorkerClientTimeoutMs,
  getWorkerModeMeta,
  getWorkerOutputItemLabel,
  resolveWorkerMode,
  resolveWorkerOutputMode,
  resolveWorkerRunMode,
} from '@/lib/filePageWorkers';
import { buildContentSnippet } from '@/lib/workspaceFiles';
import type {
  FilePageContentItem,
  FilePageNode,
  FilePageNodeUpdates,
  FilePageWorkerRunMode,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';
import { clampNodePositionToBounds, getNodeBoundsWithSize, getNodeDimensionsForKind, resolveSnapPositions } from './utils';
import { SLOT_STEP_X } from './constants';
import { clampToCanvas } from './utils';
import type { NodeBounds } from './canvasTypes';
import {
  AI_WORKER_REQUEST_BATCH_SETTINGS,
  buildAiWorkerRequestBatches,
  buildCanvasPaletteItems,
  getAiWorkerRequestConcurrency,
} from './nodeBuilders';
import {
  buildAiOutputFileLabel,
  buildAiOutputItemId,
  COLLATED_WORKER_SOURCE_ITEM_ID,
  createContentHash,
  createFallbackFileItem,
  formatTimeoutLabel,
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
  const workerRequestControllersRef = useRef<Record<string, AbortController>>({});
  const workerRequestTimeoutsRef = useRef<Record<string, number>>({});
  const workerRequestSignaturesRef = useRef<Record<string, string>>({});

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(
    () => () => {
      Object.values(workerProcessTimersRef.current).forEach((id) => window.clearInterval(id));
      workerProcessTimersRef.current = {};
      Object.values(workerRequestControllersRef.current).forEach((ctrl) => ctrl.abort());
      workerRequestControllersRef.current = {};
      Object.values(workerRequestTimeoutsRef.current).forEach((id) => window.clearTimeout(id));
      workerRequestTimeoutsRef.current = {};
      workerRequestSignaturesRef.current = {};
    },
    [],
  );

  // ── Timer / request management ─────────────────────────────────────────────

  const clearWorkerProcessTimer = useCallback((workerId: string) => {
    const timerId = workerProcessTimersRef.current[workerId];
    if (typeof timerId === 'number') {
      window.clearInterval(timerId);
      delete workerProcessTimersRef.current[workerId];
    }
  }, []);

  const clearWorkerRequestTimeout = useCallback((workerId: string) => {
    const timeoutId = workerRequestTimeoutsRef.current[workerId];
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
      delete workerRequestTimeoutsRef.current[workerId];
    }
  }, []);

  const cancelWorkerRequest = useCallback(
    (workerId: string) => {
      workerRequestControllersRef.current[workerId]?.abort();
      delete workerRequestControllersRef.current[workerId];
      clearWorkerRequestTimeout(workerId);
      delete workerRequestSignaturesRef.current[workerId];
    },
    [clearWorkerRequestTimeout],
  );

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

  // ── Progress simulation ────────────────────────────────────────────────────

  const failWorkerProcessing = useCallback(
    (workerId: string, errorMessage: string) => {
      clearWorkerProcessTimer(workerId);
      onUpdateNodeRef.current(workerId, {
        workerStatus: 'error',
        workerProgress: 0,
        workerLastError: errorMessage,
      });
    },
    [clearWorkerProcessTimer],
  );

  const startWorkerProgressLoop = useCallback(
    (workerId: string) => {
      clearWorkerProcessTimer(workerId);
      onUpdateNodeRef.current(workerId, {
        workerStatus: 'processing',
        workerProgress: 8,
        workerLastError: null,
      });

      let progress = 8;
      const timerId = window.setInterval(() => {
        progress = Math.min(92, progress + (progress < 56 ? 14 : 6));
        onUpdateNodeRef.current(workerId, { workerStatus: 'processing', workerProgress: progress });
      }, 260);

      workerProcessTimersRef.current[workerId] = timerId;
    },
    [clearWorkerProcessTimer],
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

  // ── AI worker ──────────────────────────────────────────────────────────────

  const runAiWorker = useCallback(
    async (workerId: string) => {
      const worker = getNodeById(workerId);
      if (!worker || worker.kind !== 'worker') return;
      if (worker.workerStatus === 'processing' || workerRequestControllersRef.current[workerId]) {
        return;
      }

      const workerRunMode = resolveWorkerRunMode(worker.workerRunMode);
      const workerOutputMode = resolveWorkerOutputMode(worker.workerOutputMode);
      const baseClientTimeoutMs = getWorkerClientTimeoutMs(workerRunMode);
      const inputSignature = buildWorkerInputSignature(workerId);
      const sourceFiles = collectWorkerSourceFiles(workerId);
      const existingOutputFolder = getExistingWorkerOutputFolder(worker);
      const existingOutputItems = (existingOutputFolder?.contentItems ?? []).filter(
        (item): item is FilePageContentItem => item.kind === 'file',
      );
      const outputFolderExists = Boolean(existingOutputFolder);

      // Already up-to-date
      if (
        worker.workerStatus === 'complete' &&
        worker.workerInputSignature === inputSignature &&
        outputFolderExists &&
        !worker.workerLastError
      ) {
        return;
      }

      if (sourceFiles.length === 0) {
        failWorkerProcessing(workerId, 'Connect at least one file or folder before running the worker.');
        return;
      }

      const sourceEntries = sourceFiles.map((item) => ({
        ...item,
        sourceItemId: item.id,
        sourceSignature: buildWorkerSourceSignature(worker, item),
      }));

      // ── Collated output mode ─────────────────────────────────────────────

      if (workerOutputMode === 'collated') {
        const processableFiles = sourceEntries.filter(
          (item) => (item.textContent ?? '').trim().length > 0,
        );
        if (processableFiles.length === 0) {
          failWorkerProcessing(workerId, 'No previewable text was found in the connected inputs.');
          return;
        }

        startWorkerProgressLoop(workerId);
        const controller = new AbortController();
        let didTimeout = false;
        workerRequestControllersRef.current[workerId] = controller;
        workerRequestSignaturesRef.current[workerId] = inputSignature;
        workerRequestTimeoutsRef.current[workerId] = window.setTimeout(() => {
          didTimeout = true;
          controller.abort();
        }, baseClientTimeoutMs);

        try {
          const response = await fetch('/api/worker/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              mode: resolveWorkerMode(worker.workerMode),
              focus: worker.workerFocus ?? DEFAULT_FILE_PAGE_WORKER_FOCUS,
              runMode: workerRunMode,
              outputMode: workerOutputMode,
              workerLabel: worker.label,
              inputs: processableFiles.map((item) => ({
                sourceItemId: item.sourceItemId,
                label: item.label,
                description: item.description ?? '',
                textContent: item.textContent ?? '',
                mimeType: item.mimeType ?? null,
              })),
            }),
          });

          const payload = await response.json().catch(() => null);

          if (!response.ok) {
            const errMsg =
              typeof payload?.error === 'string' && payload.error.trim().length > 0
                ? payload.error
                : 'The AI worker request failed.';
            throw new Error(errMsg);
          }

          const generatedFile =
            Array.isArray(payload?.files)
              ? payload.files.find(
                  (file: unknown) =>
                    typeof file === 'object' &&
                    file !== null &&
                    typeof (file as { contentText?: unknown }).contentText === 'string' &&
                    (file as { contentText: string }).contentText.trim().length > 0,
                ) ?? null
              : null;

          if (!generatedFile) throw new Error('The AI worker returned no usable output.');

          const contentText = (generatedFile as { contentText: string }).contentText.trim();
          const descriptionValue =
            typeof (generatedFile as { description?: unknown }).description === 'string'
              ? (generatedFile as { description: string }).description.trim()
              : '';
          const existingCollatedOutput =
            existingOutputItems.find((item) => item.sourceItemId === COLLATED_WORKER_SOURCE_ITEM_ID) ??
            existingOutputItems[0] ??
            null;
          const nextVersion =
            typeof existingCollatedOutput?.outputVersion === 'number' &&
            Number.isFinite(existingCollatedOutput.outputVersion)
              ? Math.max(1, existingCollatedOutput.outputVersion) + 1
              : 1;
          const generatedAt = new Date().toISOString();

          commitWorkerOutput(workerId, inputSignature, [
            {
              id: buildAiOutputItemId(workerId, COLLATED_WORKER_SOURCE_ITEM_ID),
              kind: 'file',
              label: buildAiOutputFileLabel(worker.label, 'Collated', nextVersion, generatedAt),
              description:
                descriptionValue ||
                buildContentSnippet(contentText, 'Collated AI-ready output from the connected inputs.'),
              textContent: contentText,
              mimeType: 'text/markdown',
              sizeBytes: contentText.length,
              sourceItemId: COLLATED_WORKER_SOURCE_ITEM_ID,
              sourceSignature: inputSignature,
              outputVersion: nextVersion,
              generatedAt,
            },
          ]);
        } catch (error) {
          if (controller.signal.aborted && !didTimeout) return;
          failWorkerProcessing(
            workerId,
            didTimeout
              ? `AI worker timed out locally after ${formatTimeoutLabel(baseClientTimeoutMs)}. Try Fast mode, fewer files, or a smaller source.`
              : error instanceof Error
                ? error.message
                : 'The AI worker request failed.',
          );
        } finally {
          if (workerRequestControllersRef.current[workerId] === controller) {
            delete workerRequestControllersRef.current[workerId];
          }
          clearWorkerRequestTimeout(workerId);
          delete workerRequestSignaturesRef.current[workerId];
        }

        return;
      }

      // ── Per-file output mode ─────────────────────────────────────────────

      const existingOutputsBySourceId = new Map(
        existingOutputItems.flatMap((item) =>
          typeof item.sourceItemId === 'string' && item.sourceItemId.trim().length > 0
            ? [[item.sourceItemId, item] as const]
            : [],
        ),
      );

      const reusableOutputItems = sourceEntries.flatMap((item) => {
        const existingOutput = existingOutputsBySourceId.get(item.sourceItemId);
        if (!existingOutput || existingOutput.sourceSignature !== item.sourceSignature) return [];
        return [
          {
            ...existingOutput,
            sourceItemId: item.sourceItemId,
            sourceSignature: item.sourceSignature,
            outputVersion:
              typeof existingOutput.outputVersion === 'number' &&
              Number.isFinite(existingOutput.outputVersion)
                ? Math.max(1, existingOutput.outputVersion)
                : 1,
          },
        ];
      });

      const pendingSourceFiles = sourceEntries.filter(
        (item) => !reusableOutputItems.some((output) => output.sourceItemId === item.sourceItemId),
      );
      const processablePendingFiles = pendingSourceFiles.filter(
        (item) => (item.textContent ?? '').trim().length > 0,
      );
      const preservedLegacyItems = existingOutputItems.filter(
        (item) =>
          typeof item.sourceItemId !== 'string' ||
          item.sourceItemId.trim().length === 0 ||
          typeof item.sourceSignature !== 'string' ||
          item.sourceSignature.trim().length === 0,
      );
      const preservedOutputItems = sortCanvasContentItems([
        ...preservedLegacyItems,
        ...reusableOutputItems,
      ]);

      if (
        processablePendingFiles.length === 0 &&
        preservedOutputItems.length === 0 &&
        !sourceFiles.some((item) => (item.textContent ?? '').trim().length > 0)
      ) {
        failWorkerProcessing(workerId, 'No previewable text was found in the connected inputs.');
        return;
      }

      if (processablePendingFiles.length === 0) {
        commitWorkerOutput(workerId, inputSignature, preservedOutputItems);
        return;
      }

      const batchSettings = AI_WORKER_REQUEST_BATCH_SETTINGS[workerRunMode];
      const pendingBatches = buildAiWorkerRequestBatches(processablePendingFiles, workerRunMode);
      const requestConcurrency = Math.min(
        getAiWorkerRequestConcurrency(workerRunMode),
        pendingBatches.length,
      );
      const requestWaveCount = Math.max(1, Math.ceil(pendingBatches.length / requestConcurrency));
      const clientTimeoutMs = Math.max(
        baseClientTimeoutMs,
        Math.ceil(baseClientTimeoutMs * requestWaveCount * batchSettings.clientTimeoutMultiplier),
      );

      startWorkerProgressLoop(workerId);
      const controller = new AbortController();
      let didTimeout = false;
      workerRequestControllersRef.current[workerId] = controller;
      workerRequestSignaturesRef.current[workerId] = inputSignature;
      workerRequestTimeoutsRef.current[workerId] = window.setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, clientTimeoutMs);

      try {
        const generatedOutputItems: FilePageContentItem[] = [];
        let nextBatchIndex = 0;

        const runBatchWorker = async () => {
          while (nextBatchIndex < pendingBatches.length) {
            const batchIndex = nextBatchIndex;
            nextBatchIndex += 1;
            const batchItems = pendingBatches[batchIndex] ?? [];

            const response = await fetch('/api/worker/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                mode: resolveWorkerMode(worker.workerMode),
                focus: worker.workerFocus ?? DEFAULT_FILE_PAGE_WORKER_FOCUS,
                runMode: workerRunMode,
                outputMode: workerOutputMode,
                workerLabel: worker.label,
                inputs: batchItems.map((item) => ({
                  sourceItemId: item.sourceItemId,
                  label: item.label,
                  description: item.description ?? '',
                  textContent: item.textContent ?? '',
                  mimeType: item.mimeType ?? null,
                })),
              }),
            });

            const payload = await response.json().catch(() => null);

            if (!response.ok) {
              const errMsg =
                typeof payload?.error === 'string' && payload.error.trim().length > 0
                  ? payload.error
                  : 'The AI worker request failed.';
              throw new Error(errMsg);
            }

            const claimedSourceIds = new Set<string>();
            const generatedBatchItems: FilePageContentItem[] = Array.isArray(payload?.files)
              ? payload.files.flatMap((file: unknown, index: number) => {
                  if (
                    typeof file !== 'object' ||
                    file === null ||
                    typeof (file as { contentText?: unknown }).contentText !== 'string'
                  ) {
                    return [];
                  }

                  const contentText = (file as { contentText: string }).contentText.trim();
                  if (contentText.length === 0) return [];

                  const explicitId =
                    typeof (file as { sourceItemId?: unknown }).sourceItemId === 'string'
                      ? (file as { sourceItemId: string }).sourceItemId.trim()
                      : '';
                  const explicitMatch =
                    explicitId.length > 0 && !claimedSourceIds.has(explicitId)
                      ? batchItems.find((item) => item.sourceItemId === explicitId)
                      : undefined;
                  const matchedSource =
                    explicitMatch ??
                    batchItems.find(
                      (item, i) => i === index && !claimedSourceIds.has(item.sourceItemId),
                    ) ??
                    batchItems.find((item) => !claimedSourceIds.has(item.sourceItemId));

                  if (!matchedSource) return [];
                  claimedSourceIds.add(matchedSource.sourceItemId);

                  const descriptionValue =
                    typeof (file as { description?: unknown }).description === 'string'
                      ? (file as { description: string }).description.trim()
                      : '';
                  const existingOutput = existingOutputsBySourceId.get(matchedSource.sourceItemId);
                  const nextVersion =
                    typeof existingOutput?.outputVersion === 'number' &&
                    Number.isFinite(existingOutput.outputVersion)
                      ? Math.max(1, existingOutput.outputVersion) + 1
                      : 1;
                  const generatedAt = new Date().toISOString();

                  return [
                    {
                      id: buildAiOutputItemId(workerId, matchedSource.sourceItemId),
                      kind: 'file' as const,
                      label: buildAiOutputFileLabel(
                        worker.label,
                        matchedSource.label,
                        nextVersion,
                        generatedAt,
                      ),
                      description:
                        descriptionValue ||
                        buildContentSnippet(
                          contentText,
                          `AI-ready output for ${matchedSource.label}.`,
                        ),
                      textContent: contentText,
                      mimeType: 'text/markdown',
                      sizeBytes: contentText.length,
                      sourceItemId: matchedSource.sourceItemId,
                      sourceSignature: matchedSource.sourceSignature,
                      outputVersion: nextVersion,
                      generatedAt,
                    },
                  ];
                })
              : [];

            generatedOutputItems.push(...generatedBatchItems);
          }
        };

        await Promise.all(Array.from({ length: requestConcurrency }, () => runBatchWorker()));

        if (generatedOutputItems.length === 0) {
          throw new Error('The AI worker returned no usable output.');
        }

        commitWorkerOutput(
          workerId,
          inputSignature,
          sortCanvasContentItems([...preservedOutputItems, ...generatedOutputItems]),
        );
      } catch (error) {
        if (controller.signal.aborted && !didTimeout) return;
        failWorkerProcessing(
          workerId,
          didTimeout
            ? `AI worker timed out locally after ${formatTimeoutLabel(clientTimeoutMs)}. Try Fast mode, fewer files, or a smaller source.`
            : error instanceof Error
              ? error.message
              : 'The AI worker request failed.',
        );
      } finally {
        if (workerRequestControllersRef.current[workerId] === controller) {
          delete workerRequestControllersRef.current[workerId];
        }
        clearWorkerRequestTimeout(workerId);
        delete workerRequestSignaturesRef.current[workerId];
      }
    },
    [
      buildWorkerInputSignature,
      buildWorkerSourceSignature,
      clearWorkerRequestTimeout,
      collectWorkerSourceFiles,
      commitWorkerOutput,
      failWorkerProcessing,
      getExistingWorkerOutputFolder,
      getNodeById,
      startWorkerProgressLoop,
    ],
  );

  // ── Worker lifecycle effect ────────────────────────────────────────────────

  useEffect(() => {
    const activeWorkerIds = new Set(
      nodes.filter((n) => n.kind === 'worker').map((n) => n.id),
    );

    // Clean up timers and requests for removed workers
    Object.keys(workerProcessTimersRef.current).forEach((workerId) => {
      if (!activeWorkerIds.has(workerId)) clearWorkerProcessTimer(workerId);
    });
    Object.keys(workerRequestControllersRef.current).forEach((workerId) => {
      if (!activeWorkerIds.has(workerId)) cancelWorkerRequest(workerId);
    });

    nodes.forEach((node) => {
      if (node.kind !== 'worker') return;

      const workerMode = resolveWorkerMode(node.workerMode);
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

      if (workerMode === 'ai-ready') {
        // Cancel stale in-flight request if signature changed
        if (node.workerStatus === 'processing') {
          if (
            workerRequestSignaturesRef.current[node.id] &&
            workerRequestSignaturesRef.current[node.id] !== inputSignature
          ) {
            cancelWorkerRequest(node.id);
            clearWorkerProcessTimer(node.id);
            onUpdateNodeRef.current(node.id, {
              workerStatus: 'idle',
              workerProgress: 0,
              workerLastError: null,
            });
          }
          return;
        }

        // Already complete and up-to-date
        if (
          node.workerStatus === 'complete' &&
          node.workerInputSignature === inputSignature &&
          outputFolderExists
        ) {
          return;
        }

        // AI worker requires manual trigger — do nothing here
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
    runAiWorker,
    cancelWorkerRequest,
    clearWorkerProcessTimer,
    removeWorkerOutputFolder,
    // Connection detection (used in drag handlers)
    buildWorkerInputSignature,
  };
}
