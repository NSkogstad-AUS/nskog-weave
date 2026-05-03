import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { SettingsPopover } from './SettingsPopover';
import { ChevronDownIcon, SearchIcon } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/animate-ui/components/base/alert-dialog';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarRail,
  SidebarTrigger,
} from '@/components/animate-ui/components/radix/sidebar';
import {
  addFileToFolderById,
  addSeparatorToFolderById,
  createWorkspaceFolders,
  deleteFileById,
  deleteFolderById,
  deleteSeparatorById,
  filterWorkspaceFolders,
  getAllFolderIds,
  getOrderedWorkspaceFolderItems,
  findFilePathById,
  findFolderPathById,
  moveWorkspaceItemById,
  renameFileById,
  renameFolderById,
  type WorkspaceFile,
  type WorkspaceFolder,
  type WorkspaceFolderOrderEntry,
  type WorkspaceSeparator,
} from '@/data/sidebarNavigation';
import { Input } from '@/components/ui/input';
import {
  SidebarTree,
  areSidebarItemsEqual,
  collectVisibleSidebarItems,
  getSidebarItemKey,
  type ActiveItem,
  type EditingItem,
  type SidebarSelectableItem,
} from './sidebar-tree';

type PendingFolderDelete =
  | {
      id: string;
      label: string;
    }
  | null;

type SidebarSortMode = 'custom' | 'name-asc' | 'name-desc' | 'type';

function queueAfterMenuClose(callback: () => void) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

function compareSidebarLabels(
  left: { label: string },
  right: { label: string },
  direction: 'asc' | 'desc',
) {
  return direction === 'asc'
    ? left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' })
    : right.label.localeCompare(left.label, undefined, { numeric: true, sensitivity: 'base' });
}

function sortSidebarFolders(
  folders: WorkspaceFolder[],
  sortMode: SidebarSortMode,
): WorkspaceFolder[] {
  if (sortMode === 'custom') {
    return folders;
  }

  const sortedFolders = folders.map((folder) => {
    const children = sortSidebarFolders(folder.children, sortMode);

    const nextFolder = {
      ...folder,
      children,
    };
    const orderedItems = getOrderedWorkspaceFolderItems(nextFolder);
    const orderWeight = {
      folder: 0,
      file: 1,
      separator: 2,
    } satisfies Record<WorkspaceFolderOrderEntry['type'], number>;
    const sortedItems = [...orderedItems].sort((left, right) => {
      const weightDifference = orderWeight[left.type] - orderWeight[right.type];

      if (weightDifference !== 0 && (sortMode === 'type' || left.type === 'separator' || right.type === 'separator')) {
        return weightDifference;
      }

      if (left.type === 'separator' || right.type === 'separator') {
        return 0;
      }

      if (sortMode === 'name-asc') {
        return compareSidebarLabels(
          left.type === 'folder' ? left.folder : left.file,
          right.type === 'folder' ? right.folder : right.file,
          'asc',
        );
      }

      if (sortMode === 'name-desc') {
        return compareSidebarLabels(
          left.type === 'folder' ? left.folder : left.file,
          right.type === 'folder' ? right.folder : right.file,
          'desc',
        );
      }

      return compareSidebarLabels(
        left.type === 'folder' ? left.folder : left.file,
        right.type === 'folder' ? right.folder : right.file,
        'asc',
      );
    });

    return {
      ...nextFolder,
      itemOrder: sortedItems.map((item) =>
        item.type === 'folder'
          ? {
              type: 'folder',
              id: item.folder.id,
            } satisfies WorkspaceFolderOrderEntry
          : item.type === 'file'
            ? {
                type: 'file',
                id: item.file.id,
              } satisfies WorkspaceFolderOrderEntry
            : {
                type: 'separator',
                id: item.separator.id,
              } satisfies WorkspaceFolderOrderEntry,
      ),
    };
  });

  return [...sortedFolders].sort((left, right) =>
    sortMode === 'name-desc'
      ? compareSidebarLabels(left, right, 'desc')
      : compareSidebarLabels(left, right, 'asc'),
  );
}

