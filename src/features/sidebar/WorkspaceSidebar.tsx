import {
  FolderIcon,
  FolderOpenIcon,
  HomeIcon,
  LayoutGridIcon,
  RefreshCcwIcon,
  SearchIcon,
  SparklesIcon,
} from 'lucide-react';

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
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/animate-ui/components/radix/sidebar';
import { Button } from '@/components/ui/button';
import { workspaceFolders, type WorkspaceFolder } from '@/data/sidebarNavigation';

interface WorkspaceSidebarProps {
  activeFolderId: string;
  searchQuery: string;
  onResetDemo: () => void;
  onSearchChange: (value: string) => void;
  onSelectFolder: (folderId: string) => void;
}

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

function renderFolderTree(
  folders: WorkspaceFolder[],
  activeFolderId: string,
  onSelectFolder: (folderId: string) => void,
  level = 0,
) {
  if (level === 0) {
    return folders.map((folder) => (
      <SidebarMenuItem key={folder.id}>
        <SidebarMenuButton
          isActive={activeFolderId === folder.id}
          onClick={() => onSelectFolder(folder.id)}
          className="pr-9"
          tooltip={folder.label}
        >
          {activeFolderId === folder.id ? <FolderOpenIcon /> : <FolderIcon />}
          <span>{folder.label}</span>
        </SidebarMenuButton>
        <SidebarMenuBadge>{folder.count}</SidebarMenuBadge>
        {folder.children?.length ? (
          <SidebarMenuSub>{renderFolderTree(folder.children, activeFolderId, onSelectFolder, level + 1)}</SidebarMenuSub>
        ) : null}
      </SidebarMenuItem>
    ));
  }

  return folders.map((folder) => (
    <SidebarMenuSubItem key={folder.id}>
      <SidebarMenuSubButton
        href="#"
        isActive={activeFolderId === folder.id}
        onClick={(event) => {
          event.preventDefault();
          onSelectFolder(folder.id);
        }}
      >
        {activeFolderId === folder.id ? <FolderOpenIcon /> : <FolderIcon />}
        <span>{folder.label}</span>
        <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/70">
          {folder.count}
        </span>
      </SidebarMenuSubButton>
      {folder.children?.length ? (
        <SidebarMenuSub>{renderFolderTree(folder.children, activeFolderId, onSelectFolder, level + 1)}</SidebarMenuSub>
      ) : null}
    </SidebarMenuSubItem>
  ));
}

export function WorkspaceSidebar({
  activeFolderId,
  searchQuery,
  onResetDemo,
  onSearchChange,
  onSelectFolder,
}: WorkspaceSidebarProps) {
  return (
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
              onClick={onResetDemo}
            >
              <RefreshCcwIcon />
              <span className="sr-only">Reset demo workspace</span>
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
                onChange={(event) => onSearchChange(event.target.value)}
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
                <SidebarMenu>{renderFolderTree(workspaceFolders, activeFolderId, onSelectFolder)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </div>
      </div>

      <SidebarRail />
    </Sidebar>
  );
}
