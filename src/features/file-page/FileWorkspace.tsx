import { useCallback } from 'react';
import { FileTextIcon } from 'lucide-react';

import type { WorkspaceFile, WorkspaceFolder } from '@/data/sidebarNavigation';
import type { FilePageNode, FilePageNodeSize, FilePageView } from '@/types/filePage';
import type { Point } from '@/types/geometry';
import { FileWorkspaceHeader } from './FileWorkspaceHeader';
import { FileCanvasView } from './FileCanvasView';
import { FileExplorerView } from './FileExplorerView';
import { useFolderCanvasState } from './useFolderCanvasState';

interface FileWorkspaceProps {
  activeFile: WorkspaceFile | null;
  activeFolder: WorkspaceFolder | null;
  activeView: FilePageView | null;
  locationSegments: string[];
  nodes: FilePageNode[];
  selectedNodeIds: string[];
  onMoveNodes: (positions: Record<string, Point>) => void;
  onResizeNode: (nodeId: string, size: FilePageNodeSize) => void;
  onAddNode: (node: FilePageNode) => void;
  onUpdateNode: (
    nodeId: string,
    updates: Partial<Pick<FilePageNode, 'label' | 'description' | 'icon' | 'size'>>,
  ) => void;
  onDeleteNode: (nodeId: string) => void;
  onSelectNodes: (nodeIds: string[]) => void;
  onHoveredSidebarItemChange: (
    item:
      | {
          type: 'folder' | 'file';
          id: string;
        }
      | null,
  ) => void;
  onViewChange: (view: FilePageView) => void;
}

export function FileWorkspace({
  activeFile,
  activeFolder,
  activeView,
  locationSegments,
  nodes,
  selectedNodeIds,
  onMoveNodes,
  onResizeNode,
  onAddNode,
  onUpdateNode,
  onDeleteNode,
  onSelectNodes,
  onHoveredSidebarItemChange,
  onViewChange,
}: FileWorkspaceProps) {
  const folderCanvasState = useFolderCanvasState(activeFolder);
  const displayNodes = activeFile ? nodes : folderCanvasState.activeNodes;
  const displaySelectedNodeIds = activeFile
    ? selectedNodeIds
    : folderCanvasState.activeSelectedNodeIds;
  const pageEyebrow = activeFile ? 'File' : 'Folder';
  const breadcrumbPrefix = locationSegments.slice(0, -1).join('/');
  const breadcrumbCurrent = locationSegments.at(-1) ?? '';
  const handleHoverNodeChange = useCallback(
    (node: FilePageNode | null) => {
      if (!node) {
        onHoveredSidebarItemChange(null);
        return;
      }

      if (node.id.startsWith('folder:')) {
        onHoveredSidebarItemChange({
          type: 'folder',
          id: node.id.slice('folder:'.length),
        });
        return;
      }

      if (node.id.startsWith('file:')) {
        onHoveredSidebarItemChange({
          type: 'file',
          id: node.id.slice('file:'.length),
        });
        return;
      }

      onHoveredSidebarItemChange(null);
    },
    [onHoveredSidebarItemChange],
  );

  if ((!activeFile && !activeFolder) || !activeView) {
    return (
      <div className="flex h-full min-h-[34rem] items-center justify-center rounded-none border border-dashed border-slate-200 bg-white/60 px-8 text-center shadow-[0_32px_90px_-62px_rgba(15,23,42,0.2)]">
        <div className="max-w-sm">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm">
            <FileTextIcon className="size-6 text-slate-500" />
          </div>
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-slate-950">
            Select a file
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Every file opens its own page. Once a file is selected, you can switch between a minimal canvas and a traditional explorer layout.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <FileWorkspaceHeader
          activeView={activeView}
          breadcrumbCurrent={breadcrumbCurrent}
          breadcrumbPrefix={breadcrumbPrefix}
          pageEyebrow={pageEyebrow}
          onViewChange={onViewChange}
        />

        {activeView === 'canvas' ? (
          <FileCanvasView
            nodes={displayNodes}
            selectedNodeIds={displaySelectedNodeIds}
            onMoveNodes={activeFile ? onMoveNodes : folderCanvasState.moveNodes}
            onResizeNode={activeFile ? onResizeNode : folderCanvasState.resizeNode}
            onAddNode={activeFile ? onAddNode : folderCanvasState.addNode}
            onUpdateNode={activeFile ? onUpdateNode : folderCanvasState.updateNode}
            onDeleteNode={activeFile ? onDeleteNode : folderCanvasState.deleteNode}
            onHoverNodeChange={handleHoverNodeChange}
            onSelectNodes={activeFile ? onSelectNodes : folderCanvasState.selectNodes}
          />
        ) : (
          <FileExplorerView
            className="pt-24"
            nodes={displayNodes}
            selectedNodeIds={displaySelectedNodeIds}
            onSelectNode={(nodeId) =>
              (activeFile ? onSelectNodes : folderCanvasState.selectNodes)([nodeId])
            }
          />
        )}
      </div>
    </div>
  );
}
