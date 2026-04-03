import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  FileTextIcon,
  FilePlus2Icon,
  FolderIcon,
  FolderOpenIcon,
  HomeIcon,
  LayoutGridIcon,
  PencilIcon,
  RefreshCcwIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';

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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarRail,
  SidebarTrigger,
} from '@/components/animate-ui/components/radix/sidebar';
import { Button } from '@/components/ui/button';
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
  addFileToFolderById,
  createWorkspaceFolders,
  deleteFileById,
  deleteFolderById,
  filterWorkspaceFolders,
  findFileById,
  findFolderById,
  folderHasContents,
  getAllFolderIds,
  getFolderDescendantCounts,
  renameFileById,
  renameFolderById,
  type WorkspaceFile,
  type WorkspaceFolder,
} from '@/data/sidebarNavigation';
import { cn } from '@/lib/utils';

type ActiveItem =
  | { type: 'folder'; id: string }
  | { type: 'file'; id: string }
  | null;

type EditingItem =
  | { type: 'folder'; id: string; value: string }
  | { type: 'file'; id: string; value: string }
  | null;

type PendingFolderDelete =
  | {
      id: string;
      label: string;
    }
  | null;

const sidebarSections = [
  {
    id: 'knowledge',
    label: 'Knowledge Base',
    icon: HomeIcon,
    active: true,
  },
  {
    id: 'dashboards',
    label: 'Dashboards',
    icon: LayoutGridIcon,
    active: false,
  },
] as const;

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

function getFileRowPaddingLeft(level: number) {
  return getRowPaddingLeft(level);
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

function FileRow({
  file,
  isActive,
  isEditing,
  editValue,
  level,
  onBeginRename,
  onCancelRename,
  onChangeRename,
  onCommitRename,
  onDelete,
  onSelect,
}: {
  file: WorkspaceFile;
  isActive: boolean;
  isEditing: boolean;
  editValue: string;
  level: number;
  onBeginRename: () => void;
  onCancelRename: () => void;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onDelete: () => void;
  onSelect: () => void;
}) {
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
              isActive={isActive}
              onClick={onSelect}
              onDoubleClick={() => onBeginRename()}
              onContextMenu={() => onSelect()}
              className="w-full pr-10 data-[active=true]:bg-sidebar-accent/45"
              style={{ paddingLeft: `${getFileRowPaddingLeft(level)}px` }}
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
                onSelect();
                queueAfterMenuClose(onBeginRename);
              }}
            >
              <PencilIcon />
              Rename
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Trash2Icon className="size-4 shrink-0" />
                Delete
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="ml-2 w-52">
                <ContextMenuLabel>Are you sure you want to delete</ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => {
                    onDelete();
                  }}
                >
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

