import { memo } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  ExpandIcon,
  PencilLineIcon,
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
import {
  GROUP_CONTENT_INSET_BOTTOM,
  GROUP_CONTENT_INSET_LEFT,
  GROUP_CONTENT_INSET_RIGHT,
  GROUP_CONTENT_INSET_TOP,
  GROUP_HEADER_HEIGHT,
  GROUP_TITLE_UNDERLINE_INSET,
  NODE_CARD_CLASS,
} from './constants';
import { ELEMENT_ICON_META, NODE_META, RESIZE_OPTIONS, ResizeOptionSwatch } from './meta';
import { getNodeBoundsWithSize, getNodeDimensionsForKind } from './utils';
import { cn } from '@/lib/utils';
import type { FilePageElementIcon, FilePageNode } from '@/types/filePage';
import type { Point } from '@/types/geometry';

interface FileCanvasNodeProps {
  draftIcon?: FilePageElementIcon;
  displayPosition: Point;
  displaySize: FilePageNode['size'];
  editingLabel: string;
  folderExpandState?: 'hidden' | 'expand' | 'collapse';
  isContextMenuOpen: boolean;
  isDragging: boolean;
  isEditing: boolean;
  isResizing?: boolean;
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
  onEditingLabelChange: (value: string) => void;
  onCollapseFolder?: (node: FilePageNode) => void;
  onExpandFolder?: (node: FilePageNode) => void;
  onHoverChange: (node: FilePageNode, hovered: boolean) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, node: FilePageNode) => void;
  onPreviewIcon: (node: FilePageNode, icon: FilePageElementIcon) => void;
  onPreviewResize: (node: FilePageNode, size: FilePageNode['size']) => void;
  onResizeHandlePointerDown?: (
    event: ReactPointerEvent<HTMLSpanElement>,
    node: FilePageNode,
    axis: 'x' | 'y' | 'both',
  ) => void;
  onSelect: (nodeId: string) => void;
  showGroupHeader?: boolean;
  onStartRename: (node: FilePageNode) => void;
  onStopRename: () => void;
  canResize: (nodeId: string, size: FilePageNode['size']) => boolean;
}

