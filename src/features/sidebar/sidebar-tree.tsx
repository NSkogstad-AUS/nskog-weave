import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDownIcon,
  DownloadIcon,
  FilePlus2Icon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  GripVerticalIcon,
  MinusIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react';
import { motion, useMotionValue, useSpring } from 'motion/react';

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@/components/animate-ui/components/radix/sidebar';
import {
  folderHasContents,
  getFolderDescendantCounts,
  getOrderedWorkspaceFolderItems,
  type OrderedWorkspaceFolderItem,
  type WorkspaceFolderOrderEntry,
  type WorkspaceFile,
  type WorkspaceFolder,
  type WorkspaceSeparator,
} from '@/data/sidebarNavigation';
import { cn } from '@/lib/utils';

export type ActiveItem =
  | { type: 'folder'; id: string }
  | { type: 'file'; id: string }
  | null;

export type SidebarSelectableItem = Exclude<ActiveItem, null>;

export type EditingItem =
  | { type: 'folder'; id: string; value: string }
  | { type: 'file'; id: string; value: string }
  | null;

type DraggedSeparator = {
  item: WorkspaceFolderOrderEntry;
  parentFolderId: string | null;
};

type SeparatorDropTarget = {
  parentFolderId: string | null;
  index: number;
};

type PreviewOrderedItem =
  | {
      type: 'item';
      item: OrderedWorkspaceFolderItem;
      sourceIndex: number;
    }
  | {
      type: 'placeholder';
      key: string;
      target: SeparatorDropTarget;
    };

type PreviewRootFolder =
  | {
      type: 'folder';
      folder: WorkspaceFolder;
      sourceIndex: number;
    }
  | {
      type: 'placeholder';
      key: string;
      target: SeparatorDropTarget;
    };

const SIDEBAR_HIGHLIGHT_CLASS =
  'bg-sidebar-accent/30 text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgba(71,85,105,0.55)]';
const SIDEBAR_SELECTED_CLASS =
  'bg-sidebar-accent/45 text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgba(71,85,105,0.55)]';
const SIDEBAR_ROW_INSET_CLASS = 'mx-px w-[calc(100%-2px)]';
const SIDEBAR_CONTEXT_MENU_CLASS =
  'fixed z-50 overflow-hidden rounded-md border border-sidebar-border/80 bg-background/98 p-1 text-popover-foreground shadow-[0_18px_40px_-22px_rgba(15,23,42,0.35)]';
const SIDEBAR_CONTEXT_MENU_ITEM_CLASS =
  'flex min-h-8 w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-sidebar-accent/75 focus:bg-sidebar-accent/75 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';
const SIDEBAR_CONTEXT_MENU_LABEL_CLASS =
  'px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground';

type MenuPosition = { x: number; y: number };

export function getSidebarItemKey(item: ActiveItem) {
  return item ? `${item.type}:${item.id}` : '';
}

export function areSidebarItemsEqual(left: ActiveItem, right: ActiveItem) {
  return getSidebarItemKey(left) === getSidebarItemKey(right);
}

function formatCountLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function queueAfterMenuClose(callback: () => void) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

function useFixedContextMenu() {
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (!position) return;

    const close = () => setPosition(null);
    const closeOnPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-sidebar-context-menu="true"]')) {
        return;
      }
      close();
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnKeyDown);
    window.addEventListener('blur', close);

    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnKeyDown);
      window.removeEventListener('blur', close);
    };
  }, [position]);

  return {
    close: () => setPosition(null),
    open: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setPosition({ x: event.clientX, y: event.clientY });
    },
    position,
  };
}

function SidebarContextMenu({
  children,
  className,
  onClose,
  position,
}: {
  children: ReactNode;
  className?: string;
  onClose: () => void;
  position: MenuPosition | null;
}) {
  if (!position) return null;

  return createPortal(
    <div
      data-sidebar-context-menu="true"
      role="menu"
      className={cn(SIDEBAR_CONTEXT_MENU_CLASS, className)}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onClick={onClose}
    >
      {children}
    </div>,
    document.body,
  );
}

function SidebarContextMenuLabel({ children }: { children: ReactNode }) {
  return <div className={SIDEBAR_CONTEXT_MENU_LABEL_CLASS}>{children}</div>;
}

function SidebarContextMenuSeparator() {
  return <div className="-mx-1 my-1 h-px bg-border" />;
}

function getRowPaddingLeft(level: number) {
  return level === 0 ? 10 : 14;
}

function getDropTargetKey(dropTarget: SeparatorDropTarget | null) {
  return dropTarget ? `${dropTarget.parentFolderId ?? 'root'}:${dropTarget.index}` : '';
}

function setTransparentDragImage(dataTransfer: DataTransfer) {
  const dragImage = document.createElement('div');
  dragImage.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(dragImage);
  dataTransfer.setDragImage(dragImage, 0, 0);
  window.requestAnimationFrame(() => dragImage.remove());
}

function getDropRatio(event: ReactDragEvent<HTMLElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();

  if (bounds.height <= 0) {
    return 0.5;
  }

  return (event.clientY - bounds.top) / bounds.height;
}

function getOrderedItemKey(item: OrderedWorkspaceFolderItem) {
  if (item.type === 'folder') {
    return `folder:${item.folder.id}`;
  }

  if (item.type === 'file') {
    return `file:${item.file.id}`;
  }

  return `separator:${item.separator.id}`;
}

function getOrderEntryKey(entry: WorkspaceFolderOrderEntry) {
  return `${entry.type}:${entry.id}`;
}

function getDropPlaceholderKey(dropTarget: SeparatorDropTarget) {
  return `drop-placeholder:${getDropTargetKey(dropTarget)}`;
}

function orderedItemMatchesEntry(
  item: OrderedWorkspaceFolderItem,
  entry: WorkspaceFolderOrderEntry,
) {
  return getOrderedItemKey(item) === getOrderEntryKey(entry);
}

function insertOrderedItemAt<T>(
  items: T[],
  index: number,
  item: T,
) {
  const nextItems = [...items];
  const targetIndex = Math.max(0, Math.min(index, nextItems.length));

  nextItems.splice(targetIndex, 0, item);
  return nextItems;
}