function FolderRow({
  folder,
  level,
  searchActive,
  expandedFolderIds,
  activeItem,
  editingItem,
  onBeginRename,
  onCancelRename,
  onChangeRename,
  onCommitRename,
  onCreateFile,
  onDeleteFolder,
  onDeleteFile,
  onRequestDeleteFolder,
  onSelectFile,
  onSelectFolder,
  onToggleExpanded,
}: {
  folder: WorkspaceFolder;
  level: number;
  searchActive: boolean;
  expandedFolderIds: Set<string>;
  activeItem: ActiveItem;
  editingItem: EditingItem;
  onBeginRename: (item: EditingItem) => void;
  onCancelRename: () => void;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onCreateFile: (folderId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onRequestDeleteFolder: (folder: WorkspaceFolder) => void;
  onSelectFile: (fileId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onToggleExpanded: (folderId: string) => void;
}) {
  const isExpanded = searchActive || expandedFolderIds.has(folder.id);
  const hasChildren = folder.children.length > 0 || folder.files.length > 0;
  const isEditing = editingItem?.type === 'folder' && editingItem.id === folder.id;
  const isActive = activeItem?.type === 'folder' && activeItem.id === folder.id;
  const descendantCounts = getFolderDescendantCounts(folder);
  const totalDescendants = descendantCounts.folders + descendantCounts.files;

  return (
    <SidebarMenuItem className="relative w-full">
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
                isActive={isActive}
                onClick={() => onToggleExpanded(folder.id)}
                onDoubleClick={() =>
                  onBeginRename({
                    type: 'folder',
                    id: folder.id,
                    value: folder.label,
                  })
                }
                onContextMenu={() => onSelectFolder(folder.id)}
                className="w-full overflow-visible pr-14 data-[active=true]:bg-sidebar-accent/45"
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
                    className={cn(
                      'ml-[1px] size-3.5 transition-transform',
                      !isExpanded && '-rotate-90',
                    )}
                  />
                </button>
                {isExpanded ? (
                  <FolderOpenIcon className="ml-[0px]" />
                ) : (
                  <FolderIcon className="ml-[0px]" />
                )}
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
                onSelectFolder(folder.id);
                onCreateFile(folder.id);
              }}
            >
              <FilePlus2Icon />
              Add file
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                onSelectFolder(folder.id);
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
            {hasChildren ? (
              <ContextMenuItem
                onSelect={() => {
                  onToggleExpanded(folder.id);
                }}
              >
                {isExpanded ? <FolderIcon /> : <FolderOpenIcon />}
                {isExpanded ? 'Collapse' : 'Expand'}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              variant="destructive"
              onSelect={() => {
                onSelectFolder(folder.id);

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
            <SidebarMenuSub
              className={cn(
                'mr-0 border-l-0 px-0 pl-2.5 pr-0',
                !isExpanded && 'pointer-events-none',
              )}
            >
              {folder.children.map((childFolder) => (
                <FolderRow
                  key={childFolder.id}
                  folder={childFolder}
                  level={level + 1}
                  searchActive={searchActive}
                  expandedFolderIds={expandedFolderIds}
                  activeItem={activeItem}
                  editingItem={editingItem}
                  onBeginRename={onBeginRename}
                  onCancelRename={onCancelRename}
                  onChangeRename={onChangeRename}
                  onCommitRename={onCommitRename}
                  onCreateFile={onCreateFile}
                  onDeleteFolder={onDeleteFolder}
                  onDeleteFile={onDeleteFile}
                  onRequestDeleteFolder={onRequestDeleteFolder}
                  onSelectFile={onSelectFile}
                  onSelectFolder={onSelectFolder}
                  onToggleExpanded={onToggleExpanded}
                />
              ))}

              {folder.files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  isActive={activeItem?.type === 'file' && activeItem.id === file.id}
                  isEditing={editingItem?.type === 'file' && editingItem.id === file.id}
                  editValue={
                    editingItem?.type === 'file' && editingItem.id === file.id
                      ? editingItem.value
                      : file.label
                  }
                  level={level + 1}
                  onBeginRename={() =>
                    onBeginRename({
                      type: 'file',
                      id: file.id,
                      value: file.label,
                    })
                  }
                  onCancelRename={onCancelRename}
                  onChangeRename={onChangeRename}
                  onCommitRename={onCommitRename}
                  onDelete={() => onDeleteFile(file.id)}
                  onSelect={() => onSelectFile(file.id)}
                />
              ))}
            </SidebarMenuSub>
          </div>
        </div>
      ) : null}
    </SidebarMenuItem>
  );
}

interface WorkspaceSidebarProps {
  onFileDelete?: (fileId: string) => void;
  onFoldersChange?: (folders: WorkspaceFolder[]) => void;
  onOpenFile?: (fileId: string) => void;
}

