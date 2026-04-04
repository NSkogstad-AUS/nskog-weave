import { LayoutGridIcon, ListIcon } from 'lucide-react';

import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/animate-ui/components/radix/toggle-group';
import { cn } from '@/lib/utils';
import type { FilePageView } from '@/types/filePage';

interface FileWorkspaceHeaderProps {
  activeView: FilePageView;
  breadcrumbCurrent: string;
  breadcrumbPrefix: string;
  pageEyebrow: 'File' | 'Folder';
  onViewChange: (view: FilePageView) => void;
}

export function FileWorkspaceHeader({
  activeView,
  breadcrumbCurrent,
  breadcrumbPrefix,
  pageEyebrow,
  onViewChange,
}: FileWorkspaceHeaderProps) {
  return (
    <div className="pointer-events-none absolute inset-x-5 top-5 z-20 flex items-center justify-between gap-4">
      <div className="pointer-events-auto min-w-56 max-w-[min(42rem,calc(100%-16rem))] rounded-[20px] border border-sidebar-border/80 bg-sidebar/96 p-1 shadow-[0_20px_50px_-22px_rgba(15,23,42,0.45),0_8px_24px_-18px_rgba(15,23,42,0.28)] backdrop-blur-md">
        <div className="flex h-9 items-center gap-2.5 rounded-2xl px-3.5">
          <div className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            <span className="shrink-0">{pageEyebrow}</span>
            <span className="ml-1.5 min-w-0 truncate normal-case tracking-normal text-slate-500">
              {breadcrumbPrefix ? `/${breadcrumbPrefix}/` : '/'}
            </span>
          </div>
          <h1
            className={cn(
              'shrink-0 text-sm font-medium text-slate-950',
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
        className="pointer-events-auto grid w-52 grid-cols-2 rounded-[20px] border border-sidebar-border/80 bg-sidebar/96 p-1 shadow-[0_20px_50px_-22px_rgba(15,23,42,0.45),0_8px_24px_-18px_rgba(15,23,42,0.28)] backdrop-blur-md sm:w-56"
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
  );
}