function insertFolderAt<T>(
  folders: T[],
  index: number,
  folder: T,
) {
  const nextFolders = [...folders];
  const targetIndex = Math.max(0, Math.min(index, nextFolders.length));

  nextFolders.splice(targetIndex, 0, folder);
  return nextFolders;
}

function findOrderedItemByEntry(
  folders: WorkspaceFolder[],
  entry: WorkspaceFolderOrderEntry,
): OrderedWorkspaceFolderItem | null {
  for (const folder of folders) {
    if (entry.type === 'folder' && folder.id === entry.id) {
      return {
        type: 'folder',
        folder,
      };
    }

    const directMatch = getOrderedWorkspaceFolderItems(folder).find((item) =>
      orderedItemMatchesEntry(item, entry),
    );

    if (directMatch) {
      return directMatch;
    }

    const nestedMatch = findOrderedItemByEntry(folder.children, entry);

    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
}

function getPreviewOrderedItems(
  folder: WorkspaceFolder,
  draggingItem: DraggedSeparator | null,
  activeDropTarget: SeparatorDropTarget | null,
  draggedOrderedItem: OrderedWorkspaceFolderItem | null,
): PreviewOrderedItem[] {
  const orderedItems = getOrderedWorkspaceFolderItems(folder);
  const previewItems: PreviewOrderedItem[] = orderedItems.map((item, sourceIndex) => ({
    type: 'item',
    item,
    sourceIndex,
  }) satisfies PreviewOrderedItem);

  if (!draggingItem || !activeDropTarget || !draggedOrderedItem) {
    return previewItems;
  }

  const sourceIndex = orderedItems.findIndex((item) =>
    orderedItemMatchesEntry(item, draggingItem.item),
  );
  const removesFromFolder =
    draggingItem.parentFolderId === folder.id || activeDropTarget.parentFolderId === folder.id;

  if (!removesFromFolder) {
    return previewItems;
  }

  const withoutDraggedItem: PreviewOrderedItem[] = previewItems.filter(
    (previewItem) =>
      previewItem.type !== 'item' ||
      !orderedItemMatchesEntry(previewItem.item, draggingItem.item),
  );

  if (activeDropTarget.parentFolderId !== folder.id) {
    return withoutDraggedItem;
  }

  const targetIndex =
    draggingItem.parentFolderId === folder.id &&
    sourceIndex >= 0 &&
    activeDropTarget.index > sourceIndex
      ? activeDropTarget.index - 1
      : activeDropTarget.index;

  return insertOrderedItemAt(withoutDraggedItem, targetIndex, {
    type: 'placeholder',
    key: getDropPlaceholderKey(activeDropTarget),
    target: activeDropTarget,
  });
}

function getPreviewRootFolders(
  folders: WorkspaceFolder[],
  draggingItem: DraggedSeparator | null,
  activeDropTarget: SeparatorDropTarget | null,
  draggedOrderedItem: OrderedWorkspaceFolderItem | null,
): PreviewRootFolder[] {
  const previewFolders: PreviewRootFolder[] = folders.map((folder, sourceIndex) => ({
    type: 'folder',
    folder,
    sourceIndex,
  }) satisfies PreviewRootFolder);

  if (!draggingItem || draggingItem.item.type !== 'folder' || !activeDropTarget) {
    return previewFolders;
  }

  const draggedFolder =
    draggedOrderedItem?.type === 'folder' ? draggedOrderedItem.folder : null;
  const sourceIndex = folders.findIndex((folder) => folder.id === draggingItem.item.id);
  const removesFromRoot =
    draggingItem.parentFolderId === null || activeDropTarget.parentFolderId === null;

  if (!removesFromRoot) {
    return previewFolders;
  }

  const withoutDraggedFolder: PreviewRootFolder[] = previewFolders.filter(
    (previewFolder) =>
      previewFolder.type !== 'folder' || previewFolder.folder.id !== draggingItem.item.id,
  );

  if (activeDropTarget.parentFolderId !== null || !draggedFolder) {
    return withoutDraggedFolder;
  }

  const targetIndex =
    draggingItem.parentFolderId === null &&
    sourceIndex >= 0 &&
    activeDropTarget.index > sourceIndex
      ? activeDropTarget.index - 1
      : activeDropTarget.index;

  return insertFolderAt(withoutDraggedFolder, targetIndex, {
    type: 'placeholder',
    key: getDropPlaceholderKey(activeDropTarget),
    target: activeDropTarget,
  });
}

function collectVisibleSidebarItemsFromFolder(
  folder: WorkspaceFolder,
  expandedFolderIds: Set<string>,
  searchActive: boolean,
): SidebarSelectableItem[] {
  const items: SidebarSelectableItem[] = [{ type: 'folder', id: folder.id }];
  const isExpanded = searchActive || expandedFolderIds.has(folder.id);

  if (!isExpanded) {
    return items;
  }

  getOrderedWorkspaceFolderItems(folder).forEach((item) => {
    if (item.type === 'folder') {
      items.push(
        ...collectVisibleSidebarItemsFromFolder(item.folder, expandedFolderIds, searchActive),
      );
      return;
    }

    if (item.type === 'file') {
      items.push({ type: 'file', id: item.file.id });
    }
  });

  return items;
}

export function collectVisibleSidebarItems(
  folders: WorkspaceFolder[],
  expandedFolderIds: Set<string>,
  searchActive: boolean,
): SidebarSelectableItem[] {
  return folders.flatMap((folder) =>
    collectVisibleSidebarItemsFromFolder(folder, expandedFolderIds, searchActive),
  );
}

function TreeElbow({ level }: { level: number }) {
  if (level === 0) {
    return null;
  }

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-[-8px] top-0 z-20 h-4 w-4 rounded-bl-[10px] border-b border-l border-sidebar-border/80"
    />
  );
}

function EditingRow({
  value,
  onCancel,
  onChange,
  onCommit,
}: {
  value: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      onBlur={onCommit}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit();
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    />
  );
}

