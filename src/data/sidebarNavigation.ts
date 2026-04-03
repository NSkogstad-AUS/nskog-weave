export interface WorkspaceFile {
  id: string;
  label: string;
  description: string;
  kind: 'canvas' | 'brief' | 'memo' | 'outline';
}

export interface WorkspaceFolder {
  id: string;
  label: string;
  children: WorkspaceFolder[];
  files: WorkspaceFile[];
}

const WORKSPACE_FOLDERS_SEED: WorkspaceFolder[] = [
  {
    id: 'general-knowledge',
    label: 'General Knowledge',
    files: [
      {
        id: 'knowledge-map',
        label: 'Knowledge Map',
        description: 'Master canvas for evidence, claims, and synthesis.',
        kind: 'canvas',
      },
    ],
    children: [
      {
        id: 'onboarding',
        label: 'Onboarding',
        files: [
          {
            id: 'onboarding-brief',
            label: 'Onboarding Brief',
            description: 'Working brief for first-week clarity and handoff risk.',
            kind: 'brief',
          },
        ],
        children: [
          {
            id: 'subfolder-1',
            label: 'Subfolder 1',
            files: [
              {
                id: 'retention-memo',
                label: 'Retention Memo',
                description: 'A memo that tracks early warning signals and next actions.',
                kind: 'memo',
              },
            ],
            children: [],
          },
          {
            id: 'subfolder-2',
            label: 'Subfolder 2',
            files: [
              {
                id: 'research-outline',
                label: 'Research Outline',
                description: 'Outline for stitching notes into a product narrative.',
                kind: 'outline',
              },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'integrations',
        label: 'Integrations',
        files: [
          {
            id: 'integration-board',
            label: 'Integration Board',
            description: 'A canvas focused on implementation friction and dependencies.',
            kind: 'canvas',
          },
        ],
        children: [],
      },
      {
        id: 'documents',
        label: 'Documents',
        files: [
          {
            id: 'document-scan',
            label: 'Document Scan',
            description: 'Source-heavy workspace for imported material and summaries.',
            kind: 'brief',
          },
        ],
        children: [],
      },
    ],
  },
  {
    id: 'onboarding-design',
    label: 'Onboarding Design',
    files: [
      {
        id: 'design-review',
        label: 'Design Review',
        description: 'Dashboard file for interface notes, patterns, and refinements.',
        kind: 'canvas',
      },
    ],
    children: [],
  },
  {
    id: 'team-interviews',
    label: 'Team Interviews',
    files: [
      {
        id: 'interview-signals',
        label: 'Interview Signals',
        description: 'Themed workspace for qualitative interview learnings.',
        kind: 'memo',
      },
    ],
    children: [],
  },
];

function cloneFolders(folders: WorkspaceFolder[]): WorkspaceFolder[] {
  return folders.map((folder) => ({
    ...folder,
    files: folder.files.map((file) => ({ ...file })),
    children: cloneFolders(folder.children),
  }));
}

export function createWorkspaceFolders(): WorkspaceFolder[] {
  return cloneFolders(WORKSPACE_FOLDERS_SEED);
}

export function getAllFolderIds(folders: WorkspaceFolder[]): string[] {
  return folders.flatMap((folder) => [folder.id, ...getAllFolderIds(folder.children)]);
}

export function getFolderItemCount(folder: WorkspaceFolder): number {
  return (
    folder.files.length +
    folder.children.reduce(
      (total, child) => total + 1 + getFolderItemCount(child),
      0,
    )
  );
}

export function folderHasContents(folder: WorkspaceFolder) {
  return folder.files.length > 0 || folder.children.length > 0;
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

export function renameFolderById(
  folders: WorkspaceFolder[],
  folderId: string,
  label: string,
): WorkspaceFolder[] {
  return folders.map((folder) =>
    folder.id === folderId
      ? {
          ...folder,
          label,
        }
      : {
          ...folder,
          children: renameFolderById(folder.children, folderId, label),
        },
  );
}

export function renameFileById(
  folders: WorkspaceFolder[],
  fileId: string,
  label: string,
): WorkspaceFolder[] {
  return folders.map((folder) => ({
    ...folder,
    files: folder.files.map((file) =>
      file.id === fileId
        ? {
            ...file,
            label,
          }
        : file,
    ),
    children: renameFileById(folder.children, fileId, label),
  }));
}

export function deleteFolderById(
  folders: WorkspaceFolder[],
  folderId: string,
): WorkspaceFolder[] {
  return folders
    .filter((folder) => folder.id !== folderId)
    .map((folder) => ({
      ...folder,
      children: deleteFolderById(folder.children, folderId),
    }));
}

export function deleteFileById(
  folders: WorkspaceFolder[],
  fileId: string,
): WorkspaceFolder[] {
  return folders.map((folder) => ({
    ...folder,
    files: folder.files.filter((file) => file.id !== fileId),
    children: deleteFileById(folder.children, fileId),
  }));
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
      {
        ...folder,
        files: folderMatches ? folder.files : matchingFiles,
        children: folderMatches ? folder.children : matchingChildren,
      },
    ];
  });
}
