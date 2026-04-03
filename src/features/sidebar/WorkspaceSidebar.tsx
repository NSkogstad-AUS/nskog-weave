import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  HomeIcon,
  LayoutGridIcon,
  PencilIcon,
  RefreshCcwIcon,
  SearchIcon,
  SparklesIcon,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/animate-ui/components/radix/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarRail,
  SidebarTrigger,
} from '@/components/animate-ui/components/radix/sidebar';
import { Button } from '@/components/ui/button';
import {
  createWorkspaceFolders,
  deleteFileById,
  deleteFolderById,
  filterWorkspaceFolders,
  findFileById,
  findFolderById,
  folderHasContents,
  getAllFolderIds,
  getFolderItemCount,
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

function fileKindLabel(kind: WorkspaceFile['kind']) {
  return kind.charAt(0).toUpperCase();
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <SidebarMenuItem>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <div>
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
              <SidebarMenuButton
                isActive={isActive}
                onClick={onSelect}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSelect();
                  setMenuOpen(true);
                }}
                className="h-auto items-start gap-3 py-2.5 pr-10"
                style={{ paddingLeft: `${level * 14 + 10}px` }}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-sidebar-accent text-sidebar-accent-foreground">
                  <FileTextIcon className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{file.label}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {file.description}
                  </div>
                </div>
              </SidebarMenuButton>
            )}
          </div>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>File actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setMenuOpen(false);
              onBeginRename();
            }}
          >
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Trash2Icon />
              Delete
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <DropdownMenuLabel>Are you sure you want to delete</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  onDelete();
                  setMenuOpen(false);
                }}
              >
                Yes
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMenuOpen(false)}>No</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
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
  onDeleteFolder: (folderId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onRequestDeleteFolder: (folder: WorkspaceFolder) => void;
  onSelectFile: (fileId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onToggleExpanded: (folderId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isExpanded = searchActive || expandedFolderIds.has(folder.id);
  const hasChildren = folder.children.length > 0 || folder.files.length > 0;
  const isEditing = editingItem?.type === 'folder' && editingItem.id === folder.id;
  const isActive = activeItem?.type === 'folder' && activeItem.id === folder.id;

  return (
    <SidebarMenuItem>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <div>
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
              <SidebarMenuButton
                isActive={isActive}
                onClick={() => onSelectFolder(folder.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSelectFolder(folder.id);
                  setMenuOpen(true);
                }}
                className="pr-10"
                style={{ paddingLeft: `${level * 14 + 10}px` }}
                tooltip={folder.label}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleExpanded(folder.id);
                    }}
                  >
                    <ChevronDownIcon
                      className={cn(
                        'size-3.5 transition-transform',
                        !isExpanded && '-rotate-90',
                      )}
                    />
                  </button>
                ) : (
                  <span className="w-5" />
                )}
                {isExpanded ? <FolderOpenIcon /> : <FolderIcon />}
                <span>{folder.label}</span>
              </SidebarMenuButton>
            )}
          </div>
        </DropdownMenuTrigger>

        {!isEditing ? <SidebarMenuBadge>{getFolderItemCount(folder)}</SidebarMenuBadge> : null}

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Folder actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setMenuOpen(false);
              onBeginRename({
                type: 'folder',
                id: folder.id,
                value: folder.label,
              });
            }}
          >
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          {hasChildren ? (
            <DropdownMenuItem
              onSelect={() => {
                onToggleExpanded(folder.id);
                setMenuOpen(false);
              }}
            >
              {isExpanded ? <FolderIcon /> : <FolderOpenIcon />}
              {isExpanded ? 'Collapse' : 'Expand'}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              setMenuOpen(false);

              if (folderHasContents(folder)) {
                onRequestDeleteFolder(folder);
                return;
              }

              onDeleteFolder(folder.id);
            }}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isExpanded && hasChildren ? (
        <SidebarMenuSub>
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
      ) : null}
    </SidebarMenuItem>
  );
}

export function WorkspaceSidebar() {
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

    if (activeItem?.type === 'file' && activeItem.id === fileId) {
      setActiveItem(null);
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
          <div className="flex w-[4.25rem] shrink-0 flex-col border-r border-sidebar-border/80">
            <div className="flex h-16 items-center justify-center border-b border-sidebar-border/80">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_18px_34px_-24px_rgba(15,23,42,0.7)]">
                <SparklesIcon className="size-4.5" />
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
                        onDeleteFolder={deleteFolder}
                        onDeleteFile={deleteFile}
                        onRequestDeleteFolder={(folderToDelete) =>
                          setPendingFolderDelete({
                            id: folderToDelete.id,
                            label: folderToDelete.label,
                          })
                        }
                        onSelectFile={(fileId) => setActiveItem({ type: 'file', id: fileId })}
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
