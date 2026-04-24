import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
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

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@/components/animate-ui/components/radix/sidebar';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  folderHasContents,
  getFolderDescendantCounts,
  getOrderedWorkspaceFolderItems,
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

const SIDEBAR_HIGHLIGHT_CLASS =
  'bg-sidebar-accent/30 text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgba(71,85,105,0.55)]';
const SIDEBAR_SELECTED_CLASS =
  'bg-sidebar-accent/45 text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgba(71,85,105,0.55)]';

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

function getRowPaddingLeft(level: number) {
  return level === 0 ? 10 : 14;
}

function getDropTargetKey(dropTarget: SeparatorDropTarget | null) {
  return dropTarget ? `${dropTarget.parentFolderId ?? 'root'}:${dropTarget.index}` : '';
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
        'relative transition-[height,opacity] duration-150 ease-out',
        visible ? 'h-3 opacity-100' : 'h-0 opacity-0',
      )}
      style={{ paddingLeft: `${getRowPaddingLeft(level)}px` }}
    >
      <span
        className={cn(
          'absolute inset-x-2 top-1/2 h-px -translate-y-1/2 rounded-full bg-sidebar-border/70 transition-all duration-150',
          active && 'h-1 bg-sidebar-accent/65',
        )}
      />
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
  level,
  parentFolderId,
  onBeginRename,
  onCancelRename,
  onChangeRename,
  onCommitRename,
  onDragEnd,
  onDragStart,
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
  level: number;
  parentFolderId: string;
  onBeginRename: () => void;
  onCancelRename: () => void;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onDragEnd: () => void;
  onDragStart: (item: DraggedSeparator) => void;
  onDownload?: () => void;
  onDelete: () => void;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSelectForContextMenu: () => void;
}) {
  const isBeingDragged = draggingItem?.item.type === 'file' && draggingItem.item.id === file.id;

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
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <SidebarMenuButton
              isActive={isSelected}
              draggable
              onClick={onSelect}
              onDoubleClick={onBeginRename}
              onContextMenu={onSelectForContextMenu}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', file.id);
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
                'w-full cursor-grab pr-10 data-[active=true]:bg-sidebar-accent/45 active:cursor-grabbing',
                isSelected && SIDEBAR_SELECTED_CLASS,
                isHighlighted && !isSelected && SIDEBAR_HIGHLIGHT_CLASS,
                isBeingDragged && 'opacity-40',
              )}
              style={{ paddingLeft: `${getRowPaddingLeft(level)}px` }}
            >
              <span className="w-0 shrink-0" />
              <FileTextIcon className="ml-[-4px]" />
              <span>{file.label}</span>
            </SidebarMenuButton>
          </ContextMenuTrigger>
          <ContextMenuContent
            side="right"
            className="ml-2 w-56 overflow-hidden"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <ContextMenuLabel>File actions</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                onSelectForContextMenu();
                queueAfterMenuClose(onBeginRename);
              }}
            >
              <PencilIcon />
              Rename
            </ContextMenuItem>
            {onDownload ? (
              <ContextMenuItem
                onSelect={() => {
                  onSelectForContextMenu();
                  onDownload();
                }}
              >
                <DownloadIcon />
                Download
              </ContextMenuItem>
            ) : null}
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Trash2Icon className="size-4 shrink-0" />
                Delete
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="ml-2 w-52">
                <ContextMenuLabel>Are you sure you want to delete</ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={onDelete}>
                  Yes
                </ContextMenuItem>
                <ContextMenuItem>No</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>
      )}
    </SidebarMenuItem>
  );
}

function SeparatorRow({
  draggingItem,
  level,
  onDelete,
  onDragEnd,
  onDragStart,
  parentFolderId,
  separator,
}: {
  draggingItem: DraggedSeparator | null;
  level: number;
  onDelete: () => void;
  onDragEnd: () => void;
  onDragStart: (separator: DraggedSeparator) => void;
  parentFolderId: string;
  separator: WorkspaceSeparator;
}) {
  const isBeingDragged =
    draggingItem?.item.type === 'separator' && draggingItem.item.id === separator.id;

  return (
    <SidebarMenuItem className="relative w-full py-1.5">
      <TreeElbow level={level} />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', separator.id);
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
              'group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sidebar-foreground/70 transition',
              isBeingDragged && 'opacity-40',
            )}
            style={{ paddingLeft: `${getRowPaddingLeft(level) + 16}px` }}
          >
            <GripVerticalIcon className="size-3.5 shrink-0 opacity-45" />
            <span className="h-px flex-1 rounded-full bg-sidebar-border/80" />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          side="right"
          className="ml-2 w-48"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <ContextMenuLabel>Separator</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon />
            Delete
          </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
    </SidebarMenuItem>
  );
}

