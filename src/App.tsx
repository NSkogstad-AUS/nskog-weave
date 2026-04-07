import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UploadIcon } from 'lucide-react';

import {
  SidebarInset,
  SidebarProvider,
} from '@/components/animate-ui/components/radix/sidebar';
import {
  addFileToFolderById,
  createWorkspaceFolders,
  findFileById,
  findFilePathById,
  findFolderById,
  findFolderPathById,
  type WorkspaceFolderOrderEntry,
  type WorkspaceSeparator,
  type WorkspaceFile,
  type WorkspaceFolder,
} from '@/data/sidebarNavigation';
import { FileWorkspace } from '@/features/file-page/FileWorkspace';
import {
  FOLDER_CANVAS_UPDATED_EVENT,
  readStoredFolderCanvasNodes,
  updateStoredFolderCanvasNodes,
  type FolderCanvasStore,
} from '@/features/file-page/useFolderCanvasState';
import { buildUploadedWorkspaceFile } from '@/lib/workspaceFiles';
import { WorkspaceSidebar } from './features/sidebar/WorkspaceSidebar';
import { useFilePages } from './hooks/useFilePages';
import type { FilePageNode, FilePageState } from '@/types/filePage';

const WORKSPACE_FOLDERS_STORAGE_KEY = 'weave:workspace-folders:v1';
const GENERATED_WORKSPACE_FOLDER_PREFIX = 'worker-output-folder:';
const GENERATED_WORKSPACE_FILE_PREFIX = 'worker-output-file:';
const ROOT_WORKSPACE_FOLDER_ID = 'workspace-root';

type GeneratedWorkspaceOwnerType = 'file' | 'folder';

function createEmptyWorkspaceRootFolder(): WorkspaceFolder {
  return {
    id: ROOT_WORKSPACE_FOLDER_ID,
    label: 'Workspace',
    files: [],
    children: [],
  };
}

function buildGeneratedWorkspaceEntityId(
  prefix: string,
  ownerType: GeneratedWorkspaceOwnerType,
  ownerId: string,
  entityId: string,
) {
  return `${prefix}${ownerType}:${encodeURIComponent(ownerId)}:${encodeURIComponent(entityId)}`;
}

function parseGeneratedWorkspaceEntityId(value: string, prefix: string) {
  if (!value.startsWith(prefix)) {
    return null;
  }

  const parts = value.slice(prefix.length).split(':');

  if (parts.length < 3) {
    return parts.length >= 2
      ? {
          ownerType: 'file' as const,
          ownerId: decodeURIComponent(parts[0]),
          entityId: decodeURIComponent(parts.slice(1).join(':')),
        }
      : null;
  }

  return {
    ownerType: parts[0] === 'folder' ? 'folder' as const : 'file' as const,
    ownerId: decodeURIComponent(parts[1]),
    entityId: decodeURIComponent(parts.slice(2).join(':')),
  };
}

function parseGeneratedWorkspaceFolderId(folderId: string) {
  return parseGeneratedWorkspaceEntityId(folderId, GENERATED_WORKSPACE_FOLDER_PREFIX);
}

function parseGeneratedWorkspaceFileId(fileId: string) {
  return parseGeneratedWorkspaceEntityId(fileId, GENERATED_WORKSPACE_FILE_PREFIX);
}

function upsertGeneratedFolderChildren(
  folders: WorkspaceFolder[],
  parentFolderId: string,
  generatedChildren: WorkspaceFolder[],
): WorkspaceFolder[] {
  return folders.map((folder) =>
    folder.id === parentFolderId
      ? {
          ...folder,
          children: [
            ...folder.children.filter(
              (child) => !generatedChildren.some((generatedChild) => generatedChild.id === child.id),
            ),
            ...generatedChildren,
          ],
        }
      : {
          ...folder,
          children: upsertGeneratedFolderChildren(folder.children, parentFolderId, generatedChildren),
        },
  );
}

