import {
  BotIcon,
  FileTextIcon,
  FolderIcon,
  ShapesIcon,
  SparklesIcon,
} from 'lucide-react';

import { sortFilePageNodes } from '@/lib/filePages';
import { cn } from '@/lib/utils';
import type { FilePageNode } from '@/types/filePage';

interface FileExplorerViewProps {
  className?: string;
  highlightedNodeIds?: string[];
  nodes: FilePageNode[];
  selectedNodeIds: string[];
  onSelectNode: (nodeId: string) => void;
}

const NODE_META = {
  folder: {
    icon: FolderIcon,
    label: 'Folder',
  },
  file: {
    icon: FileTextIcon,
    label: 'File',
  },
  element: {
    icon: SparklesIcon,
    label: 'Element',
  },
  group: {
    icon: ShapesIcon,
    label: 'Group',
  },
  worker: {
    icon: BotIcon,
    label: 'Worker',
  },
} satisfies Record<
  FilePageNode['kind'],
  {
    icon: typeof FolderIcon;
    label: string;
  }
>;

export function FileExplorerView({
  className,
  highlightedNodeIds = [],
  nodes,
  selectedNodeIds,
  onSelectNode,
}: FileExplorerViewProps) {
  const orderedNodes = sortFilePageNodes(nodes);
  const selectedIdSet = new Set(selectedNodeIds);
  const highlightedIdSet = new Set(highlightedNodeIds);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-none border border-slate-200/80 bg-white/88 shadow-[0_36px_90px_-58px_rgba(15,23,42,0.22)] dark:border-slate-600/45 dark:bg-[rgba(30,41,59,0.68)] dark:shadow-[0_36px_90px_-58px_rgba(15,23,42,0.42)]',
        className,
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-slate-200/80 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:border-slate-600/35 dark:text-slate-400">
        <span>Name</span>
        <span>Type</span>
      </div>

      <div className="divide-y divide-slate-100/90 dark:divide-slate-700/55">
        {orderedNodes.map((node) => {
          const meta = NODE_META[node.kind];
          const Icon = meta.icon;

          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node.id)}
              className={cn(
                'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50/90 dark:hover:bg-slate-700/28',
                selectedIdSet.has(node.id) && 'bg-slate-50 dark:bg-slate-700/24',
                !selectedIdSet.has(node.id) &&
                  highlightedIdSet.has(node.id) &&
                  'bg-slate-100/75 dark:bg-slate-700/18',
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white/90 dark:border-slate-600/40 dark:bg-slate-800/72">
                  <Icon className="size-4 text-slate-600 dark:text-slate-200" />
                </span>
                <span className="truncate text-sm font-medium text-slate-950 dark:text-slate-100">{node.label}</span>
              </span>
              <span className="rounded-full border border-slate-200/80 bg-white/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:border-slate-600/40 dark:bg-slate-800/72 dark:text-slate-300">
                {meta.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
