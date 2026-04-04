import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  SidebarInset,
  SidebarProvider,
} from '@/components/animate-ui/components/radix/sidebar';
import {
  createWorkspaceFolders,
  findFilePathById,
  findFolderById,
  findFolderPathById,
  type WorkspaceFolder,
} from '@/data/sidebarNavigation';
import { FileWorkspace } from '@/features/file-page/FileWorkspace';
import { WorkspaceSidebar } from './features/sidebar/WorkspaceSidebar';
import { useFilePages } from './hooks/useFilePages';

function App() {
  const [folders, setFolders] = useState<WorkspaceFolder[]>(createWorkspaceFolders);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>('general-knowledge');
  const [folderView, setFolderView] = useState<'canvas' | 'explorer'>('canvas');
  const [hoveredSidebarItem, setHoveredSidebarItem] = useState<
    | {
        type: 'folder' | 'file';
        id: string;
      }
    | null
  >(null);
  const activeFileMatch = useMemo(
    () => (openFileId ? findFilePathById(folders, openFileId) : null),
    [folders, openFileId],
  );
  const activeFile = activeFileMatch?.file ?? null;
  const activeFolder = useMemo(
    () => (openFolderId ? findFolderById(folders, openFolderId) : null),
    [folders, openFolderId],
  );
  const activeFolderPath = useMemo(
    () => (openFolderId ? findFolderPathById(folders, openFolderId) : null),
    [folders, openFolderId],
  );
  const locationSegments = useMemo(
    () =>
      activeFileMatch
        ? [...activeFileMatch.folders.map((folder) => folder.label), activeFileMatch.file.label]
        : activeFolderPath?.map((folder) => folder.label) ?? [],
    [activeFileMatch, activeFolderPath],
  );
  const {
    activePage,
    moveNodes,
    removeFilePage,
    resizeNode,
    addNode,
    updateNode,
    deleteNode,
    selectedNodeIds,
    setSelectedNodeIds,
    setView,
  } = useFilePages(activeFile);
  const activeView = activeFile ? activePage?.view ?? null : activeFolder ? folderView : null;

  const handleFileDelete = useCallback(
    (fileId: string) => {
      removeFilePage(fileId);
      setOpenFileId((current) => (current === fileId ? null : current));
    },
    [removeFilePage],
  );

  useEffect(() => {
    if (openFileId && !findFilePathById(folders, openFileId)) {
      setOpenFileId(null);
    }
  }, [folders, openFileId]);

  useEffect(() => {
    if (openFolderId && !findFolderById(folders, openFolderId)) {
      setOpenFolderId(null);
    }
  }, [folders, openFolderId]);

  useEffect(() => {
    if (activeView !== 'canvas') {
      setHoveredSidebarItem(null);
    }
  }, [activeView, activeFile?.id, activeFolder?.id]);

  return (
    <SidebarProvider
      defaultOpen
      style={
        {
          '--sidebar-width': '24rem',
          '--sidebar-width-icon': '4.25rem',
        } as React.CSSProperties
      }
      className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.10),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.08),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#f3f6fb_100%)]"
    >
      <WorkspaceSidebar
        highlightedItem={hoveredSidebarItem}
        onFoldersChange={setFolders}
        onOpenFile={(fileId) => {
          setOpenFileId(fileId);
          setOpenFolderId(null);
        }}
        onOpenFolder={(folderId) => {
          setOpenFolderId(folderId);
          setOpenFileId(null);
        }}
        onFileDelete={handleFileDelete}
      />
      <SidebarInset className="min-h-screen bg-transparent md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-0">
        <div className="flex h-full min-h-screen flex-col">
          <FileWorkspace
            activeFile={activeFile}
            activeFolder={activeFolder}
            activeView={activeView}
            locationSegments={locationSegments}
            nodes={activePage?.nodes ?? []}
            selectedNodeIds={selectedNodeIds}
            onMoveNodes={moveNodes}
            onResizeNode={resizeNode}
            onAddNode={addNode}
            onUpdateNode={updateNode}
            onDeleteNode={deleteNode}
            onSelectNodes={setSelectedNodeIds}
            onHoveredSidebarItemChange={setHoveredSidebarItem}
            onViewChange={(view) => {
              if (activeFile) {
                setView(view);
                return;
              }

              setFolderView(view);
            }}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default App;