function buildGeneratedWorkspaceFolder(
  ownerType: GeneratedWorkspaceOwnerType,
  ownerId: string,
  node: FilePageState['nodes'][number],
): WorkspaceFolder {
  const files: WorkspaceFile[] = (node.contentItems ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => ({
      id: buildGeneratedWorkspaceEntityId(
        GENERATED_WORKSPACE_FILE_PREFIX,
        ownerType,
        ownerId,
        item.id,
      ),
      label: item.label,
      description:
        (item.description ?? node.description) || 'Generated output from a connected worker.',
      kind: 'brief',
      contentText: item.textContent ?? null,
      mimeType: item.mimeType ?? 'text/markdown',
      sizeBytes: item.sizeBytes ?? item.textContent?.length ?? null,
    }));
  const children = (node.contentItems ?? [])
    .filter((item) => item.kind === 'folder')
    .map((item) => ({
      id: buildGeneratedWorkspaceEntityId(
        GENERATED_WORKSPACE_FOLDER_PREFIX,
        ownerType,
        ownerId,
        item.id,
      ),
      label: item.label,
      files: [],
      children: [],
    }));

  return {
    id: buildGeneratedWorkspaceEntityId(
      GENERATED_WORKSPACE_FOLDER_PREFIX,
      ownerType,
      ownerId,
      node.id,
    ),
    label: node.label,
    files,
    children,
  };
}

function collectGeneratedWorkspaceFolders(nodes: FilePageNode[]) {
  return nodes.filter(
    (node) =>
      node.kind === 'folder' &&
      node.generatedByWorkerId &&
      (node.contentItems?.length ?? 0) > 0,
  );
}

function removeGeneratedContentItemFromNodes(
  nodes: FilePageNode[],
  contentItemId: string,
): FilePageNode[] {
  const targetFolder = nodes.find(
    (node) =>
      node.kind === 'folder' &&
      node.generatedByWorkerId &&
      (node.contentItems ?? []).some((item) => item.id === contentItemId),
  ) ?? null;
  const workerId = targetFolder?.generatedByWorkerId ?? null;

  return nodes.reduce<FilePageNode[]>((nextNodes, node) => {
    if (targetFolder && node.id === targetFolder.id) {
      const nextContentItems = (node.contentItems ?? []).filter((item) => item.id !== contentItemId);

      if (nextContentItems.length > 0) {
        nextNodes.push({
          ...node,
          contentItems: nextContentItems,
        });
      }

      return nextNodes;
    }

    if (workerId && node.id === workerId && (!targetFolder || (targetFolder.contentItems ?? []).length <= 1)) {
      nextNodes.push({
        ...node,
        workerStatus: 'idle',
        workerProgress: 0,
        workerOutputFolderId: null,
        workerInputSignature: null,
        workerLastError: null,
      });
      return nextNodes;
    }

    nextNodes.push(node);
    return nextNodes;
  }, []);
}

function removeGeneratedFolderFromNodes(
  nodes: FilePageNode[],
  folderNodeId: string,
): FilePageNode[] {
  const deletedFolder = nodes.find((node) => node.id === folderNodeId) ?? null;
  const workerId =
    deletedFolder?.kind === 'folder' ? deletedFolder.generatedByWorkerId ?? null : null;

  return nodes.reduce<FilePageNode[]>((nextNodes, node) => {
    if (node.id === folderNodeId) {
      return nextNodes;
    }

    if (workerId && node.id === workerId) {
      nextNodes.push({
        ...node,
        workerStatus: 'idle',
        workerProgress: 0,
        workerOutputFolderId: null,
        workerInputSignature: null,
        workerLastError: null,
      });
      return nextNodes;
    }

    nextNodes.push(node);
    return nextNodes;
  }, []);
}

