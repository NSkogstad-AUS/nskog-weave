import { FileTextIcon, LayoutGridIcon, ListIcon } from 'lucide-react';

import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/animate-ui/components/radix/toggle-group';
import type { WorkspaceFile } from '@/data/sidebarNavigation';
import type { FilePageView } from '@/types/filePage';
import { FileCanvasView } from './FileCanvasView';
import { FileExplorerView } from './FileExplorerView';

interface FileWorkspaceProps {
  activeFile: WorkspaceFile | null;
  activeView: FilePageView | null;
  nodes: Array<{
    id: string;
    label: string;
    kind: 'folder' | 'file' | 'element';
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
    kind: 'folder' | 'file' | 'element';
    position: { x: number; y: number };
    size: {
      widthUnits: 1 | 2 | 3;
      heightUnits: 1 | 2 | 3;
    };
  }) => void;
  onSelectNodes: (nodeIds: string[]) => void;
  onViewChange: (view: FilePageView) => void;
}

export function FileWorkspace({
  activeFile,
  activeView,
  nodes,
  selectedNodeIds,
  onMoveNodes,
  onResizeNode,
  onAddNode,
  onSelectNodes,
  onViewChange,
}: FileWorkspaceProps) {
  if (!activeFile || !activeView) {
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
                {activeFile.label}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Switch between a freeform canvas and a structured file explorer.
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
            nodes={nodes}
            selectedNodeIds={selectedNodeIds}
            onMoveNodes={onMoveNodes}
            onResizeNode={onResizeNode}
            onAddNode={onAddNode}
            onSelectNodes={onSelectNodes}
          />
        ) : (
          <FileExplorerView
            nodes={nodes}
            selectedNodeIds={selectedNodeIds}
            onSelectNode={(nodeId) => onSelectNodes([nodeId])}
          />
        )}
      </div>
    </div>
  );
}