function FileCanvasNodeComponent({
  draftIcon,
  displayPosition,
  displaySize,
  editingLabel,
  folderExpandState = 'hidden',
  isContextMenuOpen,
  isDragging,
  isEditing,
  isResizing = false,
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
  onEditingLabelChange,
  onCollapseFolder,
  onExpandFolder,
  onHoverChange,
  onPointerDown,
  onPreviewIcon,
  onPreviewResize,
  onResizeHandlePointerDown,
  onSelect,
  showGroupHeader = true,
  onStartRename,
  onStopRename,
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
  const isCompactNode = displaySize.widthUnits === 1;
  const showCompactElementTooltip = node.kind === 'element' && isCompactNode;
  const showNodeLabel = displaySize.widthUnits >= 2;
  const showNodeDescription = displaySize.widthUnits >= 3 && node.description.trim().length > 0;
  const showResizeHandle = isGroupNode && onResizeHandlePointerDown;
  const groupResizeAccentClass =
    isResizing || isSelected ? 'bg-sky-300/80' : 'bg-slate-300/70';
  const groupResizeHandleClass =
    isResizing || isSelected
      ? 'border-sky-300/80 bg-sky-50/95 text-sky-600 shadow-[0_10px_24px_-16px_rgba(14,165,233,0.55)]'
      : 'border-slate-300/80 bg-white/92 text-slate-500 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.22)]';

  const buttonNode = (
    <button
      type="button"
      data-canvas-node="true"
      onPointerDown={(event) => onPointerDown(event, node)}
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
        isGroupNode && 'overflow-hidden',
        isDragging && 'z-40 transition-none',
        isDragging && isGroupNode && 'shadow-[0_24px_52px_-28px_rgba(15,23,42,0.34)]',
        isDragging && !isGroupNode && 'shadow-none',
        !isDragging &&
          'transition-[transform,box-shadow,border-color,opacity,width,height] duration-150',
        snapPreviewPosition && isDragging && 'opacity-94',
        isSelected && 'border-slate-900/25 ring-2 ring-slate-900/8',
        isResizing && 'border-sky-300/85 ring-2 ring-sky-200/80',
      )}
      style={{
        width: dimensions.width,
        height: dimensions.height,
        transform: `translate3d(${displayBounds.left}px, ${displayBounds.top}px, 0)`,
      }}
    >
      {isGroupNode ? (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute bottom-[18px] transition-colors duration-150',
              groupResizeAccentClass,
            )}
            style={{
              left: GROUP_CONTENT_INSET_LEFT,
              right: GROUP_CONTENT_INSET_RIGHT + 22,
              height: 1,
            }}
          />
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute right-[18px] transition-colors duration-150',
              groupResizeAccentClass,
            )}
            style={{
              top: GROUP_CONTENT_INSET_TOP,
              bottom: GROUP_CONTENT_INSET_BOTTOM + 22,
              width: 1,
            }}
          />
          {showGroupHeader ? (
            <div className="relative z-10 h-full">
              <div
                className="absolute left-4 right-4 top-4"
                style={{ height: GROUP_HEADER_HEIGHT - 16 }}
              >
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
                    className="w-full rounded-md border border-slate-200/90 bg-white/90 px-2 py-1 text-sm font-medium text-slate-950 outline-none ring-0"
                  />
                ) : (
                  <div className="truncate text-sm font-medium text-slate-950">{node.label}</div>
                )}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0 h-px bg-slate-300/80"
                  style={{
                    left: GROUP_TITLE_UNDERLINE_INSET,
                    right: GROUP_TITLE_UNDERLINE_INSET,
                  }}
                />
              </div>
            </div>
          ) : null}
          {showResizeHandle ? (
            <>
              <span
                role="presentation"
                onPointerDown={(event) => onResizeHandlePointerDown?.(event, node, 'x')}
                className="absolute inset-y-0 right-0 z-20 w-5 cursor-ew-resize"
              />
              <span
                role="presentation"
                onPointerDown={(event) => onResizeHandlePointerDown?.(event, node, 'y')}
                className="absolute bottom-0 left-0 right-0 z-20 h-5 cursor-ns-resize"
              />
              <span
                role="presentation"
                onPointerDown={(event) => onResizeHandlePointerDown?.(event, node, 'both')}
                className={cn(
                  'absolute bottom-2 right-2 z-30 flex size-7 cursor-nwse-resize items-center justify-center rounded-lg border transition-colors',
                  groupResizeHandleClass,
                )}
              >
                <span className="size-3 rounded-br-[7px] border-b-2 border-r-2 border-current" />
              </span>
            </>
          ) : null}
        </>
      ) : (
        <div
          className={cn(
            'flex h-full items-start justify-between gap-3',
            isCompactNode && 'items-center justify-center p-0',
          )}
        >
          <div
            className={cn(
              'flex items-center gap-2.5',
              isCompactNode && 'h-full w-full items-center justify-center gap-0',
            )}
          >
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white/75',
                isCompactNode && 'size-12 rounded-none border-transparent bg-transparent shadow-none',
              )}
            >
              <Icon
                className={cn(
                  'size-4 text-slate-600',
                  isCompactNode && 'size-7 text-slate-500',
                )}
              />
            </span>
            {!isCompactNode ? (
              <div className="min-w-0">
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
                    className="w-full rounded-md border border-slate-200/90 bg-white/90 px-2 py-1 text-sm font-medium text-slate-950 outline-none ring-0"
                  />
                ) : showNodeLabel ? (
                  <div className="truncate text-sm font-medium text-slate-950">{node.label}</div>
                ) : null}
                {showNodeDescription ? (
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                    {node.description}
                  </div>
                ) : (
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                    {elementMeta?.label ?? meta.eyebrow}
                  </div>
                )}
              </div>
            ) : null}
          </div>
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
          <ContextMenuItem onSelect={() => onStartRename(node)}>
            <PencilLineIcon className="size-4" />
            Rename
          </ContextMenuItem>
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
    previous.folderExpandState !== next.folderExpandState ||
    previous.showGroupHeader !== next.showGroupHeader
  ) {
    return false;
  }

  if ((previous.isEditing || next.isEditing) && previous.editingLabel !== next.editingLabel) {
    return false;
  }

  return true;
}

export const FileCanvasNode = memo(FileCanvasNodeComponent, areFileCanvasNodePropsEqual);