interface WorkspaceSidebarProps {
  folders?: WorkspaceFolder[];
  activeSidebarItem?: SidebarSelectableItem | null;
  onDownloadFile?: (fileId: string) => void;
  onRequestDownloadFolder?: (folderId: string) => void;
  highlightedItems?: SidebarSelectableItem[];
  onFileDelete?: (fileId: string) => void;
  onFolderDelete?: (folderId: string) => void;
  onFoldersChange?: (folders: WorkspaceFolder[]) => void;
  onImportFiles?: (files: File[]) => void;
  onOpenFile?: (fileId: string) => void;
  onOpenFolder?: (folderId: string) => void;
  onSelectedItemsChange?: (items: SidebarSelectableItem[]) => void;
}

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  folders: controlledFolders,
  activeSidebarItem = null,
  onDownloadFile,
  onRequestDownloadFolder,
  highlightedItems = [],
  onFileDelete,
  onFolderDelete,
  onFoldersChange,
  onOpenFile,
  onOpenFolder,
  onSelectedItemsChange,
}: WorkspaceSidebarProps) {
  const [uncontrolledFolders, setUncontrolledFolders] = useState<WorkspaceFolder[]>(
    controlledFolders ?? createWorkspaceFolders(),
  );
  const folders = controlledFolders ?? uncontrolledFolders;
  const [activeItem, setActiveItem] = useState<ActiveItem>(null);
  const [selectedItems, setSelectedItems] = useState<SidebarSelectableItem[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<ActiveItem>(null);
  const [editingItem, setEditingItem] = useState<EditingItem>(null);
  const [pendingFolderDelete, setPendingFolderDelete] =
    useState<PendingFolderDelete>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(getAllFolderIds(controlledFolders ?? createWorkspaceFolders())),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SidebarSortMode>('custom');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const deferredSortMode = useDeferredValue(sortMode);
  const searchActive = deferredSearchQuery.trim().length > 0;
  const searchableFolders = useMemo(
    () => filterWorkspaceFolders(folders, deferredSearchQuery),
    [deferredSearchQuery, folders],
  );
  const visibleFolders = useMemo(
    () =>
      deferredSortMode === 'custom'
        ? searchableFolders
        : sortSidebarFolders(searchableFolders, deferredSortMode),
    [deferredSortMode, searchableFolders],
  );
  const allSelectableItems = useMemo(
    () => collectVisibleSidebarItems(folders, new Set(getAllFolderIds(folders)), true),
    [folders],
  );
  const visibleSelectableItems = useMemo(
    () => collectVisibleSidebarItems(visibleFolders, expandedFolderIds, searchActive),
    [expandedFolderIds, searchActive, visibleFolders],
  );
  const selectedItemKeys = useMemo(
    () => new Set(selectedItems.map((item) => getSidebarItemKey(item))),
    [selectedItems],
  );
  const highlightedItemKeys = useMemo(
    () => new Set(highlightedItems.map((item) => getSidebarItemKey(item))),
    [highlightedItems],
  );

  function updateFolders(recipe: (current: WorkspaceFolder[]) => WorkspaceFolder[]) {
    const nextFolders = recipe(folders);

    if (!controlledFolders) {
      setUncontrolledFolders(nextFolders);
    }

    onFoldersChange?.(nextFolders);
  }

  useEffect(() => {
    const validKeys = new Set(allSelectableItems.map((item) => getSidebarItemKey(item)));

    setSelectedItems((current) =>
      current.filter((item) => validKeys.has(getSidebarItemKey(item))),
    );
    setActiveItem((current) =>
      current && validKeys.has(getSidebarItemKey(current)) ? current : null,
    );
    setSelectionAnchor((current) =>
      current && validKeys.has(getSidebarItemKey(current)) ? current : null,
    );
  }, [allSelectableItems]);

  useEffect(() => {
    onSelectedItemsChange?.(selectedItems);
  }, [onSelectedItemsChange, selectedItems]);

  useEffect(() => {
    if (!activeSidebarItem) {
      return;
    }

    const isValidActiveItem = allSelectableItems.some((item) =>
      areSidebarItemsEqual(item, activeSidebarItem),
    );

    if (!isValidActiveItem) {
      return;
    }

    setActiveItem(activeSidebarItem);
    setSelectedItems([activeSidebarItem]);
    setSelectionAnchor(activeSidebarItem);
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      const folderPath =
        activeSidebarItem.type === 'folder'
          ? findFolderPathById(folders, activeSidebarItem.id)
          : findFilePathById(folders, activeSidebarItem.id)?.folders ?? null;

      folderPath?.forEach((folder) => {
        next.add(folder.id);
      });

      return next;
    });
  }, [activeSidebarItem, allSelectableItems, folders]);

  function openSidebarItem(item: SidebarSelectableItem) {
    setActiveItem(item);

    if (item.type === 'file') {
      onOpenFile?.(item.id);
      return;
    }

    onOpenFolder?.(item.id);
  }

  function selectSidebarItem(
    item: SidebarSelectableItem,
    options?: {
      open?: boolean;
      shiftKey?: boolean;
    },
  ) {
    if (options?.shiftKey) {
      const anchorItem = selectionAnchor ?? activeItem ?? item;
      const anchorIndex = visibleSelectableItems.findIndex((entry) =>
        areSidebarItemsEqual(entry, anchorItem),
      );
      const targetIndex = visibleSelectableItems.findIndex((entry) =>
        areSidebarItemsEqual(entry, item),
      );

      if (anchorIndex >= 0 && targetIndex >= 0) {
        const startIndex = Math.min(anchorIndex, targetIndex);
        const endIndex = Math.max(anchorIndex, targetIndex);
        setSelectedItems(visibleSelectableItems.slice(startIndex, endIndex + 1));
        return;
      }
    }

    setSelectedItems([item]);
    setSelectionAnchor(item);

    if (options?.open) {
      openSidebarItem(item);
    }
  }

  function commitRename() {
    if (!editingItem) {
      return;
    }

    const nextLabel = editingItem.value.trim();

    if (!nextLabel) {
      setEditingItem(null);
      return;
    }

    updateFolders((current) =>
      editingItem.type === 'folder'
        ? renameFolderById(current, editingItem.id, nextLabel)
        : renameFileById(current, editingItem.id, nextLabel),
    );
    setEditingItem(null);
  }

  function deleteFolder(folderId: string) {
    updateFolders((current) => deleteFolderById(current, folderId));
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      next.delete(folderId);
      return next;
    });
    setPendingFolderDelete(null);
    setEditingItem(null);

    if (activeItem?.type === 'folder' && activeItem.id === folderId) {
      setActiveItem(null);
    }

    onFolderDelete?.(folderId);
  }

  function deleteFile(fileId: string) {
    updateFolders((current) => deleteFileById(current, fileId));
    setEditingItem(null);
    onFileDelete?.(fileId);

    if (activeItem?.type === 'file' && activeItem.id === fileId) {
      setActiveItem(null);
    }
  }

  function createFileInFolder(folderId: string) {
    const fileId = `file-${Date.now()}`;
    const nextFile: WorkspaceFile = {
      id: fileId,
      label: 'Untitled file',
      description: '',
      kind: 'brief',
    };

    updateFolders((current) => addFileToFolderById(current, folderId, nextFile));
    setExpandedFolderIds((current) => new Set(current).add(folderId));
    selectSidebarItem(
      { type: 'file', id: fileId },
      { open: true },
    );
    queueAfterMenuClose(() =>
      setEditingItem({
        type: 'file',
        id: fileId,
        value: nextFile.label,
      }),
    );
  }

  function createSeparatorInFolder(folderId: string) {
    const nextSeparator: WorkspaceSeparator = {
      id: `separator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };

    updateFolders((current) => addSeparatorToFolderById(current, folderId, nextSeparator));
    setExpandedFolderIds((current) => new Set(current).add(folderId));
  }

  function deleteSeparator(separatorId: string) {
    updateFolders((current) => deleteSeparatorById(current, separatorId));
  }

  function moveSidebarItem(
    item: WorkspaceFolderOrderEntry,
    targetParentFolderId: string | null,
    targetIndex: number,
  ) {
    if (sortMode !== 'custom') {
      setSortMode('custom');
    }

    updateFolders((current) =>
      moveWorkspaceItemById(current, item, targetParentFolderId, targetIndex),
    );

    if (targetParentFolderId) {
      setExpandedFolderIds((current) => new Set(current).add(targetParentFolderId));
    }
  }

  return (
    <>
      <Sidebar
        collapsible="icon"
        className="border-r-0 bg-transparent"
        containerClassName="rounded-none"
      >
        <div className="flex h-full bg-sidebar/95">
          <div className="flex w-(--sidebar-width-icon) shrink-0 flex-col border-r border-sidebar-border/80">
            <div className="flex h-16 items-center justify-center border-b border-sidebar-border/80 px-2">
              <SidebarTrigger className="size-9 rounded-2xl border border-sidebar-border bg-background/80 shadow-sm" />
            </div>
            <div className="mt-auto flex items-center justify-center border-t border-sidebar-border/80 p-2">
              <SettingsPopover />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <SidebarContent className="soft-scrollbar gap-0">
              <SidebarGroup className="px-4 py-4">
                <SidebarGroupContent>
                  <div className="mb-3 border-b border-sidebar-border/70 pb-3">
                    <div className="relative">
                      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search files and folders"
                        className="h-9 rounded-lg border-sidebar-border/70 bg-sidebar/40 pl-9 shadow-none"
                      />
                    </div>

                    <div className="mt-3 grid gap-2">
                      <label className="group relative flex h-9 items-center rounded-lg border border-sidebar-border/70 bg-sidebar/40 px-3 text-sm transition hover:border-sidebar-border hover:bg-sidebar/70 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
                        <span className="flex min-w-20 shrink-0 items-center text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Sort
                        </span>
                        <select
                          value={sortMode}
                          onChange={(event) =>
                            setSortMode(event.target.value as SidebarSortMode)
                          }
                          className="h-full min-w-0 flex-1 appearance-none bg-transparent pr-7 text-sm font-medium text-foreground outline-none"
                        >
                          <option value="custom">Manual order</option>
                          <option value="name-asc">Name A-Z</option>
                          <option value="name-desc">Name Z-A</option>
                          <option value="type">Type</option>
                        </select>
                        <ChevronDownIcon className="pointer-events-none absolute right-3 size-4 text-muted-foreground transition group-focus-within:text-foreground" />
                      </label>
                    </div>
                  </div>

                  <SidebarTree
                    editingItem={editingItem}
                    expandedFolderIds={expandedFolderIds}
                    folders={visibleFolders}
                    highlightedItemKeys={highlightedItemKeys}
                    selectedItemKeys={selectedItemKeys}
                    onBeginRename={setEditingItem}
                    onCancelRename={() => setEditingItem(null)}
                    onChangeRename={(value) =>
                      setEditingItem((current) =>
                        current
                          ? {
                              ...current,
                              value,
                            }
                          : current,
                      )
                    }
                    onCommitRename={commitRename}
                    onCreateFile={createFileInFolder}
                    onCreateSeparator={createSeparatorInFolder}
                    onDownloadFile={onDownloadFile}
                    onRequestDownloadFolder={onRequestDownloadFolder}
                    onDeleteFile={deleteFile}
                    onDeleteFolder={deleteFolder}
                    onDeleteSeparator={deleteSeparator}
                    onMoveItem={moveSidebarItem}
                    onRequestDeleteFolder={(folderToDelete) =>
                      setPendingFolderDelete({
                        id: folderToDelete.id,
                        label: folderToDelete.label,
                      })
                    }
                    onSelectFile={(fileId, event) =>
                      selectSidebarItem(
                        { type: 'file', id: fileId },
                        { open: !event.shiftKey, shiftKey: event.shiftKey },
                      )
                    }
                    onSelectFileForContextMenu={(fileId) =>
                      selectSidebarItem({ type: 'file', id: fileId })
                    }
                    onSelectFolder={(folderId, event) =>
                      selectSidebarItem(
                        { type: 'folder', id: folderId },
                        { open: !event.shiftKey, shiftKey: event.shiftKey },
                      )
                    }
                    onSelectFolderForContextMenu={(folderId) =>
                      selectSidebarItem({ type: 'folder', id: folderId })
                    }
                    onToggleExpanded={(folderId) =>
                      setExpandedFolderIds((current) => {
                        const next = new Set(current);

                        if (next.has(folderId)) {
                          next.delete(folderId);
                        } else {
                          next.add(folderId);
                        }

                        return next;
                      })
                    }
                    searchActive={searchActive}
                  />
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </div>
        </div>

        <SidebarRail />
      </Sidebar>

      <AlertDialog
        open={pendingFolderDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingFolderDelete(null);
          }
        }}
      >
        <AlertDialogPopup from="top">
          <AlertDialogHeader className="space-y-2">
            <AlertDialogTitle>Delete folder</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting this folder will delete all folders/files inside of it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (pendingFolderDelete) {
                  deleteFolder(pendingFolderDelete.id);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
});
