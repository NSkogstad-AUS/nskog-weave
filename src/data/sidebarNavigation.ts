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

type FolderLocation = {
  folder: WorkspaceFolder;
  parentFolder: WorkspaceFolder | null;
  parentFolderId: string | null;
  index: number;
  orderIndex: number;
};

type FileLocation = {
  file: WorkspaceFile;
  parentFolder: WorkspaceFolder;
  parentFolderId: string;
  index: number;
  orderIndex: number;
};

type SeparatorLocation = {
  separator: WorkspaceSeparator;
  parentFolder: WorkspaceFolder;
  parentFolderId: string;
  index: number;
  orderIndex: number;
};

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

function findFolderLocation(
  folders: WorkspaceFolder[],
  folderId: string,
  parentFolder: WorkspaceFolder | null = null,
): FolderLocation | null {
  for (const [index, folder] of folders.entries()) {
    if (folder.id === folderId) {
      return {
        folder,
        parentFolder,
        parentFolderId: parentFolder?.id ?? null,
        index,
        orderIndex: parentFolder
          ? (parentFolder.itemOrder ?? []).findIndex(
              (entry) => entry.type === 'folder' && entry.id === folderId,
            )
          : index,
      };
    }

    const nestedLocation = findFolderLocation(folder.children, folderId, folder);

    if (nestedLocation) {
      return nestedLocation;
    }
  }

  return null;
}

function findFileLocation(
  folders: WorkspaceFolder[],
  fileId: string,
): FileLocation | null {
  for (const folder of folders) {
    const index = folder.files.findIndex((candidate) => candidate.id === fileId);

    if (index >= 0) {
      return {
        file: folder.files[index],
        parentFolder: folder,
        parentFolderId: folder.id,
        index,
        orderIndex: (folder.itemOrder ?? []).findIndex(
          (entry) => entry.type === 'file' && entry.id === fileId,
        ),
      };
    }

    const nestedLocation = findFileLocation(folder.children, fileId);

    if (nestedLocation) {
      return nestedLocation;
    }
  }

  return null;
}

function findSeparatorLocation(
  folders: WorkspaceFolder[],
  separatorId: string,
): SeparatorLocation | null {
  for (const folder of folders) {
    const separators = folder.separators ?? [];
    const index = separators.findIndex((candidate) => candidate.id === separatorId);

    if (index >= 0) {
      return {
        separator: separators[index],
        parentFolder: folder,
        parentFolderId: folder.id,
        index,
        orderIndex: (folder.itemOrder ?? []).findIndex(
          (entry) => entry.type === 'separator' && entry.id === separatorId,
        ),
      };
    }

    const nestedLocation = findSeparatorLocation(folder.children, separatorId);

    if (nestedLocation) {
      return nestedLocation;
    }
  }

  return null;
}

function folderContainsDescendant(
  folder: WorkspaceFolder,
  descendantId: string,
): boolean {
  return folder.children.some(
    (child) =>
      child.id === descendantId || folderContainsDescendant(child, descendantId),
  );
}