function mergeWorkerOutputsIntoFolders(
  folders: WorkspaceFolder[],
  pages: Record<string, FilePageState>,
  folderCanvasPages: FolderCanvasStore,
): WorkspaceFolder[] {
  let nextFolders = folders;

  Object.entries(pages).forEach(([fileId, page]) => {
    const fileMatch = findFileById(folders, fileId);

    if (!fileMatch) {
      return;
    }

    const generatedFolders = collectGeneratedWorkspaceFolders(page.nodes)
      .map((node) => buildGeneratedWorkspaceFolder('file', fileId, node));

    if (generatedFolders.length === 0) {
      return;
    }

    nextFolders = upsertGeneratedFolderChildren(nextFolders, fileMatch.folderId, generatedFolders);
  });

  Object.entries(folderCanvasPages).forEach(([folderId, nodes]) => {
    const parentFolder = findFolderById(folders, folderId);

    if (!parentFolder) {
      return;
    }

    const generatedFolders = collectGeneratedWorkspaceFolders(nodes)
      .map((node) => buildGeneratedWorkspaceFolder('folder', folderId, node));

    if (generatedFolders.length === 0) {
      return;
    }

    nextFolders = upsertGeneratedFolderChildren(nextFolders, parentFolder.id, generatedFolders);
  });

  return nextFolders;
}

function stripGeneratedWorkspaceEntries(folders: WorkspaceFolder[]): WorkspaceFolder[] {
  return folders
    .filter((folder) => !folder.id.startsWith(GENERATED_WORKSPACE_FOLDER_PREFIX))
    .map((folder) => ({
      ...folder,
      files: folder.files.filter((file) => !file.id.startsWith(GENERATED_WORKSPACE_FILE_PREFIX)),
      separators: (folder.separators ?? []).map((separator) => ({ ...separator })),
      itemOrder: (folder.itemOrder ?? []).filter((entry) => {
        if (entry.type === 'folder') {
          return !entry.id.startsWith(GENERATED_WORKSPACE_FOLDER_PREFIX);
        }

        if (entry.type === 'file') {
          return !entry.id.startsWith(GENERATED_WORKSPACE_FILE_PREFIX);
        }

        return true;
      }),
      children: stripGeneratedWorkspaceEntries(folder.children),
    }));
}

function normalizeWorkspaceFileKind(value: unknown): WorkspaceFile['kind'] {
  return value === 'canvas' || value === 'memo' || value === 'outline' ? value : 'brief';
}

function normalizeWorkspaceFile(value: unknown): WorkspaceFile | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as WorkspaceFile).id !== 'string' ||
    typeof (value as WorkspaceFile).label !== 'string' ||
    typeof (value as WorkspaceFile).description !== 'string'
  ) {
    return null;
  }

  const workspaceFile = value as WorkspaceFile;

  return {
    id: workspaceFile.id,
    label: workspaceFile.label,
    description: workspaceFile.description,
    kind: normalizeWorkspaceFileKind(workspaceFile.kind),
    contentText:
      typeof workspaceFile.contentText === 'string'
        ? workspaceFile.contentText
        : null,
    mimeType:
      typeof workspaceFile.mimeType === 'string' && workspaceFile.mimeType.trim().length > 0
        ? workspaceFile.mimeType
        : null,
    sizeBytes: Number.isFinite(workspaceFile.sizeBytes)
      ? Math.max(0, Number(workspaceFile.sizeBytes))
      : null,
  };
}

