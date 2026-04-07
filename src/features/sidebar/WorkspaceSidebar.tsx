import { memo, useMemo, useState } from 'react';

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
  moveSeparatorById,
  renameFileById,
  renameFolderById,
  type WorkspaceFile,
  type WorkspaceFolder,
  type WorkspaceSeparator,
} from '@/data/sidebarNavigation';
import { SidebarTree, type ActiveItem, type EditingItem } from './sidebar-tree';

type PendingFolderDelete =
  | {
      id: string;
      label: string;
    }
  | null;

function queueAfterMenuClose(callback: () => void) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

interface WorkspaceSidebarProps {
  folders?: WorkspaceFolder[];
  highlightedItem?: ActiveItem;
  onFileDelete?: (fileId: string) => void;
  onFolderDelete?: (folderId: string) => void;
  onFoldersChange?: (folders: WorkspaceFolder[]) => void;
  onImportFiles?: (files: File[]) => void;
  onOpenFile?: (fileId: string) => void;
  onOpenFolder?: (folderId: string) => void;
}

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  folders: controlledFolders,
  highlightedItem = null,
  onFileDelete,
  onFolderDelete,
  onFoldersChange,
  onOpenFile,
  onOpenFolder,
}: WorkspaceSidebarProps) {
  const [uncontrolledFolders, setUncontrolledFolders] = useState<WorkspaceFolder[]>(
    controlledFolders ?? createWorkspaceFolders(),
  );
  const folders = controlledFolders ?? uncontrolledFolders;
  const [activeItem, setActiveItem] = useState<ActiveItem>(null);
  const [editingItem, setEditingItem] = useState<EditingItem>(null);
  const [pendingFolderDelete, setPendingFolderDelete] =
    useState<PendingFolderDelete>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(getAllFolderIds(controlledFolders ?? createWorkspaceFolders())),
  );
  const searchActive = false;
  const visibleFolders = useMemo(
    () => filterWorkspaceFolders(folders, ''),
    [folders],
  );

  function updateFolders(recipe: (current: WorkspaceFolder[]) => WorkspaceFolder[]) {
    const nextFolders = recipe(folders);

    if (!controlledFolders) {
      setUncontrolledFolders(nextFolders);
    }

    onFoldersChange?.(nextFolders);
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
    setActiveItem({ type: 'file', id: fileId });
    onOpenFile?.(fileId);
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

  function moveSeparator(
    separatorId: string,
    targetFolderId: string,
    targetIndex: number,
  ) {
    updateFolders((current) => moveSeparatorById(current, separatorId, targetFolderId, targetIndex));
    setExpandedFolderIds((current) => new Set(current).add(targetFolderId));
  }

  return (
    <>
      <Sidebar
        collapsible="icon"
        className="border-r-0 bg-transparent"
        containerClassName="rounded-none"
      >
        <div className="flex h-full bg-sidebar/95">
          <div className="flex w-[4.25rem] shrink-0 flex-col border-r border-sidebar-border/80">
            <div className="flex h-16 items-center justify-center border-b border-sidebar-border/80 px-2">
              <SidebarTrigger className="size-9 rounded-2xl border border-sidebar-border bg-background/80 shadow-sm" />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <SidebarContent className="soft-scrollbar gap-0">
              <SidebarGroup className="px-4 py-4">
                <SidebarGroupContent>
                  <SidebarTree
                    activeItem={activeItem}
                    editingItem={editingItem}
                    expandedFolderIds={expandedFolderIds}
                    folders={visibleFolders}
                    highlightedItem={highlightedItem}
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
                    onDeleteFile={deleteFile}
                    onDeleteFolder={deleteFolder}
                    onDeleteSeparator={deleteSeparator}
                    onMoveSeparator={moveSeparator}
                    onRequestDeleteFolder={(folderToDelete) =>
                      setPendingFolderDelete({
                        id: folderToDelete.id,
                        label: folderToDelete.label,
                      })
                    }
                    onSelectFile={(fileId) => {
                      setActiveItem({ type: 'file', id: fileId });
                      onOpenFile?.(fileId);
                    }}
                    onSelectFolder={(folderId) => {
                      setActiveItem({ type: 'folder', id: folderId });
                      onOpenFolder?.(folderId);
                    }}
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
