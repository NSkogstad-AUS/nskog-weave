export interface WorkspaceFolder {
  id: string;
  label: string;
  count: number;
  children?: WorkspaceFolder[];
}

export interface DashboardFile {
  id: string;
  folderId: string;
  label: string;
  description: string;
  kind: 'canvas' | 'brief' | 'memo' | 'outline';
}

export const workspaceFolders: WorkspaceFolder[] = [
  {
    id: 'general-knowledge',
    label: 'General Knowledge',
    count: 10,
    children: [
      {
        id: 'onboarding',
        label: 'Onboarding',
        count: 3,
        children: [
          {
            id: 'subfolder-1',
            label: 'Subfolder 1',
            count: 5,
          },
          {
            id: 'subfolder-2',
            label: 'Subfolder 2',
            count: 10,
          },
        ],
      },
      {
        id: 'integrations',
        label: 'Integrations',
        count: 4,
      },
      {
        id: 'documents',
        label: 'Documents',
        count: 8,
      },
    ],
  },
  {
    id: 'onboarding-design',
    label: 'Onboarding Design',
    count: 6,
  },
  {
    id: 'team-interviews',
    label: 'Team Interviews',
    count: 7,
  },
];

export const dashboardFiles: DashboardFile[] = [
  {
    id: 'knowledge-map',
    folderId: 'general-knowledge',
    label: 'Knowledge Map',
    description: 'Master canvas for evidence, claims, and synthesis.',
    kind: 'canvas',
  },
  {
    id: 'onboarding-brief',
    folderId: 'onboarding',
    label: 'Onboarding Brief',
    description: 'Working brief for first-week clarity and handoff risk.',
    kind: 'brief',
  },
  {
    id: 'retention-memo',
    folderId: 'subfolder-1',
    label: 'Retention Memo',
    description: 'A memo that tracks early warning signals and next actions.',
    kind: 'memo',
  },
  {
    id: 'research-outline',
    folderId: 'subfolder-2',
    label: 'Research Outline',
    description: 'Outline for stitching notes into a product narrative.',
    kind: 'outline',
  },
  {
    id: 'integration-board',
    folderId: 'integrations',
    label: 'Integration Board',
    description: 'A canvas focused on implementation friction and dependencies.',
    kind: 'canvas',
  },
  {
    id: 'document-scan',
    folderId: 'documents',
    label: 'Document Scan',
    description: 'Source-heavy workspace for imported material and summaries.',
    kind: 'brief',
  },
  {
    id: 'design-review',
    folderId: 'onboarding-design',
    label: 'Design Review',
    description: 'Dashboard file for interface notes, patterns, and refinements.',
    kind: 'canvas',
  },
  {
    id: 'interview-signals',
    folderId: 'team-interviews',
    label: 'Interview Signals',
    description: 'Themed workspace for qualitative interview learnings.',
    kind: 'memo',
  },
];

export function findFolderById(
  folders: WorkspaceFolder[],
  folderId: string,
): WorkspaceFolder | null {
  for (const folder of folders) {
    if (folder.id === folderId) {
      return folder;
    }

    if (folder.children?.length) {
      const nestedFolder = findFolderById(folder.children, folderId);

      if (nestedFolder) {
        return nestedFolder;
      }
    }
  }

  return null;
}

export function collectFolderIds(folder: WorkspaceFolder): string[] {
  return [
    folder.id,
    ...(folder.children?.flatMap((child) => collectFolderIds(child)) ?? []),
  ];
}