function normalizeWorkspaceFolder(value: unknown): WorkspaceFolder | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as WorkspaceFolder).id !== 'string' ||
    typeof (value as WorkspaceFolder).label !== 'string' ||
    !Array.isArray((value as WorkspaceFolder).children) ||
    !Array.isArray((value as WorkspaceFolder).files)
  ) {
    return null;
  }

  const rawFolder = value as WorkspaceFolder & {
    separators?: unknown;
    itemOrder?: unknown;
  };
  const separators = Array.isArray(rawFolder.separators)
    ? rawFolder.separators.flatMap((separator) => {
        if (
          typeof separator !== 'object' ||
          separator === null ||
          typeof (separator as WorkspaceSeparator).id !== 'string'
        ) {
          return [];
        }

        return [
          {
            id: (separator as WorkspaceSeparator).id,
          },
        ];
      })
    : [];
  const itemOrder = Array.isArray(rawFolder.itemOrder)
    ? rawFolder.itemOrder.flatMap((entry) => {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          ((entry as WorkspaceFolderOrderEntry).type !== 'folder' &&
            (entry as WorkspaceFolderOrderEntry).type !== 'file' &&
            (entry as WorkspaceFolderOrderEntry).type !== 'separator') ||
          typeof (entry as WorkspaceFolderOrderEntry).id !== 'string'
        ) {
          return [];
        }

        return [
          {
            type: (entry as WorkspaceFolderOrderEntry).type,
            id: (entry as WorkspaceFolderOrderEntry).id,
          },
        ];
      })
    : undefined;

  return {
    id: rawFolder.id,
    label: rawFolder.label,
    children: rawFolder.children.flatMap((child) => {
      const nextChild = normalizeWorkspaceFolder(child);
      return nextChild ? [nextChild] : [];
    }),
    files: rawFolder.files.flatMap((file) => {
      const nextFile = normalizeWorkspaceFile(file);
      return nextFile ? [nextFile] : [];
    }),
    separators,
    itemOrder,
  };
}

function hydrateWorkspaceFolders() {
  if (typeof window === 'undefined') {
    return createWorkspaceFolders();
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_FOLDERS_STORAGE_KEY);

    if (!raw) {
      return createWorkspaceFolders();
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return createWorkspaceFolders();
    }

    const normalizedFolders = parsed.flatMap((folder) => {
      const nextFolder = normalizeWorkspaceFolder(folder);
      return nextFolder ? [nextFolder] : [];
    });

    return normalizedFolders.length > 0
      ? stripGeneratedWorkspaceEntries(normalizedFolders)
      : createWorkspaceFolders();
  } catch {
    return createWorkspaceFolders();
  }
}

function hasFileDrag(types: readonly string[]) {
  return types.includes('Files');
}

