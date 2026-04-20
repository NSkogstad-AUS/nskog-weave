import { memo } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangleIcon,
  DownloadIcon,
  ExpandIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  PlayIcon,
  SparklesIcon,
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
import { NODE_CARD_CLASS } from './constants';
import { FileCanvasGroupChrome } from './FileCanvasGroupChrome';
import { getGroupFrameStateClassName, type GroupResizeAxis } from './groupChrome';
import { ELEMENT_ICON_META, NODE_META, RESIZE_OPTIONS, ResizeOptionSwatch } from './meta';
import { getNodeBoundsWithSize, getNodeDimensionsForKind } from './utils';
import {
  getWorkerFocusOptions,
  getWorkerModeMeta,
  getWorkerOutputModeMeta,
  getWorkerOutputModeOptions,
  getWorkerRunModeMeta,
  getWorkerRunModeOptions,
  getWorkerStatusMessage,
  resolveWorkerFocus,
  resolveWorkerOutputMode,
  resolveWorkerRunMode,
} from '@/lib/filePageWorkers';
import { cn } from '@/lib/utils';
import type {
  FilePageContentItem,
  FilePageElementIcon,
  FilePageNode,
  FilePageWorkerFocus,
  FilePageWorkerOutputMode,
  FilePageWorkerRunMode,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';

interface FileCanvasNodeProps {
  draftIcon?: FilePageElementIcon;
  displayPosition: Point;
  displaySize: FilePageNode['size'];
  editingLabel: string;
  folderContents?: FilePageContentItem[];
  folderExpandState?: 'hidden' | 'expand' | 'collapse';
  isContextMenuOpen: boolean;
  isDragging: boolean;
  isEditing: boolean;
  isResizing?: boolean;
  isWorkerConnectionTarget?: boolean;
  resizeAxis?: GroupResizeAxis;
  isSelected: boolean;
  node: FilePageNode;
  snapPreviewPosition?: Point;
  onApplyIcon: (node: FilePageNode, icon: FilePageElementIcon) => void;
  onApplyResize: (node: FilePageNode, size: FilePageNode['size']) => void;
  onClearIconPreview: (nodeId?: string) => void;
  onClearSizePreview: (nodeId?: string) => void;
  onCommitRename: (node: FilePageNode) => void;
  onContextMenu: (node: FilePageNode) => void;
  onContextMenuOpenChange: (node: FilePageNode, open: boolean) => void;
  onDelete: (node: FilePageNode) => void;
  onDownload?: (node: FilePageNode) => void;
  onEditingLabelChange: (value: string) => void;
  onChangeWorkerFocus?: (node: FilePageNode, focus: FilePageWorkerFocus) => void;
  onChangeWorkerRunMode?: (node: FilePageNode, runMode: FilePageWorkerRunMode) => void;
  onChangeWorkerOutputMode?: (node: FilePageNode, outputMode: FilePageWorkerOutputMode) => void;
  onCollapseFolder?: (node: FilePageNode) => void;
  onExpandFolder?: (node: FilePageNode) => void;
  onHoverChange: (node: FilePageNode, hovered: boolean) => void;
  onOpenPreview?: (node: FilePageNode) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, node: FilePageNode) => void;
  onPreviewIcon: (node: FilePageNode, icon: FilePageElementIcon) => void;
  onPreviewResize: (node: FilePageNode, size: FilePageNode['size']) => void;
  onResizeHandlePointerDown?: (
    event: ReactPointerEvent<HTMLSpanElement>,
    node: FilePageNode,
    axis: GroupResizeAxis,
  ) => void;
  onRunWorker?: (node: FilePageNode) => void;
  onSelectFolderContentItem?: (item: FilePageContentItem) => void;
  onSelect: (nodeId: string) => void;
  onStartRename: (node: FilePageNode) => void;
  onStopRename: () => void;
  onWorkerInputHandlePointerDown?: (
    event: ReactPointerEvent<HTMLSpanElement>,
    node: FilePageNode,
  ) => void;
  canResize: (nodeId: string, size: FilePageNode['size']) => boolean;
}

