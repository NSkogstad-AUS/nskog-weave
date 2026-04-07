import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileTextIcon } from 'lucide-react';

import {
  collectFilesInFolder,
  findFileById,
  findFolderById,
  type WorkspaceFile,
  type WorkspaceFolder,
} from '@/data/sidebarNavigation';
import {
  contentItemToPreviewDocument,
  workspaceFileToContentItem,
  workspaceFileToPreviewDocument,
} from '@/lib/workspaceFiles';
import type { DownloadableFile } from '@/lib/fileDownloads';
import type {
  FilePageContentItem,
  FilePageNode,
  FilePageNodeSize,
  FilePageNodeUpdates,
  FilePageView,
} from '@/types/filePage';
import type { Point } from '@/types/geometry';
import { FileContentPreview } from './FileContentPreview';
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
  onUpdateNode: (nodeId: string, updates: FilePageNodeUpdates) => void;
  onDeleteNode: (nodeId: string) => void;
  onSelectNodes: (nodeIds: string[]) => void;
  onDownloadFiles: (files: DownloadableFile[]) => void;
  onRequestDownloadFolder: (label: string, files: DownloadableFile[]) => void;
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
  onDownloadFiles,
  onRequestDownloadFolder,
  onHoveredSidebarItemChange,
  onViewChange,
}: FileWorkspaceProps) {
  const folderCanvasState = useFolderCanvasState(activeFolder);
  const displayNodes = activeFile ? nodes : folderCanvasState.activeNodes;
  const displaySelectedNodeIds = activeFile
    ? selectedNodeIds
    : folderCanvasState.activeSelectedNodeIds;
  const [previewedContentItem, setPreviewedContentItem] = useState<FilePageContentItem | null>(null);
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
  const selectedNodePreview = useMemo(() => {
    const selectedNode = displaySelectedNodeIds
      .map((nodeId) => displayNodes.find((node) => node.id === nodeId) ?? null)
      .find((node): node is FilePageNode => Boolean(node));

    if (!selectedNode) {
      return null;
    }

    const previewItem = resolveCanvasFileItem(selectedNode);
    return previewItem ? contentItemToPreviewDocument(previewItem) : null;
  }, [displayNodes, displaySelectedNodeIds, resolveCanvasFileItem]);
  const previewDocument = useMemo(() => {
    if (previewedContentItem) {
      return contentItemToPreviewDocument(previewedContentItem);
    }

    if (selectedNodePreview) {
      return selectedNodePreview;
    }

    return activeFile ? workspaceFileToPreviewDocument(activeFile) : null;
  }, [activeFile, previewedContentItem, selectedNodePreview]);

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

  useEffect(() => {
    setPreviewedContentItem(null);
  }, [activeFile?.id, activeFolder?.id, displaySelectedNodeIds.join('|')]);

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
      <div className="min-h-0 flex flex-1">
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
              resolveCanvasFolderSourceFiles={resolveCanvasFolderSourceFiles}
              onPreviewContentItemChange={setPreviewedContentItem}
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

        {previewDocument ? <FileContentPreview document={previewDocument} /> : null}
      </div>
    </div>
  );
}