function App() {
  const [folders, setFolders] = useState<WorkspaceFolder[]>(hydrateWorkspaceFolders);
  const [folderCanvasPages, setFolderCanvasPages] = useState<FolderCanvasStore>(
    readStoredFolderCanvasNodes,
  );
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [folderView, setFolderView] = useState<'canvas' | 'explorer'>('canvas');
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const [hoveredSidebarItem, setHoveredSidebarItem] = useState<
    | {
        type: 'folder' | 'file';
        id: string;
      }
    | null
  >(null);
  const fileDragDepthRef = useRef(0);
  const activeFileSeedMatch = useMemo(
    () => (openFileId ? findFilePathById(folders, openFileId) : null),
    [folders, openFileId],
  );
  const activeFileSeed = activeFileSeedMatch?.file ?? null;
  const {
    activePage,
    pages,
    moveNodes,
    removeFilePage,
    resizeNode,
    addNode,
    updateNode,
    updatePageByFileId,
    deleteNode,
    selectedNodeIds,
    setSelectedNodeIds,
    setView,
  } = useFilePages(activeFileSeed);
  useEffect(() => {
    const syncFolderCanvasPages = () => {
      setFolderCanvasPages(readStoredFolderCanvasNodes());
    };

    window.addEventListener(FOLDER_CANVAS_UPDATED_EVENT, syncFolderCanvasPages);
    window.addEventListener('storage', syncFolderCanvasPages);

    return () => {
      window.removeEventListener(FOLDER_CANVAS_UPDATED_EVENT, syncFolderCanvasPages);
      window.removeEventListener('storage', syncFolderCanvasPages);
    };
  }, []);
  const displayFolders = useMemo(
    () => mergeWorkerOutputsIntoFolders(folders, pages, folderCanvasPages),
    [folderCanvasPages, folders, pages],
  );
  const activeFileMatch = useMemo(
    () => (openFileId ? findFilePathById(displayFolders, openFileId) : null),
    [displayFolders, openFileId],
  );
  const activeFile = activeFileMatch?.file ?? activeFileSeed;
  const activeBaseFolder = useMemo(
    () => (openFolderId ? findFolderById(folders, openFolderId) : null),
    [folders, openFolderId],
  );
  const activeFolder = useMemo(
    () => activeBaseFolder ?? (openFolderId ? findFolderById(displayFolders, openFolderId) : null),
    [activeBaseFolder, displayFolders, openFolderId],
  );
  const activeFolderPath = useMemo(
    () => (openFolderId ? findFolderPathById(displayFolders, openFolderId) : null),
    [displayFolders, openFolderId],
  );
  const uploadTargetFolder = useMemo(() => {
    const directlyOpenFolder = openFolderId ? findFolderById(folders, openFolderId) : null;

    if (directlyOpenFolder) {
      return directlyOpenFolder;
    }

    if (activeFileSeedMatch) {
      return activeFileSeedMatch.folders.at(-1) ?? null;
    }

    const fallbackPathFolderId = activeFolderPath
      ?.slice()
      .reverse()
      .find((folder) => Boolean(findFolderById(folders, folder.id)))?.id;

    if (fallbackPathFolderId) {
      return findFolderById(folders, fallbackPathFolderId);
    }

    return folders[0] ?? null;
  }, [activeFileSeedMatch, activeFolderPath, folders, openFolderId]);
  const locationSegments = useMemo(
    () =>
      activeFileMatch
        ? [...activeFileMatch.folders.map((folder) => folder.label), activeFileMatch.file.label]
        : activeFolderPath?.map((folder) => folder.label) ?? [],
    [activeFileMatch, activeFolderPath],
  );
  const activeView = activeFile ? activePage?.view ?? 'explorer' : activeFolder ? folderView : null;

  const handleFileDelete = useCallback(
    (fileId: string) => {
      const generatedFileMatch = parseGeneratedWorkspaceFileId(fileId);

      if (generatedFileMatch) {
        if (generatedFileMatch.ownerType === 'file') {
          updatePageByFileId(generatedFileMatch.ownerId, (page) => ({
            ...page,
            nodes: removeGeneratedContentItemFromNodes(page.nodes, generatedFileMatch.entityId),
          }));
        } else {
          setFolderCanvasPages(
            updateStoredFolderCanvasNodes(generatedFileMatch.ownerId, (nodes) =>
              removeGeneratedContentItemFromNodes(nodes, generatedFileMatch.entityId),
            ),
          );
        }
        setOpenFileId((current) => (current === fileId ? null : current));
        return;
      }

      removeFilePage(fileId);
      setOpenFileId((current) => (current === fileId ? null : current));
    },
    [removeFilePage, updatePageByFileId],
  );

  const handleFolderDelete = useCallback((folderId: string) => {
    const generatedFolderMatch = parseGeneratedWorkspaceFolderId(folderId);

    if (!generatedFolderMatch) {
      setOpenFolderId((current) => (current === folderId ? null : current));
      return;
    }

    if (generatedFolderMatch.ownerType === 'file') {
      updatePageByFileId(generatedFolderMatch.ownerId, (page) => ({
        ...page,
        nodes: removeGeneratedFolderFromNodes(page.nodes, generatedFolderMatch.entityId),
      }));
    } else {
      setFolderCanvasPages(
        updateStoredFolderCanvasNodes(generatedFolderMatch.ownerId, (nodes) =>
          removeGeneratedFolderFromNodes(nodes, generatedFolderMatch.entityId),
        ),
      );
    }
    setOpenFolderId((current) => (current === folderId ? null : current));
  }, [updatePageByFileId]);

  const handleUploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const uploadedFiles = await Promise.all(
      files.map((file, index) => buildUploadedWorkspaceFile(file, index)),
    );

    setFolders((current) => {
      const targetFolderId =
        uploadTargetFolder?.id ??
        current[0]?.id ??
        ROOT_WORKSPACE_FOLDER_ID;
      const baseFolders =
        current.length > 0 ? current : [createEmptyWorkspaceRootFolder()];

      return uploadedFiles.reduce(
        (nextFolders, file) => addFileToFolderById(nextFolders, targetFolderId, file),
        baseFolders,
      );
    });

    if (!uploadTargetFolder) {
      setOpenFolderId((current) => current ?? ROOT_WORKSPACE_FOLDER_ID);
    }
  }, [uploadTargetFolder]);

  const handleAppDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(Array.from(event.dataTransfer.types))) {
      return;
    }

    event.preventDefault();
    fileDragDepthRef.current += 1;
    setIsFileDropActive(true);
  }, []);

  const handleAppDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(Array.from(event.dataTransfer.types))) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    if (!isFileDropActive) {
      setIsFileDropActive(true);
    }
  }, [isFileDropActive]);

  const handleAppDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(Array.from(event.dataTransfer.types))) {
      return;
    }

    event.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);

    if (fileDragDepthRef.current === 0) {
      setIsFileDropActive(false);
    }
  }, []);

  const handleAppDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(Array.from(event.dataTransfer.types))) {
      return;
    }

    event.preventDefault();
    fileDragDepthRef.current = 0;
    setIsFileDropActive(false);

    void handleUploadFiles(Array.from(event.dataTransfer.files));
  }, [handleUploadFiles]);

  useEffect(() => {
    window.localStorage.setItem(
      WORKSPACE_FOLDERS_STORAGE_KEY,
      JSON.stringify(stripGeneratedWorkspaceEntries(folders)),
    );
  }, [folders]);

  useEffect(() => {
    if (openFileId && !findFilePathById(displayFolders, openFileId)) {
      setOpenFileId(null);
    }
  }, [displayFolders, openFileId]);

  useEffect(() => {
    if (openFolderId && !findFolderById(displayFolders, openFolderId)) {
      setOpenFolderId(null);
    }
  }, [displayFolders, openFolderId]);

  useEffect(() => {
    if (activeView !== 'canvas') {
      setHoveredSidebarItem(null);
    }
  }, [activeView, activeFile?.id, activeFolder?.id]);

  return (
    <div
      className="relative min-h-screen"
      onDragEnter={handleAppDragEnter}
      onDragOver={handleAppDragOver}
      onDragLeave={handleAppDragLeave}
      onDrop={handleAppDrop}
    >
      <SidebarProvider
        defaultOpen={false}
        style={
          {
            '--sidebar-width': '24rem',
            '--sidebar-width-icon': '4.25rem',
          } as React.CSSProperties
        }
        className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.10),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.08),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#f3f6fb_100%)]"
      >
        <WorkspaceSidebar
          folders={displayFolders}
          highlightedItem={hoveredSidebarItem}
          onFoldersChange={(nextFolders) => setFolders(stripGeneratedWorkspaceEntries(nextFolders))}
          onImportFiles={(files) => {
            void handleUploadFiles(files);
          }}
          onOpenFile={(fileId) => {
            setOpenFileId(fileId);
            setOpenFolderId(null);
          }}
          onOpenFolder={(folderId) => {
            setOpenFolderId(folderId);
            setOpenFileId(null);
          }}
          onFileDelete={handleFileDelete}
          onFolderDelete={handleFolderDelete}
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

      {isFileDropActive ? (
        <div className="pointer-events-none fixed inset-5 z-50 rounded-[2rem] border border-slate-300/75 bg-white/58 p-6 shadow-[0_32px_90px_-52px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          <div className="flex h-full items-center justify-center rounded-[1.6rem] border border-slate-300/70 border-dashed bg-white/72">
            <div className="max-w-md text-center">
              <div className="mx-auto flex size-16 items-center justify-center rounded-[1.4rem] border border-slate-200/85 bg-white/92 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.28)]">
                <UploadIcon className="size-7 text-slate-600" />
              </div>
              <div className="mt-5 text-[1.35rem] font-semibold tracking-[-0.02em] text-slate-950">
                Drop Files To Upload
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-500">
                {uploadTargetFolder
                  ? `Files will be added to ${uploadTargetFolder.label}.`
                  : 'Files will be added to the current workspace.'}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
