import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileTextIcon, LayoutGridIcon, ListIcon } from 'lucide-react';

import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/animate-ui/components/radix/toggle-group';
import type { WorkspaceFile, WorkspaceFolder } from '@/data/sidebarNavigation';
import { cn } from '@/lib/utils';
import type { FilePageElementIcon, FilePageNode, FilePageView } from '@/types/filePage';
import { FileCanvasView } from './FileCanvasView';
import { FileExplorerView } from './FileExplorerView';

interface FileWorkspaceProps {
  activeFile: WorkspaceFile | null;
  activeFolder: WorkspaceFolder | null;
  activeView: FilePageView | null;
  locationSegments: string[];
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
  const pageTitle = activeFile?.label ?? activeFolder?.label ?? 'Workspace';
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
        <div className="pointer-events-none absolute inset-x-5 top-5 z-20 flex items-start justify-between gap-4">
          <div
            className={cn(
              'pointer-events-auto min-w-56 max-w-[min(42rem,calc(100%-16rem))] rounded-[22px] border border-white/75 bg-white/84 px-4 py-3 shadow-[0_18px_48px_-28px_rgba(15,23,42,0.4)] backdrop-blur-md',
            )}
          >
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                <span className="shrink-0">{pageEyebrow}</span>
                <span className="ml-1.5 min-w-0 truncate normal-case tracking-normal text-slate-500">
                  {breadcrumbPrefix ? `/${breadcrumbPrefix}/` : '/'}
                </span>
              </div>
              <h1
                className={cn(
                  'shrink-0 text-lg leading-none font-semibold tracking-tight text-slate-950',
                  activeView === 'canvas' &&
                    'underline decoration-slate-500/60 underline-offset-3',
                )}
              >
                {breadcrumbCurrent}
              </h1>
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
            className="pointer-events-auto grid w-52 grid-cols-2 rounded-[20px] border border-white/75 bg-white/84 p-1 shadow-[0_18px_48px_-28px_rgba(15,23,42,0.4)] backdrop-blur-md sm:w-56"
          >
            <ToggleGroupItem
              value="canvas"
              className="gap-2 justify-center rounded-2xl px-3.5 text-slate-600 data-[state=on]:bg-white/95 data-[state=on]:text-slate-950"
            >
              <LayoutGridIcon className="size-4" />
              Canvas
            </ToggleGroupItem>
            <ToggleGroupItem
              value="explorer"
              className="gap-2 justify-center rounded-2xl px-3.5 text-slate-600 data-[state=on]:bg-white/95 data-[state=on]:text-slate-950"
            >
              <ListIcon className="size-4" />
              Explorer
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

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
              onHoverNodeChange={handleHoverNodeChange}
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
              className="pt-24"
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