function FileCanvasNodeComponent({
  draftIcon,
  displayPosition,
  displaySize,
  editingLabel,
  folderContents = [],
  folderExpandState = 'hidden',
  isContextMenuOpen,
  isDragging,
  isEditing,
  isResizing = false,
  isWorkerConnectionTarget = false,
  resizeAxis,
  isSelected,
  node,
  snapPreviewPosition,
  onApplyIcon,
  onApplyResize,
  onClearIconPreview,
  onClearSizePreview,
  onCommitRename,
  onContextMenu,
  onContextMenuOpenChange,
  onDelete,
  onDownload,
  onEditingLabelChange,
  onChangeWorkerFocus,
  onChangeWorkerRunMode,
  onChangeWorkerOutputMode,
  onCollapseFolder,
  onExpandFolder,
  onHoverChange,
  onOpenPreview,
  onPointerDown,
  onPreviewIcon,
  onPreviewResize,
  onResizeHandlePointerDown,
  onRunWorker,
  onSelectFolderContentItem,
  onSelect,
  onStartRename,
  onStopRename,
  onWorkerInputHandlePointerDown,
  canResize,
}: FileCanvasNodeProps) {
  const meta = NODE_META[node.kind];
  const elementIcon = draftIcon ?? node.icon;
  const elementMeta = node.kind === 'element' ? ELEMENT_ICON_META[elementIcon] : null;
  const Icon = elementMeta?.icon ?? meta.icon;
  const dimensions = getNodeDimensionsForKind(displaySize, node.kind);
  const displayBounds = getNodeBoundsWithSize(displayPosition, displaySize, node.kind);
  const snapPreviewBounds = snapPreviewPosition
    ? getNodeBoundsWithSize(snapPreviewPosition, displaySize, node.kind)
    : null;
  const isGroupNode = node.kind === 'group';
  const isFolderNode = node.kind === 'folder';
  const isWorkerNode = node.kind === 'worker';
  const isFilesystemNode = node.kind === 'folder' || node.kind === 'file';
  const canEdgeResize = node.kind === 'file' || node.kind === 'folder' || node.kind === 'worker';
  const isCompactNode = displaySize.widthUnits === 1;
  const canShowFolderSection =
    isFolderNode && displaySize.widthUnits >= 3 && folderContents.length > 0;
  const showFolderContents = canShowFolderSection && displaySize.heightUnits >= 2;
  const visibleFolderContents = showFolderContents ? folderContents : [];
  const folderItemCountLabel = `${folderContents.length} item${folderContents.length === 1 ? '' : 's'}`;
  const folderFileCount = folderContents.filter((childNode) => childNode.kind === 'file').length;
  const folderSubfolderCount = folderContents.filter((childNode) => childNode.kind === 'folder').length;
  const folderMetricTokens = [
    folderFileCount > 0 ? `${folderFileCount} file${folderFileCount === 1 ? '' : 's'}` : null,
    folderSubfolderCount > 0
      ? `${folderSubfolderCount} folder${folderSubfolderCount === 1 ? '' : 's'}`
      : null,
  ].filter((token): token is string => Boolean(token));
  const folderSummaryText =
    folderContents.length === 0
      ? 'Empty folder'
      : folderMetricTokens.length > 0
        ? folderMetricTokens.join(' · ')
        : folderItemCountLabel;
  const showCompactElementTooltip = node.kind === 'element' && isCompactNode;
  const showNodeLabel = displaySize.widthUnits >= 2;
  const nodeClassName = isGroupNode ? getGroupFrameStateClassName({ isSelected, isResizing }) : '';
  const secondaryText = isFolderNode
    ? folderSummaryText
    : isWorkerNode
      ? null
    : displaySize.widthUnits >= 3 && node.description.trim().length > 0
      ? node.description.trim()
      : node.kind === 'element'
        ? (elementMeta?.label ?? null)
        : null;
  const workerInputCount = folderContents.length;
  const workerModeMeta = getWorkerModeMeta(node.workerMode);
  const workerFocus = resolveWorkerFocus(node.workerFocus);
  const workerFocusOptions = getWorkerFocusOptions();
  const workerRunMode = resolveWorkerRunMode(node.workerRunMode);
  const workerRunModeMeta = getWorkerRunModeMeta(workerRunMode);
  const workerRunModeOptions = getWorkerRunModeOptions();
  const workerOutputMode = resolveWorkerOutputMode(node.workerOutputMode);
  const workerOutputModeMeta = getWorkerOutputModeMeta(workerOutputMode);
  const workerOutputModeOptions = getWorkerOutputModeOptions();
  const workerStatus = node.workerStatus ?? 'idle';
  const workerProgress = node.workerProgress ?? 0;
  const workerStatusMessage = getWorkerStatusMessage(
    node.workerMode,
    workerStatus,
    workerProgress,
    node.workerLastError ?? null,
  );
  const canRunWorker = isWorkerNode && workerInputCount > 0 && workerStatus !== 'processing';
  const elementIconToneClassName =
    elementIcon === 'lightbulb'
      ? 'border-amber-200/80 bg-amber-50/85 text-amber-600'
      : elementIcon === 'message-square'
        ? 'border-sky-200/80 bg-sky-50/85 text-sky-600'
        : elementIcon === 'target'
          ? 'border-rose-200/80 bg-rose-50/85 text-rose-600'
          : elementIcon === 'shapes'
            ? 'border-violet-200/80 bg-violet-50/85 text-violet-600'
            : 'border-emerald-200/80 bg-emerald-50/85 text-emerald-600';

  const buttonNode = (
    <button
      type="button"
      data-canvas-node="true"
      onPointerDown={(event) => onPointerDown(event, node)}
      onClick={(event) => {
        if (!onOpenPreview || isDragging || (node.kind !== 'file' && node.kind !== 'folder')) {
          return;
        }

        event.stopPropagation();
        onOpenPreview(node);
      }}
      onPointerEnter={() => onHoverChange(node, true)}
      onPointerLeave={() => {
        if (!isContextMenuOpen) {
          onHoverChange(node, false);
        }
      }}
      onContextMenu={(event) => {
        event.stopPropagation();
        onContextMenu(node);
        onSelect(node.id);
      }}
      className={cn(
        NODE_CARD_CLASS,
        'cursor-grab shadow-[0_18px_40px_-30px_rgba(15,23,42,0.28)] active:cursor-grabbing will-change-transform',
        meta.className,
        nodeClassName,
        isGroupNode && 'overflow-hidden',
        isDragging && 'z-40 transition-none',
        isDragging && isGroupNode && 'shadow-[0_24px_52px_-28px_rgba(15,23,42,0.34)]',
        isDragging && !isGroupNode && 'shadow-none',
        !isDragging &&
          'transition-[transform,box-shadow,border-color,opacity,width,height] duration-150',
        isWorkerConnectionTarget &&
          'border-slate-300/95 shadow-[0_0_0_4px_rgba(148,163,184,0.1),0_18px_40px_-30px_rgba(15,23,42,0.28)]',
        snapPreviewPosition && isDragging && 'opacity-94',
      )}
      style={{
        width: dimensions.width,
        height: dimensions.height,
        transform: `translate3d(${displayBounds.left}px, ${displayBounds.top}px, 0)`,
      }}
    >
      {isWorkerNode && onWorkerInputHandlePointerDown ? (
        <span
          role="presentation"
          onPointerDown={(event) => onWorkerInputHandlePointerDown(event, node)}
          className="absolute -left-4 top-1/2 z-40 flex h-8 w-8 -translate-y-1/2 items-center justify-center cursor-crosshair"
        >
          <span className="flex size-4 items-center justify-center rounded-full border border-slate-300/90 bg-white shadow-[0_10px_22px_-16px_rgba(15,23,42,0.4)]">
            <span className="size-1.5 rounded-full bg-slate-400" />
          </span>
        </span>
      ) : null}
      {canEdgeResize && onResizeHandlePointerDown ? (
        <>
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'top-left')}
            className="absolute left-0 top-0 z-30 size-5 cursor-nwse-resize"
          />
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'left')}
            className="absolute inset-y-3 left-0 z-20 w-4 cursor-ew-resize"
          />
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'right')}
            className="absolute inset-y-3 right-0 z-20 w-4 cursor-ew-resize"
          />
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'top')}
            className="absolute inset-x-3 top-0 z-20 h-4 cursor-ns-resize"
          />
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'bottom')}
            className="absolute inset-x-3 bottom-0 z-20 h-4 cursor-ns-resize"
          />
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'bottom-right')}
            className="absolute bottom-0 right-0 z-30 size-5 cursor-nwse-resize"
          />
        </>
      ) : null}
      {isGroupNode ? (
        <FileCanvasGroupChrome
          editingLabel={editingLabel}
          isEditing={isEditing}
          isResizing={isResizing}
          resizeAxis={resizeAxis}
          isSelected={isSelected}
          node={node}
          onCommitRename={onCommitRename}
          onEditingLabelChange={onEditingLabelChange}
          onResizeHandlePointerDown={onResizeHandlePointerDown}
          onStopRename={onStopRename}
        />
      ) : (
        <div
          className={cn(
            'flex h-full flex-col',
            isCompactNode ? 'items-center justify-center p-0' : 'gap-3.5',
          )}
        >
          {isCompactNode ? (
            <span
              className={cn(
                'flex size-12 items-center justify-center',
                node.kind === 'element' &&
                  'rounded-[18px] border shadow-[0_10px_24px_-20px_rgba(15,23,42,0.16)]',
                node.kind === 'element' && elementIconToneClassName,
                isWorkerNode &&
                  'rounded-[18px] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,248,252,0.94))] text-slate-600 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.12)]',
              )}
            >
                  <Icon
                    className={cn(
                      'size-7',
                      isFilesystemNode ? 'text-slate-500 dark:text-white' : 'text-current',
                    )}
                  />
            </span>
          ) : (
            <>
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={cn(
                    'mt-0.5 flex shrink-0 items-center justify-center',
                    isFilesystemNode
                      ? 'size-5 text-slate-500 dark:text-white'
                      : isWorkerNode
                        ? 'size-10 rounded-[20px] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(246,248,252,0.94))] text-slate-600 shadow-[0_12px_26px_-24px_rgba(15,23,42,0.22)] dark:border-slate-600/40 dark:bg-slate-800/80 dark:text-white'
                      : 'size-9 rounded-2xl border shadow-[0_10px_24px_-22px_rgba(15,23,42,0.14)]',
                    node.kind === 'element' && elementIconToneClassName,
                  )}
                >
                  <Icon
                    className={cn(
                      'size-5',
                      isFilesystemNode ? 'text-slate-500 dark:text-white' : 'text-current',
                    )}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingLabel}
                      onChange={(event) => onEditingLabelChange(event.target.value)}
                      onBlur={() => onCommitRename(node)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          onCommitRename(node);
                        }
                        if (event.key === 'Escape') {
                          onStopRename();
                        }
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                      className="w-full rounded-xl border border-slate-200/90 bg-white/94 px-2.5 py-1.5 text-sm font-semibold text-slate-950 outline-none ring-0 dark:border-slate-600/40 dark:bg-slate-800/80 dark:text-white"
                    />
                  ) : showNodeLabel ? (
                    <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-slate-950 dark:text-white">
                      {node.label}
                    </div>
                  ) : null}

                  {secondaryText ? (
                    <div className="mt-1 text-[12px] leading-5 text-slate-500 dark:text-white">
                      {secondaryText}
                    </div>
                  ) : null}
                </div>
              </div>

              {isWorkerNode ? (
                <div className="space-y-2.5 border-t border-slate-200/75 pt-3.5 dark:border-slate-600/35">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-500 dark:text-white">
                    <span className="flex items-center gap-2">
                      {workerStatus === 'processing' ? (
                        <LoaderCircleIcon className="size-3.5 animate-spin text-slate-500 dark:text-white" />
                      ) : workerStatus === 'error' ? (
                        <AlertTriangleIcon className="size-3.5 text-rose-500" />
                      ) : workerStatus === 'complete' ? (
                        <SparklesIcon className="size-3.5 text-slate-500 dark:text-white" />
                      ) : (
                        <span className="size-2 rounded-full bg-slate-300" />
                      )}
                      <span>{workerStatusMessage}</span>
                    </span>
                    <span className="shrink-0 text-slate-400 dark:text-white">{workerModeMeta.badgeLabel}</span>
                  </div>
                  {node.workerMode === 'ai-ready' && onChangeWorkerFocus ? (
                    <div className="grid gap-2">
                      <label className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white">
                        <span className="shrink-0">Focus</span>
                        <select
                          value={workerFocus}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          onChange={(event) =>
                            onChangeWorkerFocus(node, event.target.value as FilePageWorkerFocus)
                          }
                          className="min-w-0 flex-1 rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1 text-[11px] font-medium text-slate-600 outline-none dark:border-slate-600/40 dark:bg-slate-800/80 dark:text-white"
                        >
                          {workerFocusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {onChangeWorkerRunMode ? (
                        <label className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white">
                          <span className="shrink-0">Mode</span>
                          <select
                            value={workerRunMode}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            onChange={(event) =>
                              onChangeWorkerRunMode(node, event.target.value as FilePageWorkerRunMode)
                            }
                            className="min-w-0 flex-1 rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1 text-[11px] font-medium text-slate-600 outline-none dark:border-slate-600/40 dark:bg-slate-800/80 dark:text-white"
                          >
                            {workerRunModeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {onChangeWorkerOutputMode ? (
                        <label className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white">
                          <span className="shrink-0">Output</span>
                          <select
                            value={workerOutputMode}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            onChange={(event) =>
                              onChangeWorkerOutputMode(node, event.target.value as FilePageWorkerOutputMode)
                            }
                            className="min-w-0 flex-1 rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1 text-[11px] font-medium text-slate-600 outline-none dark:border-slate-600/40 dark:bg-slate-800/80 dark:text-white"
                          >
                            {workerOutputModeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  {onRunWorker ? (
                    <button
                      type="button"
                      disabled={!canRunWorker}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRunWorker(node);
                      }}
                      className={cn(
                        'flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border text-[11px] font-semibold transition-colors',
                        canRunWorker
                          ? 'border-slate-200/90 bg-slate-900 text-white hover:bg-slate-800'
                          : 'border-slate-200/80 bg-slate-100 text-slate-400 dark:border-slate-600/35 dark:bg-slate-800/60 dark:text-white',
                      )}
                    >
                      <PlayIcon className="size-3.5" />
                      <span>{workerStatus === 'processing' ? 'Running...' : workerModeMeta.runActionLabel}</span>
                    </button>
                  ) : null}
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width,background-color] duration-300',
                        workerStatus === 'error'
                          ? 'bg-rose-500/65'
                          : workerStatus === 'complete'
                            ? 'bg-slate-900/70'
                            : 'bg-slate-500/55',
                      )}
                      style={{
                        width: `${workerStatus === 'processing'
                          ? Math.max(8, Math.min(100, workerProgress))
                          : workerStatus === 'complete'
                            ? 100
                            : workerStatus === 'error'
                              ? 100
                            : 8}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[11px] text-slate-400 dark:text-white">
                    <span>{workerInputCount} input{workerInputCount === 1 ? '' : 's'}</span>
                    <span>
                      {node.workerMode === 'ai-ready'
                        ? `${workerRunModeMeta.shortLabel} · ${workerRunModeMeta.timeoutLabel} · ${workerOutputModeMeta.shortLabel}`
                        : workerModeMeta.outputPlacementMessage}
                    </span>
                  </div>
                </div>
              ) : null}

              {canShowFolderSection && showFolderContents ? (
                <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200/75 pt-4 dark:border-slate-600/35">
                  <div className="mb-2 text-[11px] font-medium text-slate-400 dark:text-white">Contents</div>
                  <div className="min-h-0 overflow-y-auto pr-1">
                    {visibleFolderContents.map((childNode) => {
                      const ChildIcon = NODE_META[childNode.kind].icon;

                      return (
                        <div
                          key={childNode.id}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onSelectFolderContentItem?.(childNode);
                          }}
                          className={cn(
                            'flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/25',
                            childNode.id !== visibleFolderContents.at(-1)?.id &&
                              'border-b border-slate-100 dark:border-slate-700/35',
                          )}
                        >
                          <span className="flex size-4 shrink-0 items-center justify-center">
                            <ChildIcon className="size-3.5 text-slate-400 dark:text-white" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-medium text-slate-600 dark:text-white">
                              {childNode.label}
                            </span>
                            {childNode.description ? (
                              <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-slate-400 dark:text-white">
                                {childNode.description}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </button>
  );

  return (
    <ContextMenu
      onOpenChange={(open) => {
        onContextMenuOpenChange(node, open);

        if (!open) {
          onClearSizePreview(node.id);
          onClearIconPreview(node.id);
        }
      }}
    >
      <>
        {isDragging && snapPreviewBounds ? (
          <div
            aria-hidden="true"
            className={cn(
              NODE_CARD_CLASS,
              'pointer-events-none border-sky-300/70 bg-sky-100/40 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.15)] transition-[transform,opacity] duration-150 ease-out',
            )}
            style={{
              width: dimensions.width,
              height: dimensions.height,
              transform: `translate3d(${snapPreviewBounds.left}px, ${snapPreviewBounds.top}px, 0)`,
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
          {(node.kind === 'file' || node.kind === 'folder') && onDownload ? (
            <ContextMenuItem onSelect={() => onDownload(node)}>
              <DownloadIcon className="size-4" />
              Download
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onSelect={() => onStartRename(node)}>
            <PencilLineIcon className="size-4" />
            Rename
          </ContextMenuItem>
          {isWorkerNode && onRunWorker ? (
            <ContextMenuItem disabled={!canRunWorker} onSelect={() => onRunWorker(node)}>
              <PlayIcon className="size-4" />
              {workerStatus === 'processing' ? 'Running...' : workerModeMeta.runActionLabel}
            </ContextMenuItem>
          ) : null}
          {isWorkerNode && node.workerMode === 'ai-ready' && onChangeWorkerFocus ? (
            <>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <SparklesIcon className="size-4" />
                  Focus
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-44">
                  {workerFocusOptions.map((option) => (
                    <ContextMenuItem
                      key={option.value}
                      onSelect={() => onChangeWorkerFocus(node, option.value)}
                      className={cn(option.value === workerFocus && 'bg-sidebar-accent/55')}
                    >
                      {option.label}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              {onChangeWorkerRunMode ? (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>Mode</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-44">
                    {workerRunModeOptions.map((option) => (
                      <ContextMenuItem
                        key={option.value}
                        onSelect={() => onChangeWorkerRunMode(node, option.value)}
                        className={cn(option.value === workerRunMode && 'bg-sidebar-accent/55')}
                      >
                        {option.label}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : null}
              {onChangeWorkerOutputMode ? (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>Output</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-52">
                    {workerOutputModeOptions.map((option) => (
                      <ContextMenuItem
                        key={option.value}
                        onSelect={() => onChangeWorkerOutputMode(node, option.value)}
                        className={cn(option.value === workerOutputMode && 'bg-sidebar-accent/55')}
                      >
                        {option.label}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : null}
            </>
          ) : null}
          {folderExpandState === 'expand' && onExpandFolder ? (
            <ContextMenuItem onSelect={() => onExpandFolder(node)}>
              <ExpandIcon className="size-4" />
              Expand folder
            </ContextMenuItem>
          ) : null}
          {folderExpandState === 'collapse' && onCollapseFolder ? (
            <ContextMenuItem onSelect={() => onCollapseFolder(node)}>
              <ExpandIcon className="size-4" />
              Collapse folder
            </ContextMenuItem>
          ) : null}
          {node.kind === 'element' ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Icon className="size-4" />
                Change icon
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48" onPointerLeave={() => onClearIconPreview(node.id)}>
                <div className="grid grid-cols-2 gap-1.5 p-1">
                  {Object.entries(ELEMENT_ICON_META).map(([iconKey, iconMeta]) => {
                    const IconOption = iconMeta.icon;

                    return (
                      <ContextMenuItem
                        key={iconKey}
                        onFocus={() => onPreviewIcon(node, iconKey as FilePageElementIcon)}
                        onPointerEnter={() => onPreviewIcon(node, iconKey as FilePageElementIcon)}
                        onSelect={() => onApplyIcon(node, iconKey as FilePageElementIcon)}
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
          {node.kind !== 'group' ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <ExpandIcon className="size-4" />
                Resize
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-[15rem]" onPointerLeave={() => onClearSizePreview(node.id)}>
                <div className="grid grid-cols-3 gap-1.5 p-1">
                  {RESIZE_OPTIONS.map((size) => {
                    const isAvailable = canResize(node.id, size);
                    const isCurrent =
                      node.size.widthUnits === size.widthUnits &&
                      node.size.heightUnits === size.heightUnits;

                    return (
                      <ContextMenuItem
                        key={`${size.widthUnits}x${size.heightUnits}`}
                        disabled={!isAvailable}
                        onFocus={() => onPreviewResize(node, size)}
                        onPointerEnter={() => onPreviewResize(node, size)}
                        onSelect={() => onApplyResize(node, size)}
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
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(node)}>
            <Trash2Icon className="size-4" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </>
    </ContextMenu>
  );
}

function arePointsEqual(left?: Point, right?: Point) {
  return left?.x === right?.x && left?.y === right?.y;
}

function areSizesEqual(
  left: FilePageNode['size'],
  right: FilePageNode['size'],
) {
  return left.widthUnits === right.widthUnits && left.heightUnits === right.heightUnits;
}

function areFileCanvasNodePropsEqual(
  previous: FileCanvasNodeProps,
  next: FileCanvasNodeProps,
) {
  if (previous.node !== next.node) {
    return false;
  }

  if (previous.draftIcon !== next.draftIcon) {
    return false;
  }

  if (!arePointsEqual(previous.displayPosition, next.displayPosition)) {
    return false;
  }

  if (!arePointsEqual(previous.snapPreviewPosition, next.snapPreviewPosition)) {
    return false;
  }

  if (!areSizesEqual(previous.displaySize, next.displaySize)) {
    return false;
  }

  if (
    previous.isContextMenuOpen !== next.isContextMenuOpen ||
    previous.isDragging !== next.isDragging ||
    previous.isEditing !== next.isEditing ||
    previous.isResizing !== next.isResizing ||
    previous.isSelected !== next.isSelected ||
    previous.folderExpandState !== next.folderExpandState
  ) {
    return false;
  }

  if ((previous.isEditing || next.isEditing) && previous.editingLabel !== next.editingLabel) {
    return false;
  }

  if (previous.folderContents?.length !== next.folderContents?.length) {
    return false;
  }

  if (
    previous.folderContents?.some((entry, index) => {
      const nextEntry = next.folderContents?.[index];

      return (
        !nextEntry ||
        entry.id !== nextEntry.id ||
        entry.kind !== nextEntry.kind ||
        entry.label !== nextEntry.label ||
        entry.description !== nextEntry.description
      );
    })
  ) {
    return false;
  }

  return true;
}

export const FileCanvasNode = memo(FileCanvasNodeComponent, areFileCanvasNodePropsEqual);
