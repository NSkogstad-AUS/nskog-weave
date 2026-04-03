import { useEffect, useMemo, useState } from 'react';
import { FileTextIcon, LayoutGridIcon, ListIcon } from 'lucide-react';

import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/animate-ui/components/radix/toggle-group';
import type { WorkspaceFile, WorkspaceFolder } from '@/data/sidebarNavigation';
import type { FilePageElementIcon, FilePageNode, FilePageView } from '@/types/filePage';
import { FileCanvasView } from './FileCanvasView';
import { FileExplorerView } from './FileExplorerView';

interface FileWorkspaceProps {
  activeFile: WorkspaceFile | null;
  activeFolder: WorkspaceFolder | null;
  activeView: FilePageView | null;
  nodes: Array<{
    id: string;
    label: string;
    description: string;
    kind: 'folder' | 'file' | 'element';
    icon: FilePageElementIcon;
    position: { x: number; y: number };
    size: {
      widthUnits: 1 | 2 | 3;
      heightUnits: 1 | 2 | 3;
    };
  }>;
  selectedNodeIds: string[];
  onMoveNodes: (positions: Record<string, { x: number; y: number }>) => void;
  onResizeNode: (
    nodeId: string,
    size: {
      widthUnits: 1 | 2 | 3;
      heightUnits: 1 | 2 | 3;
    },
  ) => void;
  onAddNode: (node: {
    id: string;
    label: string;
    description: string;
    kind: 'folder' | 'file' | 'element';
    icon: FilePageElementIcon;
    position: { x: number; y: number };
    size: {
      widthUnits: 1 | 2 | 3;
      heightUnits: 1 | 2 | 3;
    };
  }) => void;
  onUpdateNode: (
    nodeId: string,
    updates: Partial<{
      label: string;
      description: string;
      icon: FilePageElementIcon;
      size: {
        widthUnits: 1 | 2 | 3;
        heightUnits: 1 | 2 | 3;
      };
    }>,
  ) => void;
  onDeleteNode: (nodeId: string) => void;
  onSelectNodes: (nodeIds: string[]) => void;
  onViewChange: (view: FilePageView) => void;
}

