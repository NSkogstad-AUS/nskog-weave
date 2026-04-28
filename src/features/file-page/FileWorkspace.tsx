import { useCallback, useEffect, useMemo } from 'react';
import { FileTextIcon } from 'lucide-react';

import {
  collectFilesInFolder,
  findFileById,
  findFolderById,
  type WorkspaceFile,
  type WorkspaceFolder,
} from '@/data/sidebarNavigation';
import { workspaceFileToContentItem } from '@/lib/workspaceFiles';
import type { DownloadableFile } from '@/lib/fileDownloads';
import type { SidebarSelectableItem } from '@/features/sidebar/sidebar-tree';
import type {
  FilePageNode,
  FilePageNodeSize,
  FilePageNodeUpdates,
  FilePageView,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';
import { FileCanvasView } from './FileCanvasView';
import { FileDocumentView } from './FileDocumentView';
import { FileExplorerView } from './FileExplorerView';
import { useFolderCanvasState } from './useFolderCanvasState';

interface FileWorkspaceProps {
  activeFile: WorkspaceFile | null;
  activeFolder: WorkspaceFolder | null;
  activeView: FilePageView | null;
  nodes: FilePageNode[];
  selectedNodeIds: string[];
  onMoveNodes: (positions: Record<string, Point>) => void;
  onResizeNode: (nodeId: string, size: FilePageNodeSize) => void;
  onAddNode: (node: FilePageNode) => void;
  onUpdateNode: (nodeId: string, updates: FilePageNodeUpdates) => void;
  onDeleteNode: (nodeId: string) => void;
  onSelectNodes: (nodeIds: string[]) => void;
  onDownloadFiles: (files: DownloadableFile[]) => void;
  onRequestDownloadFolder: (label: string, files: DownloadableFile[]) => void;
  selectedSidebarItems: SidebarSelectableItem[];
  onHighlightedSidebarItemsChange: (items: SidebarSelectableItem[]) => void;
  onUpdateWorkspaceFileContent: (fileId: string, contentText: string) => void;
  onDeleteWorkspaceFile?: (fileId: string) => void;
  onDeleteWorkspaceFolder?: (folderId: string) => void;
  onOpenCanvasFile?: (fileId: string) => void;
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
  onDownloadFiles,
  onRequestDownloadFolder,
  selectedSidebarItems,
  onHighlightedSidebarItemsChange,
  onUpdateWorkspaceFileContent,
  onDeleteWorkspaceFile,
  onDeleteWorkspaceFolder,
  onOpenCanvasFile,
}: FileWorkspaceProps) {
  const folderCanvasState = useFolderCanvasState(activeFolder);
  const displayNodes = activeFile ? nodes : folderCanvasState.activeNodes;
  const displaySelectedNodeIds = activeFile
    ? selectedNodeIds
    : folderCanvasState.activeSelectedNodeIds;
  const displayNodeMap = useMemo(
    () => new Map(displayNodes.map((node) => [node.id, node])),
    [displayNodes],
  );
  const selectedSidebarItemKeys = useMemo(
    () => new Set(selectedSidebarItems.map((item) => `${item.type}:${item.id}`)),
    [selectedSidebarItems],
  );
  const resolveCanvasFileItem = useCallback((node: FilePageNode) => {
    if (node.kind !== 'file') {
      return null;
    }

    if (activeFile && node.id === `${activeFile.id}-file-primary`) {
      return workspaceFileToContentItem(activeFile, node.id);
    }

    if (activeFolder && node.id.startsWith('file:')) {
      const fileMatch = findFileById([activeFolder], node.id.slice('file:'.length));
      return fileMatch ? workspaceFileToContentItem(fileMatch.file, node.id) : null;
    }

    return null;
  }, [activeFile, activeFolder]);
  const resolveCanvasFileId = useCallback((node: FilePageNode) => {
    if (node.kind !== 'file') {
      return null;
    }

    if (activeFile && node.id === `${activeFile.id}-file-primary`) {
      return activeFile.id;
    }

    if (node.id.startsWith('file:')) {
      return node.id.slice('file:'.length);
    }

    return null;
  }, [activeFile]);
  const resolveSidebarItemFromNode = useCallback((node: FilePageNode): SidebarSelectableItem | null => {
    if (node.id.startsWith('folder:')) {
      return {
        type: 'folder',
        id: node.id.slice('folder:'.length),
      };
    }

    const fileId = resolveCanvasFileId(node);

    if (fileId) {
      return {
        type: 'file',
        id: fileId,
      };
    }

    return null;
  }, [resolveCanvasFileId]);
  const resolveCanvasFolderSourceFiles = useCallback((node: FilePageNode) => {
    if (!activeFolder || node.kind !== 'folder' || !node.id.startsWith('folder:')) {
      return [];
    }

    const sourceFolder = findFolderById([activeFolder], node.id.slice('folder:'.length));

    return sourceFolder
      ? collectFilesInFolder(sourceFolder).map((file) =>
          workspaceFileToContentItem(file, `file:${file.id}`),
        )
      : [];
  }, [activeFolder]);

  const buildDownloadableFile = useCallback((file: {
    label: string;
    description?: string | null;
    contentText?: string | null;
    mimeType?: string | null;
  }): DownloadableFile => ({
    label: file.label,
    description: file.description ?? '',
    contentText: file.contentText ?? null,
    mimeType: file.mimeType ?? null,
  }), []);

  const resolveCanvasDownloadFiles = useCallback((node: FilePageNode): DownloadableFile[] => {
    if (node.kind === 'file') {
      if (activeFile && node.id === `${activeFile.id}-file-primary`) {
        return [buildDownloadableFile(activeFile)];
      }

      if (activeFolder && node.id.startsWith('file:')) {
        const fileMatch = findFileById([activeFolder], node.id.slice('file:'.length));
        return fileMatch ? [buildDownloadableFile(fileMatch.file)] : [];
      }

      const sourceItem = resolveCanvasFileItem(node);
      return sourceItem
        ? [buildDownloadableFile(sourceItem)]
        : [buildDownloadableFile(node)];
    }

    if (node.kind !== 'folder') {
      return [];
    }

    const generatedFiles = (node.contentItems ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => buildDownloadableFile(item));

    if (generatedFiles.length > 0) {
      return generatedFiles;
    }

    if (activeFolder && node.id.startsWith('folder:')) {
      const sourceFolder = findFolderById([activeFolder], node.id.slice('folder:'.length));
      return sourceFolder
        ? collectFilesInFolder(sourceFolder).map((file) => buildDownloadableFile(file))
        : [];
    }

    return [];
  }, [activeFile, activeFolder, buildDownloadableFile, resolveCanvasFileItem]);
  const highlightedNodeIds = useMemo(() => {
    if (selectedSidebarItemKeys.size === 0) {
      return [];
    }

    return displayNodes.flatMap((node) => {
      const sidebarItem = resolveSidebarItemFromNode(node);

      return sidebarItem && selectedSidebarItemKeys.has(`${sidebarItem.type}:${sidebarItem.id}`)
        ? [node.id]
        : [];
    });
  }, [displayNodes, resolveSidebarItemFromNode, selectedSidebarItemKeys]);

  useEffect(() => {
    if (activeView !== 'canvas' && activeView !== 'explorer') {
      onHighlightedSidebarItemsChange([]);
      return;
    }

    const nextHighlightedItems = displaySelectedNodeIds.reduce<SidebarSelectableItem[]>(
      (items, nodeId) => {
        const node = displayNodeMap.get(nodeId);

        if (!node) {
          return items;
        }

        const sidebarItem = resolveSidebarItemFromNode(node);

        if (!sidebarItem) {
          return items;
        }

        if (items.some((item) => item.type === sidebarItem.type && item.id === sidebarItem.id)) {
          return items;
        }

        items.push(sidebarItem);
        return items;
      },
      [],
    );

    onHighlightedSidebarItemsChange(nextHighlightedItems);
  }, [
    activeView,
    displayNodeMap,
    displaySelectedNodeIds,
    onHighlightedSidebarItemsChange,
    resolveSidebarItemFromNode,
  ]);

  if ((!activeFile && !activeFolder) || !activeView) {
    return (
      <div className="flex h-full min-h-[34rem] items-center justify-center rounded-none border border-dashed border-slate-200 bg-white/60 px-8 text-center shadow-[0_32px_90px_-62px_rgba(15,23,42,0.2)] dark:border-slate-600/45 dark:bg-[rgba(30,41,59,0.54)] dark:shadow-[0_32px_90px_-62px_rgba(15,23,42,0.42)]">
        <div className="max-w-sm">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-600/40 dark:bg-slate-800/74">
            <FileTextIcon className="size-6 text-slate-500 dark:text-slate-200" />
          </div>
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
            Select a file
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">
            Every file opens its own page. Once a file is selected, you can switch between a minimal canvas and a traditional explorer layout.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex flex-1">
        <div className="min-h-0 flex-1">
          {activeView === 'document' && activeFile ? (
            <FileDocumentView file={activeFile} />
          ) : activeView === 'canvas' ? (
            <FileCanvasView
              nodes={displayNodes}
              highlightedNodeIds={highlightedNodeIds}
              selectedNodeIds={displaySelectedNodeIds}
              onMoveNodes={activeFile ? onMoveNodes : folderCanvasState.moveNodes}
              onResizeNode={activeFile ? onResizeNode : folderCanvasState.resizeNode}
              onAddNode={activeFile ? onAddNode : folderCanvasState.addNode}
              onUpdateNode={activeFile ? onUpdateNode : folderCanvasState.updateNode}
              onDeleteNode={activeFile ? onDeleteNode : (nodeId) => {
                folderCanvasState.deleteNode(nodeId);
                if (nodeId.startsWith('file:')) {
                  onDeleteWorkspaceFile?.(nodeId.slice('file:'.length));
                } else if (nodeId.startsWith('folder:')) {
                  onDeleteWorkspaceFolder?.(nodeId.slice('folder:'.length));
                }
              }}
              onHoverNodeChange={() => {}}
              onSelectNodes={activeFile ? onSelectNodes : folderCanvasState.selectNodes}
              onDownloadFileNode={(node) => {
                const files = resolveCanvasDownloadFiles(node);

                if (files.length > 0) {
                  onDownloadFiles(files.slice(0, 1));
                }
              }}
              onRequestDownloadFolderNode={(node) => {
                const files = resolveCanvasDownloadFiles(node);

                if (files.length > 0) {
                  onRequestDownloadFolder(node.label, files);
                }
              }}
              getFolderExpandState={
                activeFile ? undefined : folderCanvasState.getFolderExpandState
              }
              getFolderContents={
                activeFile ? undefined : folderCanvasState.getFolderContents
              }
              onExpandFolder={
                activeFile ? undefined : folderCanvasState.expandFolderNode
              }
              onCollapseFolder={
                activeFile ? undefined : folderCanvasState.collapseFolderNode
              }
              resolveCanvasFileItem={resolveCanvasFileItem}
              resolveCanvasFileId={resolveCanvasFileId}
              resolveCanvasFolderSourceFiles={resolveCanvasFolderSourceFiles}
              onUpdateWorkspaceFileContent={onUpdateWorkspaceFileContent}
              onOpenCanvasFile={onOpenCanvasFile}
            />
          ) : (
            <FileExplorerView
              highlightedNodeIds={highlightedNodeIds}
              nodes={displayNodes}
              selectedNodeIds={displaySelectedNodeIds}
              onSelectNode={(nodeId) =>
                (activeFile ? onSelectNodes : folderCanvasState.selectNodes)([nodeId])
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