function normalizeWorkspaceFolders(folders: WorkspaceFolder[]) {
  return folders.map((folder) => normalizeFolderOrdering(folder));
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getSearchTokens(value: string) {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}

function searchTokenMatches(token: string, candidateTokens: string[]) {
  if (/^\d+$/.test(token)) {
    return candidateTokens.some((candidate) => candidate === token);
  }

  return candidateTokens.some(
    (candidate) =>
      candidate.includes(token) ||
      token.includes(candidate),
  );
}

function searchableFileText(file: WorkspaceFile) {
  return [
    file.label,
    file.description,
    file.kind,
    file.mimeType ?? '',
  ].join(' ');
}

function searchTextMatches(value: string, queryTokens: string[]) {
  if (queryTokens.length === 0) {
    return true;
  }

  const candidateTokens = getSearchTokens(value);
  const compactCandidate = candidateTokens.join('');
  const compactQuery = queryTokens.join('');

  if (candidateTokens.length === 0) {
    return false;
  }

  return (
    compactCandidate.includes(compactQuery) ||
    queryTokens.every((token) => searchTokenMatches(token, candidateTokens))
  );
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

export function updateFileContentById(
  folders: WorkspaceFolder[],
  fileId: string,
  contentText: string,
): WorkspaceFolder[] {
  return mapFolders(folders, (folder) => ({
    ...folder,
    files: folder.files.map((file) =>
      file.id === fileId
        ? {
            ...file,
            contentText,
            sizeBytes: contentText.length,
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
  return moveWorkspaceItemById(
    folders,
    {
      type: 'separator',
      id: separatorId,
    },
    targetFolderId,
    targetIndex,
  );
}

export function moveWorkspaceItemById(
  folders: WorkspaceFolder[],
  item: WorkspaceFolderOrderEntry,
  targetParentFolderId: string | null,
  targetIndex: number,
): WorkspaceFolder[] {
  const nextFolders = cloneFolders(folders);

  if (item.type === 'folder') {
    const sourceLocation = findFolderLocation(nextFolders, item.id);

    if (!sourceLocation) {
      return folders;
    }

    if (targetParentFolderId === sourceLocation.folder.id) {
      return folders;
    }

    if (
      targetParentFolderId &&
      folderContainsDescendant(sourceLocation.folder, targetParentFolderId)
    ) {
      return folders;
    }

    if (sourceLocation.parentFolder) {
      sourceLocation.parentFolder.children = sourceLocation.parentFolder.children.filter(
        (candidate) => candidate.id !== item.id,
      );
      sourceLocation.parentFolder.itemOrder = (sourceLocation.parentFolder.itemOrder ?? []).filter(
        (entry) => !(entry.type === 'folder' && entry.id === item.id),
      );
    } else {
      nextFolders.splice(sourceLocation.index, 1);
    }

    const resolvedTargetIndex =
      sourceLocation.parentFolderId === targetParentFolderId &&
      sourceLocation.orderIndex >= 0 &&
      targetIndex > sourceLocation.orderIndex
        ? targetIndex - 1
        : targetIndex;

    if (!targetParentFolderId) {
      nextFolders.splice(
        Math.max(0, Math.min(resolvedTargetIndex, nextFolders.length)),
        0,
        sourceLocation.folder,
      );

      return normalizeWorkspaceFolders(nextFolders);
    }

    const targetFolder = findFolderById(nextFolders, targetParentFolderId);

    if (!targetFolder) {
      return folders;
    }

    targetFolder.children = [
      ...targetFolder.children.filter((candidate) => candidate.id !== item.id),
      sourceLocation.folder,
    ];
    targetFolder.itemOrder = insertAtIndex(
      (targetFolder.itemOrder ?? []).filter(
        (entry) => !(entry.type === 'folder' && entry.id === item.id),
      ),
      resolvedTargetIndex,
      {
        type: 'folder',
        id: item.id,
      } satisfies WorkspaceFolderOrderEntry,
    );

    return normalizeWorkspaceFolders(nextFolders);
  }

  if (!targetParentFolderId) {
    return folders;
  }

  const targetFolder = findFolderById(nextFolders, targetParentFolderId);

  if (!targetFolder) {
    return folders;
  }

  if (item.type === 'file') {
    const sourceLocation = findFileLocation(nextFolders, item.id);

    if (!sourceLocation) {
      return folders;
    }

    sourceLocation.parentFolder.files = sourceLocation.parentFolder.files.filter(
      (candidate) => candidate.id !== item.id,
    );
    sourceLocation.parentFolder.itemOrder = (sourceLocation.parentFolder.itemOrder ?? []).filter(
      (entry) => !(entry.type === 'file' && entry.id === item.id),
    );

    const resolvedTargetIndex =
      sourceLocation.parentFolderId === targetParentFolderId &&
      sourceLocation.orderIndex >= 0 &&
      targetIndex > sourceLocation.orderIndex
        ? targetIndex - 1
        : targetIndex;

    targetFolder.files = [
      ...targetFolder.files.filter((candidate) => candidate.id !== item.id),
      sourceLocation.file,
    ];
    targetFolder.itemOrder = insertAtIndex(
      (targetFolder.itemOrder ?? []).filter(
        (entry) => !(entry.type === 'file' && entry.id === item.id),
      ),
      resolvedTargetIndex,
      {
        type: 'file',
        id: item.id,
      } satisfies WorkspaceFolderOrderEntry,
    );

    return normalizeWorkspaceFolders(nextFolders);
  }

  const sourceLocation = findSeparatorLocation(nextFolders, item.id);

  if (!sourceLocation) {
    return folders;
  }

  sourceLocation.parentFolder.separators = (
    sourceLocation.parentFolder.separators ?? []
  ).filter((candidate) => candidate.id !== item.id);
  sourceLocation.parentFolder.itemOrder = (sourceLocation.parentFolder.itemOrder ?? []).filter(
    (entry) => !(entry.type === 'separator' && entry.id === item.id),
  );

  const resolvedTargetIndex =
    sourceLocation.parentFolderId === targetParentFolderId &&
    sourceLocation.orderIndex >= 0 &&
    targetIndex > sourceLocation.orderIndex
      ? targetIndex - 1
      : targetIndex;

  targetFolder.separators = [
    ...(targetFolder.separators ?? []).filter((candidate) => candidate.id !== item.id),
    sourceLocation.separator,
  ];
  targetFolder.itemOrder = insertAtIndex(
    (targetFolder.itemOrder ?? []).filter(
      (entry) => !(entry.type === 'separator' && entry.id === item.id),
    ),
    resolvedTargetIndex,
    {
      type: 'separator',
      id: item.id,
    } satisfies WorkspaceFolderOrderEntry,
  );

  return normalizeWorkspaceFolders(nextFolders);
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
  const queryTokens = getSearchTokens(rawQuery);

  if (queryTokens.length === 0) {
    return folders;
  }

  return folders.flatMap((folder) => {
    const folderMatches = searchTextMatches(folder.label, queryTokens);
    const matchingFiles = folder.files.filter(
      (file) => searchTextMatches(searchableFileText(file), queryTokens),
    );
    const matchingChildren = filterWorkspaceFolders(folder.children, rawQuery);

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