function SeparatorDropZone({
  active,
  visible,
  level,
  onDrop,
  onHover,
}: {
  active: boolean;
  visible: boolean;
  level: number;
  onDrop: () => void;
  onHover: () => void;
}) {
  return (
    <div
      aria-hidden="true"
      onDragEnter={(event) => {
        event.preventDefault();
        onHover();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onHover();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={cn(
        'pointer-events-none relative h-0 overflow-visible transition-opacity duration-150 ease-out',
        active ? 'opacity-100' : 'opacity-0',
      )}
      style={{ paddingLeft: `${getRowPaddingLeft(level)}px` }}
    >
      {active && visible ? (
        <motion.span
          layoutId="sidebar-drop-lens"
          transition={{ duration: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-x-2 top-0 z-30 h-0.5 -translate-y-1/2 rounded-full bg-sidebar-accent/75 shadow-[0_0_0_1px_rgba(255,255,255,0.8)] dark:shadow-[0_0_0_1px_rgba(15,23,42,0.8)]"
        />
      ) : null}
    </div>
  );
}

function SidebarDragPreview({
  item,
}: {
  item: OrderedWorkspaceFolderItem | null;
}) {
  if (!item) {
    return null;
  }

  if (item.type === 'separator') {
    return (
    <div className="flex h-8 w-48 items-center gap-2 rounded-md border border-sidebar-border/70 bg-sidebar/95 px-2.5 shadow-[0_10px_26px_-18px_rgba(15,23,42,0.42)]">
        <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="h-px flex-1 rounded-full bg-sidebar-border" />
      </div>
    );
  }

  const label = item.type === 'folder' ? item.folder.label : item.file.label;
  const Icon = item.type === 'folder' ? FolderIcon : FileTextIcon;

  return (
    <div className="flex h-8 w-48 items-center gap-2 rounded-md border border-sidebar-border/70 bg-sidebar/95 px-2.5 text-sm font-medium text-sidebar-foreground shadow-[0_10px_26px_-18px_rgba(15,23,42,0.42)]">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

function SidebarDropPlaceholder({
  level,
  onDrop,
  onHover,
}: {
  level: number;
  onDrop: () => void;
  onHover: () => void;
}) {
  return (
    <div
      aria-hidden="true"
      onDragEnter={(event) => {
        event.preventDefault();
        onHover();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onHover();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className="relative py-0.5"
      style={{ paddingLeft: `${getRowPaddingLeft(level)}px` }}
    >
      <div className="h-7 rounded-md border border-dashed border-sidebar-accent/45 bg-sidebar-accent/12 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />
    </div>
  );
}

function FileRow({
  draggingItem,
  editValue,
  file,
  isSelected,
  isEditing,
  isHighlighted,
  itemIndex,
  level,
  parentFolderId,
  onBeginRename,
  onCancelRename,
  onChangeRename,
  onCommitRename,
  onDragEnd,
  onDragStart,
  onDropItem,
  onHoverDropTarget,
  onDownload,
  onDelete,
  onSelect,
  onSelectForContextMenu,
}: {
  draggingItem: DraggedSeparator | null;
  editValue: string;
  file: WorkspaceFile;
  isSelected: boolean;
  isEditing: boolean;
  isHighlighted: boolean;
  itemIndex: number;
  level: number;
  parentFolderId: string;
  onBeginRename: () => void;
  onCancelRename: () => void;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onDragEnd: () => void;
  onDragStart: (item: DraggedSeparator) => void;
  onDropItem: (target: SeparatorDropTarget) => void;
  onHoverDropTarget: (target: SeparatorDropTarget) => void;
  onDownload?: () => void;
  onDelete: () => void;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSelectForContextMenu: () => void;
}) {
  const isBeingDragged = draggingItem?.item.type === 'file' && draggingItem.item.id === file.id;
  const resolveDropTarget = (event: ReactDragEvent<HTMLElement>) => ({
    parentFolderId,
    index: getDropRatio(event) > 0.5 ? itemIndex + 1 : itemIndex,
  });
  const contextMenu = useFixedContextMenu();

  return (
    <SidebarMenuItem className="relative w-full">
      <TreeElbow level={level} />
      {isEditing ? (
        <div className="px-2 py-1">
          <EditingRow
            value={editValue}
            onCancel={onCancelRename}
            onChange={onChangeRename}
            onCommit={onCommitRename}
          />
        </div>
      ) : (
        <>
            <SidebarMenuButton
              isActive={isSelected}
              draggable
              onClick={onSelect}
              onContextMenu={(event) => {
                onSelectForContextMenu();
                contextMenu.open(event);
              }}
              onDoubleClick={onBeginRename}
              onDragEnter={(event) => {
                if (!draggingItem) {
                  return;
                }

                event.preventDefault();
                onHoverDropTarget(resolveDropTarget(event));
              }}
              onDragOver={(event) => {
                if (!draggingItem) {
                  return;
                }

                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                onHoverDropTarget(resolveDropTarget(event));
              }}
              onDrop={(event) => {
                if (!draggingItem) {
                  return;
                }

                event.preventDefault();
                onDropItem(resolveDropTarget(event));
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', file.id);
                setTransparentDragImage(event.dataTransfer);
                onDragStart({
                  item: {
                    type: 'file',
                    id: file.id,
                  },
                  parentFolderId,
                });
              }}
              onDragEnd={onDragEnd}
              className={cn(
                'w-full cursor-grab pr-10 transition-[background-color,box-shadow,opacity,transform] duration-150 data-[active=true]:bg-sidebar-accent/45 active:cursor-grabbing',
                SIDEBAR_ROW_INSET_CLASS,
                isSelected && SIDEBAR_SELECTED_CLASS,
                isHighlighted && !isSelected && SIDEBAR_HIGHLIGHT_CLASS,
                isBeingDragged && 'scale-[0.99] opacity-55',
              )}
              style={{ paddingLeft: `${getRowPaddingLeft(level)}px` }}
            >
              <span className="w-0 shrink-0" />
              <FileTextIcon className="ml-[-4px]" />
              <span>{file.label}</span>
            </SidebarMenuButton>
          <SidebarContextMenu position={contextMenu.position} onClose={contextMenu.close} className="w-56">
            <SidebarContextMenuLabel>File actions</SidebarContextMenuLabel>
            <SidebarContextMenuSeparator />
            <button
              type="button"
              role="menuitem"
              className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                onSelectForContextMenu();
                queueAfterMenuClose(onBeginRename);
              }}
            >
              <PencilIcon />
              Rename
            </button>
            {onDownload ? (
              <button
                type="button"
                role="menuitem"
                className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS}
                onClick={() => {
                  onSelectForContextMenu();
                  onDownload();
                }}
              >
                <DownloadIcon />
                Download
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className={`${SIDEBAR_CONTEXT_MENU_ITEM_CLASS} text-destructive hover:bg-destructive/10 focus:bg-destructive/10`}
              onClick={onDelete}
            >
              <Trash2Icon />
              Delete
            </button>
          </SidebarContextMenu>
        </>
      )}
    </SidebarMenuItem>
  );
}

function SeparatorRow({
  draggingItem,
  itemIndex,
  level,
  onDelete,
  onDragEnd,
  onDragStart,
  onDropItem,
  onHoverDropTarget,
  parentFolderId,
  separator,
}: {
  draggingItem: DraggedSeparator | null;
  itemIndex: number;
  level: number;
  onDelete: () => void;
  onDragEnd: () => void;
  onDragStart: (separator: DraggedSeparator) => void;
  onDropItem: (target: SeparatorDropTarget) => void;
  onHoverDropTarget: (target: SeparatorDropTarget) => void;
  parentFolderId: string;
  separator: WorkspaceSeparator;
}) {
  const isBeingDragged =
    draggingItem?.item.type === 'separator' && draggingItem.item.id === separator.id;
  const resolveDropTarget = (event: ReactDragEvent<HTMLElement>) => ({
    parentFolderId,
    index: getDropRatio(event) > 0.5 ? itemIndex + 1 : itemIndex,
  });
  const contextMenu = useFixedContextMenu();

  return (
    <SidebarMenuItem className="relative w-full py-1.5">
      <TreeElbow level={level} />
      <>
          <div
            draggable
            onContextMenu={contextMenu.open}
            onDragEnter={(event) => {
              if (!draggingItem) {
                return;
              }

              event.preventDefault();
              onHoverDropTarget(resolveDropTarget(event));
            }}
            onDragOver={(event) => {
              if (!draggingItem) {
                return;
              }

              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              onHoverDropTarget(resolveDropTarget(event));
            }}
            onDrop={(event) => {
              if (!draggingItem) {
                return;
              }

              event.preventDefault();
              onDropItem(resolveDropTarget(event));
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', separator.id);
              setTransparentDragImage(event.dataTransfer);
              onDragStart({
                item: {
                  type: 'separator',
                  id: separator.id,
                },
                parentFolderId,
              });
            }}
            onDragEnd={onDragEnd}
            className={cn(
              'group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sidebar-foreground/70 transition-[opacity,transform]',
              isBeingDragged && 'scale-[0.99] opacity-55',
            )}
            style={{ paddingLeft: `${getRowPaddingLeft(level) + 16}px` }}
          >
            <GripVerticalIcon className="size-3.5 shrink-0 opacity-45" />
            <span className="h-px flex-1 rounded-full bg-sidebar-border/80" />
          </div>
        <SidebarContextMenu position={contextMenu.position} onClose={contextMenu.close} className="w-48">
          <SidebarContextMenuLabel>Separator</SidebarContextMenuLabel>
          <SidebarContextMenuSeparator />
          <button
            type="button"
            role="menuitem"
            className={`${SIDEBAR_CONTEXT_MENU_ITEM_CLASS} text-destructive hover:bg-destructive/10 focus:bg-destructive/10`}
            onClick={onDelete}
          >
            <Trash2Icon />
            Delete
          </button>
        </SidebarContextMenu>
      </>
    </SidebarMenuItem>
  );
}

function FolderRow({
  activeDropTarget,
  draggingItem,
  editingItem,
  expandedFolderIds,
  folder,
  draggedOrderedItem,
  hasDraggedItem,
  highlightedItemKeys,
  itemIndex,
  level,
  parentFolderId,
  rootIndex,
  selectedItemKeys,
  onBeginRename,
  onCancelRename,
  onChangeRename,
  onCommitRename,
  onCreateFile,
  onCreateSeparator,
  onDownloadFile,
  onDeleteFile,
  onDeleteFolder,
  onDeleteSeparator,
  onDragEndSeparator,
  onDragStartSeparator,
  onDropSeparator,
  onHoverDropTarget,
  onRequestDeleteFolder,
  onRequestDownloadFolder,
  onSelectFile,
  onSelectFolder,
  onSelectFileForContextMenu,
  onSelectFolderForContextMenu,
  onToggleExpanded,
  searchActive,
}: {
  activeDropTarget: SeparatorDropTarget | null;
  draggingItem: DraggedSeparator | null;
  editingItem: EditingItem;
  expandedFolderIds: Set<string>;
  folder: WorkspaceFolder;
  draggedOrderedItem: OrderedWorkspaceFolderItem | null;
  hasDraggedItem: boolean;
  highlightedItemKeys: Set<string>;
  itemIndex: number;
  level: number;
  parentFolderId: string | null;
  rootIndex?: number;
  selectedItemKeys: Set<string>;
  onBeginRename: (item: EditingItem) => void;
  onCancelRename: () => void;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onCreateFile: (folderId: string) => void;
  onCreateSeparator: (folderId: string) => void;
  onDownloadFile?: (fileId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onDeleteSeparator: (separatorId: string) => void;
  onDragEndSeparator: () => void;
  onDragStartSeparator: (separator: DraggedSeparator) => void;
  onDropSeparator: (target: SeparatorDropTarget) => void;
  onHoverDropTarget: (target: SeparatorDropTarget) => void;
  onRequestDeleteFolder: (folder: WorkspaceFolder) => void;
  onRequestDownloadFolder?: (folderId: string) => void;
  onSelectFile: (fileId: string, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSelectFileForContextMenu: (fileId: string) => void;
  onSelectFolder: (folderId: string, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSelectFolderForContextMenu: (folderId: string) => void;
  onToggleExpanded: (folderId: string) => void;
  searchActive: boolean;
}) {
  const isExpanded = searchActive || expandedFolderIds.has(folder.id);
  const orderedItems = getPreviewOrderedItems(
    folder,
    draggingItem,
    activeDropTarget,
    draggedOrderedItem,
  );
  const hasChildren = orderedItems.length > 0;
  const isEditing = editingItem?.type === 'folder' && editingItem.id === folder.id;
  const isSelected = selectedItemKeys.has(getSidebarItemKey({ type: 'folder', id: folder.id }));
  const isHighlighted = highlightedItemKeys.has(
    getSidebarItemKey({ type: 'folder', id: folder.id }),
  );
  const descendantCounts = getFolderDescendantCounts(folder);
  const totalDescendants = descendantCounts.folders + descendantCounts.files;
  const rowDropTarget = {
    parentFolderId: folder.id,
    index: orderedItems.length,
  } satisfies SeparatorDropTarget;
  const activeDropTargetKey = getDropTargetKey(activeDropTarget);
  const rowDropTargetKey = getDropTargetKey(rowDropTarget);
  const isBeingDragged =
    draggingItem?.item.type === 'folder' && draggingItem.item.id === folder.id;
  const resolveFolderDropTarget = (event: ReactDragEvent<HTMLElement>) => {
    const ratio = getDropRatio(event);
    const canDropBeside = parentFolderId !== null || draggingItem?.item.type === 'folder';

    if (canDropBeside && ratio < 0.28) {
      return {
        parentFolderId,
        index: itemIndex,
      } satisfies SeparatorDropTarget;
    }

    if (canDropBeside && ratio > 0.72) {
      return {
        parentFolderId,
        index: itemIndex + 1,
      } satisfies SeparatorDropTarget;
    }

    return rowDropTarget;
  };
  const contextMenu = useFixedContextMenu();

  return (
    <SidebarMenuItem className={cn('relative w-full', level === 0 && rootIndex && rootIndex > 0 && 'mt-4')}>
      <TreeElbow level={level} />
      {isEditing ? (
        <div className="px-2 py-1">
          <EditingRow
            value={editingItem.value}
            onCancel={onCancelRename}
            onChange={onChangeRename}
            onCommit={onCommitRename}
          />
        </div>
      ) : (
        <>
            <div className="relative w-full">
              <SidebarMenuButton
                isActive={isSelected}
                draggable
                onClick={(event) => onSelectFolder(folder.id, event)}
                onContextMenu={(event) => {
                  onSelectFolderForContextMenu(folder.id);
                  contextMenu.open(event);
                }}
                onDoubleClick={() =>
                  onBeginRename({
                    type: 'folder',
                    id: folder.id,
                    value: folder.label,
                  })
                }
                onDragEnter={(event) => {
                  if (!draggingItem) {
                    return;
                  }

                  event.preventDefault();
                  onHoverDropTarget(resolveFolderDropTarget(event));
                }}
                onDragOver={(event) => {
                  if (!draggingItem) {
                    return;
                  }

                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  onHoverDropTarget(resolveFolderDropTarget(event));
                }}
                onDrop={(event) => {
                  if (!draggingItem) {
                    return;
                  }

                  event.preventDefault();
                  onDropSeparator(resolveFolderDropTarget(event));
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', folder.id);
                  setTransparentDragImage(event.dataTransfer);
                  onDragStartSeparator({
                    item: {
                      type: 'folder',
                      id: folder.id,
                    },
                    parentFolderId,
                  });
                }}
                onDragEnd={onDragEndSeparator}
                className={cn(
                  'relative w-full cursor-grab overflow-visible pr-14 transition-[background-color,box-shadow,opacity,transform] duration-150 data-[active=true]:bg-sidebar-accent/45 active:cursor-grabbing',
                  SIDEBAR_ROW_INSET_CLASS,
                  isSelected && SIDEBAR_SELECTED_CLASS,
                  isHighlighted && !isSelected && SIDEBAR_HIGHLIGHT_CLASS,
                  activeDropTargetKey === rowDropTargetKey && 'shadow-[inset_0_-2px_0_0_rgba(125,211,252,0.8)]',
                  isBeingDragged && 'scale-[0.99] opacity-55',
                )}
                style={{ paddingLeft: `${getRowPaddingLeft(level)}px` }}
                tooltip={folder.label}
              >
                {activeDropTargetKey === rowDropTargetKey ? (
                  <motion.span
                    layoutId="sidebar-folder-drop-lens"
                    transition={{ duration: 0.1, ease: [0.22, 1, 0.36, 1] }}
                    className="pointer-events-none absolute inset-0 rounded-md bg-sidebar-accent/18 ring-1 ring-sidebar-accent/35"
                  />
                ) : null}
                <button
                  type="button"
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition',
                    hasChildren ? 'hover:bg-sidebar-accent' : 'opacity-45',
                  )}
                  onClick={(event) => {
                    event.stopPropagation();

                    if (hasChildren) {
                      onToggleExpanded(folder.id);
                    }
                  }}
                >
                  <ChevronDownIcon
                    className={cn('ml-[1px] size-3.5 transition-transform', !isExpanded && '-rotate-90')}
                  />
                </button>
                {isExpanded ? <FolderOpenIcon className="ml-[0px]" /> : <FolderIcon className="ml-[0px]" />}
                <span>{folder.label}</span>
                <span className="group/count absolute inset-y-0 right-1 z-10 w-0">
                  <span className="absolute right-0 top-1/2 -translate-y-1/2 px-1 text-[11px] font-medium text-sidebar-foreground/70">
                    {totalDescendants}
                  </span>

                  <span className="pointer-events-none absolute left-2 top-0 z-30 min-w-28 translate-x-1 rounded-xl border border-sidebar-border/80 bg-background/98 px-3 py-2 text-xs text-foreground opacity-0 shadow-[0_18px_40px_-22px_rgba(15,23,42,0.35)] transition duration-150 ease-out group-hover/count:translate-x-0 group-hover/count:opacity-100 group-hover/count:duration-200 group-focus-within/count:translate-x-0 group-focus-within/count:opacity-100">
                    <span className="block whitespace-nowrap">
                      {formatCountLabel(descendantCounts.folders, 'folder', 'folders')}
                    </span>
                    <span className="block whitespace-nowrap text-muted-foreground">
                      {formatCountLabel(descendantCounts.files, 'file', 'files')}
                    </span>
                  </span>
                </span>
              </SidebarMenuButton>
            </div>
          <SidebarContextMenu position={contextMenu.position} onClose={contextMenu.close} className="w-56">
            <SidebarContextMenuLabel>Folder actions</SidebarContextMenuLabel>
            <SidebarContextMenuSeparator />
            <button
              type="button"
              role="menuitem"
              className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                onSelectFolderForContextMenu(folder.id);
                onCreateFile(folder.id);
              }}
            >
              <FilePlus2Icon />
              Add file
            </button>
            <button
              type="button"
              role="menuitem"
              className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                onSelectFolderForContextMenu(folder.id);
                onCreateSeparator(folder.id);
              }}
            >
              <MinusIcon />
              Add separator
            </button>
            <button
              type="button"
              role="menuitem"
              className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                onSelectFolderForContextMenu(folder.id);
                queueAfterMenuClose(() =>
                  onBeginRename({
                    type: 'folder',
                    id: folder.id,
                    value: folder.label,
                  }),
                );
              }}
            >
              <PencilIcon />
              Rename
            </button>
            {onRequestDownloadFolder ? (
              <button
                type="button"
                role="menuitem"
                className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS}
                onClick={() => {
                  onSelectFolderForContextMenu(folder.id);
                  onRequestDownloadFolder(folder.id);
                }}
              >
                <DownloadIcon />
                Download
              </button>
            ) : null}
            {hasChildren ? (
              <button
                type="button"
                role="menuitem"
                className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS}
                onClick={() => onToggleExpanded(folder.id)}
              >
                {isExpanded ? <FolderIcon /> : <FolderOpenIcon />}
                {isExpanded ? 'Collapse' : 'Expand'}
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className={`${SIDEBAR_CONTEXT_MENU_ITEM_CLASS} text-destructive hover:bg-destructive/10 focus:bg-destructive/10`}
              onClick={() => {
                onSelectFolderForContextMenu(folder.id);

                if (folderHasContents(folder)) {
                  onRequestDeleteFolder(folder);
                  return;
                }

                onDeleteFolder(folder.id);
              }}
            >
              <Trash2Icon />
              Delete
            </button>
          </SidebarContextMenu>
        </>
      )}

      {hasChildren ? (
        <div
          aria-hidden={!isExpanded}
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
            isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="relative overflow-hidden">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-8 left-[17px] top-0 w-px bg-sidebar-border/80"
            />
            <SidebarMenuSub className={cn('mr-0 border-l-0 px-0 pl-2.5 pr-0', !isExpanded && 'pointer-events-none')}>
              <SeparatorDropZone
                active={activeDropTargetKey === getDropTargetKey({ parentFolderId: folder.id, index: 0 })}
                visible={hasDraggedItem}
                level={level + 1}
                onHover={() => onHoverDropTarget({ parentFolderId: folder.id, index: 0 })}
                onDrop={() => onDropSeparator({ parentFolderId: folder.id, index: 0 })}
              />

              {orderedItems.map((previewItem) => (
                <motion.div
                  key={
                    previewItem.type === 'placeholder'
                      ? previewItem.key
                      : getOrderedItemKey(previewItem.item)
                  }
                  layout="position"
                  transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
                >
                  {previewItem.type === 'placeholder' ? (
                    <SidebarDropPlaceholder
                      level={level + 1}
                      onHover={() => onHoverDropTarget(previewItem.target)}
                      onDrop={() => onDropSeparator(previewItem.target)}
                    />
                  ) : (
                    <>
                  {(() => {
                    const item = previewItem.item;
                    const sourceIndex = previewItem.sourceIndex;

                    return (
                      <>
                  {item.type === 'folder' ? (
                    <FolderRow
                      activeDropTarget={activeDropTarget}
                      draggingItem={draggingItem}
                      editingItem={editingItem}
                      expandedFolderIds={expandedFolderIds}
                      folder={item.folder}
                      draggedOrderedItem={draggedOrderedItem}
                      hasDraggedItem={hasDraggedItem}
                      highlightedItemKeys={highlightedItemKeys}
                      itemIndex={sourceIndex}
                      level={level + 1}
                      parentFolderId={folder.id}
                      selectedItemKeys={selectedItemKeys}
                      onBeginRename={onBeginRename}
                      onCancelRename={onCancelRename}
                      onChangeRename={onChangeRename}
                      onCommitRename={onCommitRename}
                      onCreateFile={onCreateFile}
                      onCreateSeparator={onCreateSeparator}
                      onDownloadFile={onDownloadFile}
                      onDeleteFile={onDeleteFile}
                      onDeleteFolder={onDeleteFolder}
                      onDeleteSeparator={onDeleteSeparator}
                      onDragEndSeparator={onDragEndSeparator}
                      onDragStartSeparator={onDragStartSeparator}
                      onDropSeparator={onDropSeparator}
                      onHoverDropTarget={onHoverDropTarget}
                      onRequestDeleteFolder={onRequestDeleteFolder}
                      onRequestDownloadFolder={onRequestDownloadFolder}
                      onSelectFile={onSelectFile}
                      onSelectFileForContextMenu={onSelectFileForContextMenu}
                      onSelectFolder={onSelectFolder}
                      onSelectFolderForContextMenu={onSelectFolderForContextMenu}
                      onToggleExpanded={onToggleExpanded}
                      searchActive={searchActive}
                    />
                  ) : item.type === 'file' ? (
                    <FileRow
                      draggingItem={draggingItem}
                      editValue={
                        editingItem?.type === 'file' && editingItem.id === item.file.id
                          ? editingItem.value
                          : item.file.label
                      }
                      file={item.file}
                      isSelected={selectedItemKeys.has(
                        getSidebarItemKey({ type: 'file', id: item.file.id }),
                      )}
                      isEditing={editingItem?.type === 'file' && editingItem.id === item.file.id}
                      isHighlighted={highlightedItemKeys.has(
                        getSidebarItemKey({ type: 'file', id: item.file.id }),
                      )}
                      itemIndex={sourceIndex}
                      level={level + 1}
                      parentFolderId={folder.id}
                      onBeginRename={() =>
                        onBeginRename({
                          type: 'file',
                          id: item.file.id,
                          value: item.file.label,
                        })
                      }
                      onCancelRename={onCancelRename}
                      onChangeRename={onChangeRename}
                      onCommitRename={onCommitRename}
                      onDragEnd={onDragEndSeparator}
                      onDragStart={onDragStartSeparator}
                      onDropItem={onDropSeparator}
                      onHoverDropTarget={onHoverDropTarget}
                      onDownload={
                        onDownloadFile ? () => onDownloadFile(item.file.id) : undefined
                      }
                      onDelete={() => onDeleteFile(item.file.id)}
                      onSelect={(event) => onSelectFile(item.file.id, event)}
                      onSelectForContextMenu={() => onSelectFileForContextMenu(item.file.id)}
                    />
                  ) : (
                    <SeparatorRow
                      draggingItem={draggingItem}
                      itemIndex={sourceIndex}
                      level={level + 1}
                      onDelete={() => onDeleteSeparator(item.separator.id)}
                      onDragEnd={onDragEndSeparator}
                      onDragStart={onDragStartSeparator}
                      onDropItem={onDropSeparator}
                      onHoverDropTarget={onHoverDropTarget}
                      parentFolderId={folder.id}
                      separator={item.separator}
                    />
                  )}

                  <SeparatorDropZone
                    active={activeDropTargetKey === getDropTargetKey({ parentFolderId: folder.id, index: sourceIndex + 1 })}
                    visible={hasDraggedItem}
                    level={level + 1}
                    onHover={() => onHoverDropTarget({ parentFolderId: folder.id, index: sourceIndex + 1 })}
                    onDrop={() => onDropSeparator({ parentFolderId: folder.id, index: sourceIndex + 1 })}
                  />
                      </>
                    );
                  })()}
                    </>
                  )}
                </motion.div>
              ))}
            </SidebarMenuSub>
          </div>
        </div>
      ) : null}
    </SidebarMenuItem>
  );
}

interface SidebarTreeProps {
  editingItem: EditingItem;
  expandedFolderIds: Set<string>;
  folders: WorkspaceFolder[];
  highlightedItemKeys: Set<string>;
  selectedItemKeys: Set<string>;
  onBeginRename: (item: EditingItem) => void;
  onCancelRename: () => void;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onCreateFile: (folderId: string) => void;
  onCreateSeparator: (folderId: string) => void;
  onDownloadFile?: (fileId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onDeleteSeparator: (separatorId: string) => void;
  onMoveItem: (
    item: WorkspaceFolderOrderEntry,
    targetParentFolderId: string | null,
    targetIndex: number,
  ) => void;
  onRequestDeleteFolder: (folder: WorkspaceFolder) => void;
  onRequestDownloadFolder?: (folderId: string) => void;
  onSelectFile: (fileId: string, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSelectFileForContextMenu: (fileId: string) => void;
  onSelectFolder: (folderId: string, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSelectFolderForContextMenu: (folderId: string) => void;
  onToggleExpanded: (folderId: string) => void;
  searchActive: boolean;
}

export function SidebarTree({
  editingItem,
  expandedFolderIds,
  folders,
  highlightedItemKeys,
  selectedItemKeys,
  onBeginRename,
  onCancelRename,
  onChangeRename,
  onCommitRename,
  onCreateFile,
  onCreateSeparator,
  onDownloadFile,
  onDeleteFile,
  onDeleteFolder,
  onDeleteSeparator,
  onMoveItem,
  onRequestDeleteFolder,
  onRequestDownloadFolder,
  onSelectFile,
  onSelectFileForContextMenu,
  onSelectFolder,
  onSelectFolderForContextMenu,
  onToggleExpanded,
  searchActive,
}: SidebarTreeProps) {
  const [draggingSeparator, setDraggingSeparator] = useState<DraggedSeparator | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<SeparatorDropTarget | null>(null);
  const [dragPreviewVisible, setDragPreviewVisible] = useState(false);
  const canDropAtRoot = draggingSeparator?.item.type === 'folder';
  const dragPreviewVisibleRef = useRef(false);
  const pendingDropTargetRef = useRef<SeparatorDropTarget | null>(null);
  const pendingDropTargetFrameRef = useRef<number | null>(null);
  const activeDropTargetKeyRef = useRef('');
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const smoothDragX = useSpring(dragX, {
    stiffness: 1200,
    damping: 58,
    mass: 0.25,
  });
  const smoothDragY = useSpring(dragY, {
    stiffness: 1200,
    damping: 58,
    mass: 0.25,
  });
  const draggedOrderedItem = useMemo(
    () => (draggingSeparator ? findOrderedItemByEntry(folders, draggingSeparator.item) : null),
    [draggingSeparator, folders],
  );
  const previewFolders = useMemo(
    () => getPreviewRootFolders(folders, draggingSeparator, activeDropTarget, draggedOrderedItem),
    [activeDropTarget, draggedOrderedItem, draggingSeparator, folders],
  );

  function updateActiveDropTarget(target: SeparatorDropTarget) {
    const targetKey = getDropTargetKey(target);

    if (activeDropTargetKeyRef.current === targetKey) {
      return;
    }

    pendingDropTargetRef.current = target;

    if (pendingDropTargetFrameRef.current !== null) {
      return;
    }

    pendingDropTargetFrameRef.current = window.requestAnimationFrame(() => {
      const nextTarget = pendingDropTargetRef.current;
      pendingDropTargetFrameRef.current = null;

      if (!nextTarget) {
        return;
      }

      const nextKey = getDropTargetKey(nextTarget);

      if (activeDropTargetKeyRef.current === nextKey) {
        return;
      }

      activeDropTargetKeyRef.current = nextKey;
      setActiveDropTarget(nextTarget);
    });
  }

  useEffect(() => {
    dragPreviewVisibleRef.current = dragPreviewVisible;
  }, [dragPreviewVisible]);

  useEffect(() => {
    activeDropTargetKeyRef.current = getDropTargetKey(activeDropTarget);
  }, [activeDropTarget]);

  useEffect(
    () => () => {
      if (pendingDropTargetFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingDropTargetFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!draggingSeparator) {
      setDragPreviewVisible(false);
      dragPreviewVisibleRef.current = false;
      pendingDropTargetRef.current = null;
      activeDropTargetKeyRef.current = '';

      if (pendingDropTargetFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingDropTargetFrameRef.current);
        pendingDropTargetFrameRef.current = null;
      }
      return;
    }

    function handleDragOver(event: DragEvent) {
      if (event.clientX === 0 && event.clientY === 0) {
        return;
      }

      dragX.set(event.clientX + 12);
      dragY.set(event.clientY + 10);

      if (!dragPreviewVisibleRef.current) {
        dragPreviewVisibleRef.current = true;
        setDragPreviewVisible(true);
      }
    }

    window.addEventListener('dragover', handleDragOver);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
    };
  }, [dragX, dragY, draggingSeparator]);

  return (
    <SidebarMenu>
      {draggingSeparator && dragPreviewVisible ? (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-[100] origin-top-left will-change-transform"
          style={{ x: smoothDragX, y: smoothDragY }}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.12 }}
        >
          <SidebarDragPreview item={draggedOrderedItem} />
        </motion.div>
      ) : null}
      <SeparatorDropZone
        active={canDropAtRoot && activeDropTarget?.parentFolderId === null && activeDropTarget.index === 0}
        visible={Boolean(canDropAtRoot)}
        level={0}
        onHover={() => {
          if (canDropAtRoot) {
            updateActiveDropTarget({
              parentFolderId: null,
              index: 0,
            });
          }
        }}
        onDrop={() => {
          if (!draggingSeparator || draggingSeparator.item.type !== 'folder') {
            return;
          }

          onMoveItem(draggingSeparator.item, null, 0);
          setDraggingSeparator(null);
          setActiveDropTarget(null);
        }}
      />
      {previewFolders.map((previewFolder, displayIndex) => (
        <motion.div
          key={previewFolder.type === 'placeholder' ? previewFolder.key : previewFolder.folder.id}
          layout="position"
          transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
        >
          {previewFolder.type === 'placeholder' ? (
            <SidebarDropPlaceholder
              level={0}
              onHover={() => {
                if (canDropAtRoot) {
                  updateActiveDropTarget(previewFolder.target);
                }
              }}
              onDrop={() => {
                if (!draggingSeparator || draggingSeparator.item.type !== 'folder') {
                  return;
                }

                onMoveItem(
                  draggingSeparator.item,
                  previewFolder.target.parentFolderId,
                  previewFolder.target.index,
                );
                setDraggingSeparator(null);
                setActiveDropTarget(null);
              }}
            />
          ) : (
            <>
          <FolderRow
            activeDropTarget={activeDropTarget}
            draggingItem={draggingSeparator}
            editingItem={editingItem}
            expandedFolderIds={expandedFolderIds}
            folder={previewFolder.folder}
            draggedOrderedItem={draggedOrderedItem}
            hasDraggedItem={draggingSeparator !== null}
            highlightedItemKeys={highlightedItemKeys}
            itemIndex={previewFolder.sourceIndex}
            level={0}
            parentFolderId={null}
            rootIndex={displayIndex}
            selectedItemKeys={selectedItemKeys}
            onBeginRename={onBeginRename}
            onCancelRename={onCancelRename}
            onChangeRename={onChangeRename}
            onCommitRename={onCommitRename}
            onCreateFile={onCreateFile}
            onCreateSeparator={onCreateSeparator}
            onDownloadFile={onDownloadFile}
            onDeleteFile={onDeleteFile}
            onDeleteFolder={onDeleteFolder}
            onDeleteSeparator={onDeleteSeparator}
            onDragEndSeparator={() => {
              setDraggingSeparator(null);
              setActiveDropTarget(null);
            }}
            onDragStartSeparator={(separator) => {
              setDraggingSeparator(separator);
              setActiveDropTarget(null);
            }}
            onDropSeparator={(target) => {
              if (!draggingSeparator) {
                return;
              }

              onMoveItem(draggingSeparator.item, target.parentFolderId, target.index);
              setDraggingSeparator(null);
              setActiveDropTarget(null);
            }}
            onHoverDropTarget={updateActiveDropTarget}
            onRequestDeleteFolder={onRequestDeleteFolder}
            onRequestDownloadFolder={onRequestDownloadFolder}
            onSelectFile={onSelectFile}
            onSelectFileForContextMenu={onSelectFileForContextMenu}
            onSelectFolder={onSelectFolder}
            onSelectFolderForContextMenu={onSelectFolderForContextMenu}
            onToggleExpanded={onToggleExpanded}
            searchActive={searchActive}
          />
          <SeparatorDropZone
            active={
              Boolean(canDropAtRoot) &&
              activeDropTarget?.parentFolderId === null &&
              activeDropTarget.index === previewFolder.sourceIndex + 1
            }
            visible={Boolean(canDropAtRoot)}
            level={0}
            onHover={() => {
              if (canDropAtRoot) {
                updateActiveDropTarget({
                  parentFolderId: null,
                  index: previewFolder.sourceIndex + 1,
                });
              }
            }}
            onDrop={() => {
              if (!draggingSeparator || draggingSeparator.item.type !== 'folder') {
                return;
              }

              onMoveItem(draggingSeparator.item, null, previewFolder.sourceIndex + 1);
              setDraggingSeparator(null);
              setActiveDropTarget(null);
            }}
          />
            </>
          )}
        </motion.div>
      ))}
    </SidebarMenu>
  );
}
