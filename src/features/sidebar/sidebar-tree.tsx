import { useEffect, useRef } from 'react';
import {
  ChevronDownIcon,
  FilePlus2Icon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
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
  type WorkspaceFile,
  type WorkspaceFolder,
} from '@/data/sidebarNavigation';
import { cn } from '@/lib/utils';

export type ActiveItem =
  | { type: 'folder'; id: string }
  | { type: 'file'; id: string }
  | null;

export type EditingItem =
  | { type: 'folder'; id: string; value: string }
  | { type: 'file'; id: string; value: string }
  | null;

const SIDEBAR_HIGHLIGHT_CLASS =
  'bg-sidebar-accent/30 text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgba(71,85,105,0.55)]';

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
  editValue,
  file,
  isActive,
  isEditing,
  isHighlighted,
  level,
  onBeginRename,
  onCancelRename,
  onChangeRename,
  onCommitRename,
  onDelete,
  onSelect,
}: {
  editValue: string;
  file: WorkspaceFile;
  isActive: boolean;
  isEditing: boolean;
  isHighlighted: boolean;
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
              onDoubleClick={onBeginRename}
              onContextMenu={onSelect}
              className={cn(
                'w-full pr-10 data-[active=true]:bg-sidebar-accent/45',
                isHighlighted && !isActive && SIDEBAR_HIGHLIGHT_CLASS,
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

function FolderRow({
  activeItem,
  editingItem,
  expandedFolderIds,
  folder,
  highlightedItem,
  level,
  onBeginRename,
  onCancelRename,
  onChangeRename,
  onCommitRename,
  onCreateFile,
  onDeleteFile,
  onDeleteFolder,
  onRequestDeleteFolder,
  onSelectFile,
  onSelectFolder,
  onToggleExpanded,
  searchActive,
}: {
  activeItem: ActiveItem;
  editingItem: EditingItem;
  expandedFolderIds: Set<string>;
  folder: WorkspaceFolder;
  highlightedItem: ActiveItem;
  level: number;
  onBeginRename: (item: EditingItem) => void;
  onCancelRename: () => void;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onCreateFile: (folderId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onRequestDeleteFolder: (folder: WorkspaceFolder) => void;
  onSelectFile: (fileId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onToggleExpanded: (folderId: string) => void;
  searchActive: boolean;
}) {
  const isExpanded = searchActive || expandedFolderIds.has(folder.id);
  const hasChildren = folder.children.length > 0 || folder.files.length > 0;
  const isEditing = editingItem?.type === 'folder' && editingItem.id === folder.id;
  const isActive = activeItem?.type === 'folder' && activeItem.id === folder.id;
  const isHighlighted = highlightedItem?.type === 'folder' && highlightedItem.id === folder.id;
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
                onClick={() => onSelectFolder(folder.id)}
                onDoubleClick={() =>
                  onBeginRename({
                    type: 'folder',
                    id: folder.id,
                    value: folder.label,
                  })
                }
                onContextMenu={() => onSelectFolder(folder.id)}
                className={cn(
                  'w-full overflow-visible pr-14 data-[active=true]:bg-sidebar-accent/45',
                  isHighlighted && !isActive && SIDEBAR_HIGHLIGHT_CLASS,
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
              <ContextMenuItem onSelect={() => onToggleExpanded(folder.id)}>
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
            <SidebarMenuSub className={cn('mr-0 border-l-0 px-0 pl-2.5 pr-0', !isExpanded && 'pointer-events-none')}>
              {folder.children.map((childFolder) => (
                <FolderRow
                  key={childFolder.id}
                  activeItem={activeItem}
                  editingItem={editingItem}
                  expandedFolderIds={expandedFolderIds}
                  folder={childFolder}
                  highlightedItem={highlightedItem}
                  level={level + 1}
                  onBeginRename={onBeginRename}
                  onCancelRename={onCancelRename}
                  onChangeRename={onChangeRename}
                  onCommitRename={onCommitRename}
                  onCreateFile={onCreateFile}
                  onDeleteFile={onDeleteFile}
                  onDeleteFolder={onDeleteFolder}
                  onRequestDeleteFolder={onRequestDeleteFolder}
                  onSelectFile={onSelectFile}
                  onSelectFolder={onSelectFolder}
                  onToggleExpanded={onToggleExpanded}
                  searchActive={searchActive}
                />
              ))}

              {folder.files.map((file) => (
                <FileRow
                  key={file.id}
                  editValue={
                    editingItem?.type === 'file' && editingItem.id === file.id
                      ? editingItem.value
                      : file.label
                  }
                  file={file}
                  isActive={activeItem?.type === 'file' && activeItem.id === file.id}
                  isEditing={editingItem?.type === 'file' && editingItem.id === file.id}
                  isHighlighted={highlightedItem?.type === 'file' && highlightedItem.id === file.id}
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

interface SidebarTreeProps {
  activeItem: ActiveItem;
  editingItem: EditingItem;
  expandedFolderIds: Set<string>;
  folders: WorkspaceFolder[];
  highlightedItem: ActiveItem;
  onBeginRename: (item: EditingItem) => void;
  onCancelRename: () => void;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onCreateFile: (folderId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onRequestDeleteFolder: (folder: WorkspaceFolder) => void;
  onSelectFile: (fileId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onToggleExpanded: (folderId: string) => void;
  searchActive: boolean;
}

export function SidebarTree({
  activeItem,
  editingItem,
  expandedFolderIds,
  folders,
  highlightedItem,
  onBeginRename,
  onCancelRename,
  onChangeRename,
  onCommitRename,
  onCreateFile,
  onDeleteFile,
  onDeleteFolder,
  onRequestDeleteFolder,
  onSelectFile,
  onSelectFolder,
  onToggleExpanded,
  searchActive,
}: SidebarTreeProps) {
  return (
    <SidebarMenu>
      {folders.map((folder) => (
        <FolderRow
          key={folder.id}
          activeItem={activeItem}
          editingItem={editingItem}
          expandedFolderIds={expandedFolderIds}
          folder={folder}
          highlightedItem={highlightedItem}
          level={0}
          onBeginRename={onBeginRename}
          onCancelRename={onCancelRename}
          onChangeRename={onChangeRename}
          onCommitRename={onCommitRename}
          onCreateFile={onCreateFile}
          onDeleteFile={onDeleteFile}
          onDeleteFolder={onDeleteFolder}
          onRequestDeleteFolder={onRequestDeleteFolder}
          onSelectFile={onSelectFile}
          onSelectFolder={onSelectFolder}
          onToggleExpanded={onToggleExpanded}
          searchActive={searchActive}
        />
      ))}
    </SidebarMenu>
  );
}