export function WorkspaceSidebar({
  onFileDelete,
  onFoldersChange,
  onOpenFile,
}: WorkspaceSidebarProps) {
  const [folders, setFolders] = useState<WorkspaceFolder[]>(createWorkspaceFolders);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeItem, setActiveItem] = useState<ActiveItem>({
    type: 'folder',
    id: 'general-knowledge',
  });
  const [editingItem, setEditingItem] = useState<EditingItem>(null);
  const [pendingFolderDelete, setPendingFolderDelete] =
    useState<PendingFolderDelete>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(getAllFolderIds(createWorkspaceFolders())),
  );
  const searchActive = searchQuery.trim().length > 0;
  const visibleFolders = useMemo(
    () => filterWorkspaceFolders(folders, searchQuery),
    [folders, searchQuery],
  );

  useEffect(() => {
    onFoldersChange?.(folders);
  }, [folders, onFoldersChange]);

  function resetSidebar() {
    const nextFolders = createWorkspaceFolders();

    setFolders(nextFolders);
    setSearchQuery('');
    setActiveItem({ type: 'folder', id: 'general-knowledge' });
    setEditingItem(null);
    setPendingFolderDelete(null);
    setExpandedFolderIds(new Set(getAllFolderIds(nextFolders)));
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

    setFolders((current) =>
      editingItem.type === 'folder'
        ? renameFolderById(current, editingItem.id, nextLabel)
        : renameFileById(current, editingItem.id, nextLabel),
    );
    setEditingItem(null);
  }

  function deleteFolder(folderId: string) {
    setFolders((current) => deleteFolderById(current, folderId));
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
  }

  function deleteFile(fileId: string) {
    setFolders((current) => deleteFileById(current, fileId));
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

    setFolders((current) => addFileToFolderById(current, folderId, nextFile));
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

  return (
    <>
      <Sidebar
        collapsible="icon"
        className="border-r-0 bg-transparent"
        containerClassName="rounded-none"
      >
        <div className="flex h-full bg-sidebar/95">
          <div className="flex w-[4.25rem] shrink-0 flex-col border-r border-sidebar-border/80">
            <div className="flex h-16 items-center justify-center border-b border-sidebar-border/80">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl">
                <img
                  src="/weave2.svg"
                  alt="Weave"
                  className="size-[1.625rem]"
                />
              </div>
            </div>

            <SidebarContent className="items-center gap-3 overflow-visible px-2 py-3">
              <SidebarMenu className="items-center gap-2">
                {sidebarSections.map((section) => {
                  const Icon = section.icon;

                  return (
                    <SidebarMenuItem key={section.id}>
                      <SidebarMenuButton
                        size="lg"
                        isActive={section.active}
                        tooltip={section.label}
                        className="justify-center px-0"
                      >
                        <Icon />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarContent>

            <div className="mt-auto flex flex-col items-center gap-2 border-t border-sidebar-border/80 px-2 py-3">
              <SidebarTrigger className="size-9 rounded-2xl border border-sidebar-border bg-background/80 shadow-sm" />
              <Button
                variant="ghost"
                size="icon"
                className="size-9 rounded-2xl"
                onClick={resetSidebar}
              >
                <RefreshCcwIcon />
                <span className="sr-only">Reset sidebar</span>
              </Button>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <SidebarHeader className="gap-3 border-b border-sidebar-border/80 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                Workspace
              </div>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <SidebarInput
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search"
                  className="pl-9"
                />
              </div>
            </SidebarHeader>

            <SidebarContent className="soft-scrollbar gap-0">
              <SidebarGroup className="px-4 pt-4">
                <SidebarGroupLabel className="px-0 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                  Folders
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleFolders.map((folder) => (
                      <FolderRow
                        key={folder.id}
                        folder={folder}
                        level={0}
                        searchActive={searchActive}
                        expandedFolderIds={expandedFolderIds}
                        activeItem={activeItem}
                        editingItem={editingItem}
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
                        onDeleteFolder={deleteFolder}
                        onDeleteFile={deleteFile}
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
                        onSelectFolder={(folderId) =>
                          setActiveItem({ type: 'folder', id: folderId })
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
                      />
                    ))}
                  </SidebarMenu>
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
}
