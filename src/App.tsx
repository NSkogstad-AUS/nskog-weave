import { startTransition, useState } from 'react';

import { SidebarProvider } from '@/components/animate-ui/components/radix/sidebar';
import { WorkspaceSidebar } from './features/sidebar/WorkspaceSidebar';
import { useWorkspace } from './hooks/useWorkspace';

function App() {
  const { workspace, actions } = useWorkspace();
  const [activeFolderId, setActiveFolderId] = useState('general-knowledge');

  return (
    <SidebarProvider
      defaultOpen
      style={
        {
          '--sidebar-width': '24rem',
          '--sidebar-width-icon': '4.25rem',
        } as React.CSSProperties
      }
      className="min-h-screen w-fit bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.12),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.10),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#f3f6fb_100%)]"
    >
      <WorkspaceSidebar
        activeFolderId={activeFolderId}
        onResetDemo={actions.resetDemoWorkspace}
        onSearchChange={(value) => {
          startTransition(() => {
            actions.setSearchQuery(value);
          });
        }}
        onSelectFolder={setActiveFolderId}
        searchQuery={workspace.searchQuery}
      />
    </SidebarProvider>
  );
}

export default App;