function FolderRow({
  activeDropTarget,
  draggingItem,
  editingItem,
  expandedFolderIds,
  folder,
  hasDraggedItem,
  highlightedItemKeys,
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
  hasDraggedItem: boolean;
  highlightedItemKeys: Set<string>;
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
  const orderedItems = getOrderedWorkspaceFolderItems(folder);
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
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="relative w-full">
              <SidebarMenuButton
                isActive={isSelected}
                draggable
                onClick={(event) => onSelectFolder(folder.id, event)}
                onDoubleClick={() =>
                  onBeginRename({
                    type: 'folder',
                    id: folder.id,
                    value: folder.label,
                  })
                }
                onContextMenu={() => onSelectFolderForContextMenu(folder.id)}
                onDragEnter={(event) => {
                  if (!draggingItem) {
                    return;
                  }

                  event.preventDefault();
                  onHoverDropTarget(rowDropTarget);
                }}
                onDragOver={(event) => {
                  if (!draggingItem) {
                    return;
                  }

                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  onHoverDropTarget(rowDropTarget);
                }}
                onDrop={(event) => {
                  if (!draggingItem) {
                    return;
                  }

                  event.preventDefault();
                  onDropSeparator(rowDropTarget);
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', folder.id);
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
                  'w-full cursor-grab overflow-visible pr-14 data-[active=true]:bg-sidebar-accent/45 active:cursor-grabbing',
                  isSelected && SIDEBAR_SELECTED_CLASS,
                  isHighlighted && !isSelected && SIDEBAR_HIGHLIGHT_CLASS,
                  activeDropTargetKey === rowDropTargetKey && 'shadow-[inset_0_-2px_0_0_rgba(125,211,252,0.8)]',
                  isBeingDragged && 'opacity-40',
                )}
                style={{ paddingLeft: `${getRowPaddingLeft(level)}px` }}
                tooltip={folder.label}
              >
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
          </ContextMenuTrigger>
          <ContextMenuContent
            side="right"
            className="ml-2 w-56"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <ContextMenuLabel>Folder actions</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                onSelectFolderForContextMenu(folder.id);
                onCreateFile(folder.id);
              }}
            >
              <FilePlus2Icon />
              Add file
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                onSelectFolderForContextMenu(folder.id);
                onCreateSeparator(folder.id);
              }}
            >
              <MinusIcon />
              Add separator
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
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
            </ContextMenuItem>
            {onRequestDownloadFolder ? (
              <ContextMenuItem
                onSelect={() => {
                  onSelectFolderForContextMenu(folder.id);
                  onRequestDownloadFolder(folder.id);
                }}
              >
                <DownloadIcon />
                Download
              </ContextMenuItem>
            ) : null}
            {hasChildren ? (
              <ContextMenuItem onSelect={() => onToggleExpanded(folder.id)}>
                {isExpanded ? <FolderIcon /> : <FolderOpenIcon />}
                {isExpanded ? 'Collapse' : 'Expand'}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              variant="destructive"
              onSelect={() => {
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
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
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

              {orderedItems.map((item, index) => (
                <div key={`${item.type}:${item.type === 'folder' ? item.folder.id : item.type === 'file' ? item.file.id : item.separator.id}`}>
                  {item.type === 'folder' ? (
                    <FolderRow
                      activeDropTarget={activeDropTarget}
                      draggingItem={draggingItem}
                      editingItem={editingItem}
                      expandedFolderIds={expandedFolderIds}
                      folder={item.folder}
                      hasDraggedItem={hasDraggedItem}
                      highlightedItemKeys={highlightedItemKeys}
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
                      level={level + 1}
                      onDelete={() => onDeleteSeparator(item.separator.id)}
                      onDragEnd={onDragEndSeparator}
                      onDragStart={onDragStartSeparator}
                      parentFolderId={folder.id}
                      separator={item.separator}
                    />
                  )}

                  <SeparatorDropZone
                    active={activeDropTargetKey === getDropTargetKey({ parentFolderId: folder.id, index: index + 1 })}
                    visible={hasDraggedItem}
                    level={level + 1}
                    onHover={() => onHoverDropTarget({ parentFolderId: folder.id, index: index + 1 })}
                    onDrop={() => onDropSeparator({ parentFolderId: folder.id, index: index + 1 })}
                  />
                </div>
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
  const canDropAtRoot = draggingSeparator?.item.type === 'folder';

  return (
    <SidebarMenu>
      <SeparatorDropZone
        active={canDropAtRoot && activeDropTarget?.parentFolderId === null && activeDropTarget.index === 0}
        visible={Boolean(canDropAtRoot)}
        level={0}
        onHover={() => {
          if (canDropAtRoot) {
            setActiveDropTarget({
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
      {folders.map((folder, index) => (
        <div key={folder.id}>
          <FolderRow
            activeDropTarget={activeDropTarget}
            draggingItem={draggingSeparator}
            editingItem={editingItem}
            expandedFolderIds={expandedFolderIds}
            folder={folder}
            hasDraggedItem={draggingSeparator !== null}
            highlightedItemKeys={highlightedItemKeys}
            level={0}
            parentFolderId={null}
            rootIndex={index}
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
            onHoverDropTarget={setActiveDropTarget}
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
              activeDropTarget.index === index + 1
            }
            visible={Boolean(canDropAtRoot)}
            level={0}
            onHover={() => {
              if (canDropAtRoot) {
                setActiveDropTarget({
                  parentFolderId: null,
                  index: index + 1,
                });
              }
            }}
            onDrop={() => {
              if (!draggingSeparator || draggingSeparator.item.type !== 'folder') {
                return;
              }

              onMoveItem(draggingSeparator.item, null, index + 1);
              setDraggingSeparator(null);
              setActiveDropTarget(null);
            }}
          />
        </div>
      ))}
    </SidebarMenu>
  );
}
