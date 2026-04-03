import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  SidebarInset,
  SidebarProvider,
} from '@/components/animate-ui/components/radix/sidebar';
import {
  createWorkspaceFolders,
  findFileById,
  type WorkspaceFolder,
} from '@/data/sidebarNavigation';
import { FileWorkspace } from '@/features/file-page/FileWorkspace';
import { WorkspaceSidebar } from './features/sidebar/WorkspaceSidebar';
import { useFilePages } from './hooks/useFilePages';

function App() {
  const [folders, setFolders] = useState<WorkspaceFolder[]>(createWorkspaceFolders);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const activeFile = useMemo(
    () => (openFileId ? findFileById(folders, openFileId)?.file ?? null : null),
    [folders, openFileId],
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

  const handleFileDelete = useCallback(
    (fileId: string) => {
      removeFilePage(fileId);
      setOpenFileId((current) => (current === fileId ? null : current));
    },
    [removeFilePage],
  );

  useEffect(() => {
    if (openFileId && !findFileById(folders, openFileId)) {
      setOpenFileId(null);
    }
  }, [folders, openFileId]);

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
        onFoldersChange={setFolders}
        onOpenFile={setOpenFileId}
        onFileDelete={handleFileDelete}
      />
      <SidebarInset className="min-h-screen bg-transparent">
        <div className="flex h-full min-h-screen flex-col p-4 md:p-5">
          <FileWorkspace
            activeFile={activeFile}
            activeView={activePage?.view ?? null}
            nodes={activePage?.nodes ?? []}
            selectedNodeIds={selectedNodeIds}
            onMoveNodes={moveNodes}
            onResizeNode={resizeNode}
            onAddNode={addNode}
            onUpdateNode={updateNode}
            onDeleteNode={deleteNode}
            onSelectNodes={setSelectedNodeIds}
            onViewChange={setView}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default App;