export function FileWorkspace({
  activeFile,
  activeFolder,
  activeView,
  nodes,
  selectedNodeIds,
  onMoveNodes,
  onResizeNode,
  onAddNode,
  onUpdateNode,
  onDeleteNode,
  onSelectNodes,
  onViewChange,
}: FileWorkspaceProps) {
  const folderNodes = useMemo<FilePageNode[]>(() => {
    if (!activeFolder) {
      return [];
    }

    const childFolderNodes = activeFolder.children.map((folder, index) => ({
      id: `folder:${folder.id}`,
      label: folder.label,
      description: `${folder.children.length} folders · ${folder.files.length} files`,
      kind: 'folder' as const,
      icon: 'shapes' as const,
      position: {
        x: 72 + (index % 3) * 224,
        y: 104 + Math.floor(index / 3) * 112,
      },
      size: {
        widthUnits: 1 as const,
        heightUnits: 1 as const,
      },
    }));
    const fileNodes = activeFolder.files.map((file, index) => ({
      id: `file:${file.id}`,
      label: file.label,
      description: file.description,
      kind: 'file' as const,
      icon: 'message-square' as const,
      position: {
        x: 72 + ((childFolderNodes.length + index) % 3) * 224,
        y: 104 + Math.floor((childFolderNodes.length + index) / 3) * 112,
      },
      size: {
        widthUnits: 2 as const,
        heightUnits: 1 as const,
      },
    }));

    return [...childFolderNodes, ...fileNodes];
  }, [activeFolder]);
  const [folderCanvasNodes, setFolderCanvasNodes] = useState<Record<string, FilePageNode[]>>({});
  const [folderSelectedNodeIds, setFolderSelectedNodeIds] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!activeFolder) {
      return;
    }

    setFolderCanvasNodes((current) => {
      const existingNodes = current[activeFolder.id];

      if (!existingNodes) {
        return {
          ...current,
          [activeFolder.id]: folderNodes,
        };
      }

      const existingById = new Map(existingNodes.map((node) => [node.id, node]));
      const mergedNodes = folderNodes.map((node) => {
        const existingNode = existingById.get(node.id);

        return existingNode
          ? {
              ...node,
              position: existingNode.position,
              size: existingNode.size,
              icon: existingNode.icon,
            }
          : node;
      });

      return {
        ...current,
        [activeFolder.id]: mergedNodes,
      };
    });
  }, [activeFolder, folderNodes]);

  const activeFolderNodes = activeFolder ? folderCanvasNodes[activeFolder.id] ?? folderNodes : [];
  const activeFolderSelectedNodeIds = activeFolder
    ? folderSelectedNodeIds[activeFolder.id] ?? []
    : [];
  const displayNodes = activeFile ? nodes : activeFolderNodes;
  const displaySelectedNodeIds = activeFile ? selectedNodeIds : activeFolderSelectedNodeIds;

  if ((!activeFile && !activeFolder) || !activeView) {
    return (
      <div className="flex h-full min-h-[34rem] items-center justify-center rounded-[32px] border border-dashed border-slate-200 bg-white/60 px-8 text-center shadow-[0_32px_90px_-62px_rgba(15,23,42,0.2)]">
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
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-[30px] border border-slate-200/80 bg-white/78 px-5 py-4 shadow-[0_36px_90px_-58px_rgba(15,23,42,0.22)] md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            File Page
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95">
              <FileTextIcon className="size-4 text-slate-600" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950">
                {activeFile?.label ?? activeFolder?.label}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {activeFile
                  ? 'Switch between a freeform canvas and a structured file explorer.'
                  : 'Browse the selected folder in either a canvas layout or structured explorer.'}
              </p>
            </div>
          </div>
        </div>

        <ToggleGroup
          type="single"
          value={activeView}
          onValueChange={(value) => {
            if (value === 'canvas' || value === 'explorer') {
              onViewChange(value);
            }
          }}
          variant="outline"
          className="rounded-xl border border-slate-200/80 bg-white/90 p-1"
        >
          <ToggleGroupItem
            value="canvas"
            className="gap-2 rounded-lg px-3 text-slate-600 data-[state=on]:text-slate-950"
          >
            <LayoutGridIcon className="size-4" />
            Canvas
          </ToggleGroupItem>
          <ToggleGroupItem
            value="explorer"
            className="gap-2 rounded-lg px-3 text-slate-600 data-[state=on]:text-slate-950"
          >
            <ListIcon className="size-4" />
            Explorer
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

        <div className="min-h-0 flex-1">
          {activeView === 'canvas' ? (
            <FileCanvasView
              nodes={displayNodes}
              selectedNodeIds={displaySelectedNodeIds}
              onMoveNodes={
                activeFile
                  ? onMoveNodes
                  : (positions) => {
                      if (!activeFolder) {
                        return;
                      }

                      setFolderCanvasNodes((current) => ({
                        ...current,
                        [activeFolder.id]: (current[activeFolder.id] ?? folderNodes).map((node) =>
                          positions[node.id]
                            ? {
                                ...node,
                                position: positions[node.id],
                              }
                            : node,
                        ),
                      }));
                    }
              }
              onResizeNode={
                activeFile
                  ? onResizeNode
                  : (nodeId, size) => {
                      if (!activeFolder) {
                        return;
                      }

                      setFolderCanvasNodes((current) => ({
                        ...current,
                        [activeFolder.id]: (current[activeFolder.id] ?? folderNodes).map((node) =>
                          node.id === nodeId
                            ? {
                                ...node,
                                size,
                              }
                            : node,
                        ),
                      }));
                    }
              }
              onAddNode={
                activeFile
                  ? onAddNode
                  : (node) => {
                      if (!activeFolder) {
                        return;
                      }

                      setFolderCanvasNodes((current) => ({
                        ...current,
                        [activeFolder.id]: [...(current[activeFolder.id] ?? folderNodes), node],
                      }));
                    }
              }
              onUpdateNode={
                activeFile
                  ? onUpdateNode
                  : (nodeId, updates) => {
                      if (!activeFolder) {
                        return;
                      }

                      setFolderCanvasNodes((current) => ({
                        ...current,
                        [activeFolder.id]: (current[activeFolder.id] ?? folderNodes).map((node) =>
                          node.id === nodeId
                            ? {
                                ...node,
                                ...updates,
                              }
                            : node,
                        ),
                      }));
                    }
              }
              onDeleteNode={
                activeFile
                  ? onDeleteNode
                  : (nodeId) => {
                      if (!activeFolder) {
                        return;
                      }

                      setFolderCanvasNodes((current) => ({
                        ...current,
                        [activeFolder.id]: (current[activeFolder.id] ?? folderNodes).filter(
                          (node) => node.id !== nodeId,
                        ),
                      }));
                      setFolderSelectedNodeIds((current) => ({
                        ...current,
                        [activeFolder.id]: (current[activeFolder.id] ?? []).filter(
                          (id) => id !== nodeId,
                        ),
                      }));
                    }
              }
              onSelectNodes={
                activeFile
                  ? onSelectNodes
                  : (nodeIds) => {
                      if (!activeFolder) {
                        return;
                      }

                      setFolderSelectedNodeIds((current) => ({
                        ...current,
                        [activeFolder.id]: nodeIds,
                      }));
                    }
              }
            />
          ) : (
            <FileExplorerView
              nodes={displayNodes}
              selectedNodeIds={displaySelectedNodeIds}
              onSelectNode={(nodeId) =>
                activeFile
                  ? onSelectNodes([nodeId])
                  : activeFolder
                    ? setFolderSelectedNodeIds((current) => ({
                        ...current,
                        [activeFolder.id]: [nodeId],
                      }))
                    : undefined
              }
            />
          )}
        </div>
      </div>
  );
}
