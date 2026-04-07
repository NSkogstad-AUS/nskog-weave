export interface WorkspaceFile {
  id: string;
  label: string;
  description: string;
  kind: 'canvas' | 'brief' | 'memo' | 'outline';
  contentText?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export interface WorkspaceSeparator {
  id: string;
}

export interface WorkspaceFolderOrderEntry {
  type: 'folder' | 'file' | 'separator';
  id: string;
}

export interface WorkspaceFolder {
  id: string;
  label: string;
  children: WorkspaceFolder[];
  files: WorkspaceFile[];
  separators?: WorkspaceSeparator[];
  itemOrder?: WorkspaceFolderOrderEntry[];
}

export type OrderedWorkspaceFolderItem =
  | {
      type: 'folder';
      folder: WorkspaceFolder;
    }
  | {
      type: 'file';
      file: WorkspaceFile;
    }
  | {
      type: 'separator';
      separator: WorkspaceSeparator;
    };

const WORKSPACE_FOLDERS_SEED: WorkspaceFolder[] = [];

function normalizeFolderOrdering(folder: WorkspaceFolder): WorkspaceFolder {
  const children = folder.children.map((child) => normalizeFolderOrdering(child));
  const files = folder.files.map((file) => ({ ...file }));
  const separators = (folder.separators ?? []).map((separator) => ({
    ...separator,
  }));
  const validEntryKeys = new Set([
    ...children.map((child) => `folder:${child.id}`),
    ...files.map((file) => `file:${file.id}`),
    ...separators.map((separator) => `separator:${separator.id}`),
  ]);
  const nextItemOrder = (folder.itemOrder ?? []).flatMap((entry) => {
    if (
      !entry ||
      (entry.type !== 'folder' && entry.type !== 'file' && entry.type !== 'separator') ||
      typeof entry.id !== 'string'
    ) {
      return [];
    }

    const entryKey = `${entry.type}:${entry.id}`;

    return validEntryKeys.has(entryKey) ? [entry] : [];
  });
  const seenEntryKeys = new Set(nextItemOrder.map((entry) => `${entry.type}:${entry.id}`));
  const appendMissingEntries = (
    type: WorkspaceFolderOrderEntry['type'],
    ids: string[],
  ) =>
    ids.flatMap((id) => {
      const entryKey = `${type}:${id}`;

      if (seenEntryKeys.has(entryKey)) {
        return [];
      }

      seenEntryKeys.add(entryKey);
      return [
        {
          type,
          id,
        } satisfies WorkspaceFolderOrderEntry,
      ];
    });

  return {
    ...folder,
    children,
    files,
    separators,
    itemOrder: [
      ...nextItemOrder,
      ...appendMissingEntries(
        'folder',
        children.map((child) => child.id),
      ),
      ...appendMissingEntries(
        'file',
        files.map((file) => file.id),
      ),
      ...appendMissingEntries(
        'separator',
        separators.map((separator) => separator.id),
      ),
    ],
  };
}

function cloneFolders(folders: WorkspaceFolder[]): WorkspaceFolder[] {
  return folders.map((folder) => normalizeFolderOrdering(folder));
}

function mapFolders(
  folders: WorkspaceFolder[],
  recipe: (folder: WorkspaceFolder) => WorkspaceFolder,
): WorkspaceFolder[] {
  return folders.map((folder) =>
    normalizeFolderOrdering(
      recipe({
        ...folder,
        children: mapFolders(folder.children, recipe),
        files: folder.files.map((file) => ({ ...file })),
        separators: (folder.separators ?? []).map((separator) => ({ ...separator })),
        itemOrder: folder.itemOrder?.map((entry) => ({ ...entry })),
      }),
    ),
  );
}

function removeFolderById(folders: WorkspaceFolder[], folderId: string): WorkspaceFolder[] {
  return folders
    .filter((folder) => folder.id !== folderId)
    .map((folder) =>
      normalizeFolderOrdering({
        ...folder,
        children: removeFolderById(folder.children, folderId),
      }),
    );
}

function findSeparatorById(
  folders: WorkspaceFolder[],
  separatorId: string,
): { separator: WorkspaceSeparator; folderId: string } | null {
  for (const folder of folders) {
    const separator = (folder.separators ?? []).find((candidate) => candidate.id === separatorId);

    if (separator) {
      return {
        separator,
        folderId: folder.id,
      };
    }

    const nestedMatch = findSeparatorById(folder.children, separatorId);

    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
}

function removeSeparatorByIdInternal(
  folders: WorkspaceFolder[],
  separatorId: string,
): WorkspaceFolder[] {
  return folders.map((folder) =>
    normalizeFolderOrdering({
      ...folder,
      separators: (folder.separators ?? []).filter((separator) => separator.id !== separatorId),
      children: removeSeparatorByIdInternal(folder.children, separatorId),
    }),
  );
}

function insertAtIndex<T>(items: T[], index: number, item: T) {
  const nextItems = [...items];
  const targetIndex = Math.max(0, Math.min(index, nextItems.length));

  nextItems.splice(targetIndex, 0, item);
  return nextItems;
}

function insertSeparatorIntoFolder(
  folders: WorkspaceFolder[],
  folderId: string,
  separator: WorkspaceSeparator,
  targetIndex: number,
): WorkspaceFolder[] {
  return folders.map((folder) => {
    if (folder.id === folderId) {
      const nextItemOrder = insertAtIndex(
        (folder.itemOrder ?? []).filter(
          (entry) => !(entry.type === 'separator' && entry.id === separator.id),
        ),
        targetIndex,
        {
          type: 'separator',
          id: separator.id,
        } satisfies WorkspaceFolderOrderEntry,
      );

      return normalizeFolderOrdering({
        ...folder,
        separators: [...(folder.separators ?? []).filter((candidate) => candidate.id !== separator.id), separator],
        itemOrder: nextItemOrder,
      });
    }

    return normalizeFolderOrdering({
      ...folder,
      children: insertSeparatorIntoFolder(folder.children, folderId, separator, targetIndex),
    });
  });
}

export function createWorkspaceFolders(): WorkspaceFolder[] {
  return cloneFolders(WORKSPACE_FOLDERS_SEED);
}

export function getAllFolderIds(folders: WorkspaceFolder[]): string[] {
  return folders.flatMap((folder) => [folder.id, ...getAllFolderIds(folder.children)]);
}

export function getFolderDescendantCounts(folder: WorkspaceFolder): {
  folders: number;
  files: number;
} {
  return folder.children.reduce(
    (totals, child) => {
      const nestedCounts = getFolderDescendantCounts(child);

      return {
        folders: totals.folders + 1 + nestedCounts.folders,
        files: totals.files + child.files.length + nestedCounts.files,
      };
    },
    {
      folders: 0,
      files: folder.files.length,
    },
  );
}

export function folderHasContents(folder: WorkspaceFolder) {
  return folder.files.length > 0 || folder.children.length > 0 || (folder.separators?.length ?? 0) > 0;
}

export function findFolderById(
  folders: WorkspaceFolder[],
  folderId: string,
): WorkspaceFolder | null {
  for (const folder of folders) {
    if (folder.id === folderId) {
      return folder;
    }

    const nestedFolder = findFolderById(folder.children, folderId);

    if (nestedFolder) {
      return nestedFolder;
    }
  }

  return null;
}

export function findFileById(
  folders: WorkspaceFolder[],
  fileId: string,
): { file: WorkspaceFile; folderId: string } | null {
  for (const folder of folders) {
    const file = folder.files.find((candidate) => candidate.id === fileId);

    if (file) {
      return { file, folderId: folder.id };
    }

    const nestedFile = findFileById(folder.children, fileId);

    if (nestedFile) {
      return nestedFile;
    }
  }

  return null;
}

export function findFolderPathById(
  folders: WorkspaceFolder[],
  folderId: string,
  ancestors: WorkspaceFolder[] = [],
): WorkspaceFolder[] | null {
  for (const folder of folders) {
    const nextAncestors = [...ancestors, folder];

    if (folder.id === folderId) {
      return nextAncestors;
    }

    const nestedPath = findFolderPathById(folder.children, folderId, nextAncestors);

    if (nestedPath) {
      return nestedPath;
    }
  }

  return null;
}

export function findFilePathById(
  folders: WorkspaceFolder[],
  fileId: string,
  ancestors: WorkspaceFolder[] = [],
): { file: WorkspaceFile; folders: WorkspaceFolder[] } | null {
  for (const folder of folders) {
    const nextAncestors = [...ancestors, folder];
    const file = folder.files.find((candidate) => candidate.id === fileId);

    if (file) {
      return { file, folders: nextAncestors };
    }

    const nestedPath = findFilePathById(folder.children, fileId, nextAncestors);

    if (nestedPath) {
      return nestedPath;
    }
  }

  return null;
}

export function collectFilesInFolder(folder: WorkspaceFolder): WorkspaceFile[] {
  return [
    ...folder.files,
    ...folder.children.flatMap((childFolder) => collectFilesInFolder(childFolder)),
  ];
}

export function renameFolderById(
  folders: WorkspaceFolder[],
  folderId: string,
  label: string,
): WorkspaceFolder[] {
  return mapFolders(folders, (folder) =>
    folder.id === folderId
      ? {
          ...folder,
          label,
        }
      : folder,
  );
}

export function renameFileById(
  folders: WorkspaceFolder[],
  fileId: string,
  label: string,
): WorkspaceFolder[] {
  return mapFolders(folders, (folder) => ({
    ...folder,
    files: folder.files.map((file) =>
      file.id === fileId
        ? {
            ...file,
            label,
          }
        : file,
    ),
  }));
}

export function deleteFolderById(
  folders: WorkspaceFolder[],
  folderId: string,
): WorkspaceFolder[] {
  return removeFolderById(folders, folderId);
}

export function deleteFileById(
  folders: WorkspaceFolder[],
  fileId: string,
): WorkspaceFolder[] {
  return mapFolders(folders, (folder) => ({
    ...folder,
    files: folder.files.filter((file) => file.id !== fileId),
  }));
}

export function addFileToFolderById(
  folders: WorkspaceFolder[],
  folderId: string,
  file: WorkspaceFile,
): WorkspaceFolder[] {
  return mapFolders(folders, (folder) =>
    folder.id === folderId
      ? {
          ...folder,
          files: [...folder.files.filter((candidate) => candidate.id !== file.id), file],
          itemOrder: [
            ...(folder.itemOrder ?? []),
            {
              type: 'file',
              id: file.id,
            } satisfies WorkspaceFolderOrderEntry,
          ],
        }
      : folder,
  );
}

export function addSeparatorToFolderById(
  folders: WorkspaceFolder[],
  folderId: string,
  separator: WorkspaceSeparator,
): WorkspaceFolder[] {
  return mapFolders(folders, (folder) =>
    folder.id === folderId
      ? {
          ...folder,
          separators: [
            ...(folder.separators ?? []).filter((candidate) => candidate.id !== separator.id),
            separator,
          ],
          itemOrder: [
            ...(folder.itemOrder ?? []),
            {
              type: 'separator',
              id: separator.id,
            } satisfies WorkspaceFolderOrderEntry,
          ],
        }
      : folder,
  );
}

export function deleteSeparatorById(
  folders: WorkspaceFolder[],
  separatorId: string,
): WorkspaceFolder[] {
  return removeSeparatorByIdInternal(folders, separatorId);
}

export function moveSeparatorById(
  folders: WorkspaceFolder[],
  separatorId: string,
  targetFolderId: string,
  targetIndex: number,
): WorkspaceFolder[] {
  const existingMatch = findSeparatorById(folders, separatorId);

  if (!existingMatch) {
    return folders;
  }

  const sourceFolder = findFolderById(folders, existingMatch.folderId);
  const sourceIndex = sourceFolder
    ? (sourceFolder.itemOrder ?? []).findIndex(
        (entry) => entry.type === 'separator' && entry.id === separatorId,
      )
    : -1;

  const foldersWithoutSeparator = removeSeparatorByIdInternal(folders, separatorId);
  const separator = existingMatch.separator;

  if (!findFolderById(foldersWithoutSeparator, targetFolderId)) {
    return folders;
  }

  const resolvedTargetIndex =
    existingMatch.folderId === targetFolderId &&
    sourceIndex >= 0 &&
    targetIndex > sourceIndex
      ? targetIndex - 1
      : targetIndex;

  return insertSeparatorIntoFolder(
    foldersWithoutSeparator,
    targetFolderId,
    separator,
    resolvedTargetIndex,
  );
}

export function getOrderedWorkspaceFolderItems(
  folder: WorkspaceFolder,
): OrderedWorkspaceFolderItem[] {
  const normalizedFolder = normalizeFolderOrdering(folder);
  const childrenById = new Map(normalizedFolder.children.map((child) => [child.id, child]));
  const filesById = new Map(normalizedFolder.files.map((file) => [file.id, file]));
  const separatorsById = new Map(
    (normalizedFolder.separators ?? []).map((separator) => [separator.id, separator]),
  );

  return (normalizedFolder.itemOrder ?? []).reduce<OrderedWorkspaceFolderItem[]>((items, entry) => {
    if (entry.type === 'folder') {
      const childFolder = childrenById.get(entry.id);

      if (childFolder) {
        items.push({
          type: 'folder',
          folder: childFolder,
        });
      }

      return items;
    }

    if (entry.type === 'file') {
      const file = filesById.get(entry.id);

      if (file) {
        items.push({
          type: 'file',
          file,
        });
      }

      return items;
    }

    const separator = separatorsById.get(entry.id);

    if (separator) {
      items.push({
        type: 'separator',
        separator,
      });
    }

    return items;
  }, []);
}

export function filterWorkspaceFolders(
  folders: WorkspaceFolder[],
  rawQuery: string,
): WorkspaceFolder[] {
  const query = rawQuery.trim().toLowerCase();

  if (!query) {
    return folders;
  }

  return folders.flatMap((folder) => {
    const folderMatches = folder.label.toLowerCase().includes(query);
    const matchingFiles = folder.files.filter(
      (file) =>
        file.label.toLowerCase().includes(query) ||
        file.description.toLowerCase().includes(query),
    );
    const matchingChildren = filterWorkspaceFolders(folder.children, query);

    if (!folderMatches && !matchingFiles.length && !matchingChildren.length) {
      return [];
    }

    return [
      normalizeFolderOrdering({
        ...folder,
        children: folderMatches ? folder.children : matchingChildren,
        files: folderMatches ? folder.files : matchingFiles,
        separators: folderMatches ? folder.separators ?? [] : [],
        itemOrder: folderMatches ? folder.itemOrder : undefined,
      }),
    ];
  });
}
