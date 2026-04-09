import {
  ArrowUpDownIcon,
  BotIcon,
  ChevronDownIcon,
  ShapesIcon,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type {
  CanvasPaletteSidebarItem,
  CanvasPaletteTemplateId,
} from './CanvasPaletteSidebar';

interface FileCanvasFloatingToolbarProps {
  structureItems: CanvasPaletteSidebarItem[];
  workerItems: CanvasPaletteSidebarItem[];
  onInsertItem: (itemId: CanvasPaletteTemplateId) => void;
}

const ITEM_ICON_MAP: Record<CanvasPaletteTemplateId, LucideIcon> = {
  'ai-worker': BotIcon,
  'sort-worker': ArrowUpDownIcon,
  group: ShapesIcon,
};

const SECTION_META = {
  Structure: {
    icon: ShapesIcon,
    label: 'Structure',
  },
  Worker: {
    icon: BotIcon,
    label: 'Worker',
  },
} as const;

function ToolbarMenu({
  items,
  label,
  icon: Icon,
  onInsertItem,
}: {
  items: CanvasPaletteSidebarItem[];
  label: string;
  icon: LucideIcon;
  onInsertItem: (itemId: CanvasPaletteTemplateId) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-10 rounded-2xl px-4 text-slate-700 hover:bg-white/80 hover:text-slate-950 data-[state=open]:bg-white/90 data-[state=open]:text-slate-950"
        >
          <Icon className="size-4" />
          {label}
          <ChevronDownIcon className="size-4 text-slate-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        sideOffset={10}
        className="w-72 min-w-72 rounded-[1.2rem] border border-slate-200/80 bg-white/96 p-2 shadow-[0_20px_45px_-24px_rgba(15,23,42,0.34)]"
      >
        {items.map((item) => {
          const ItemIcon = ITEM_ICON_MAP[item.id];

          return (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => onInsertItem(item.id)}
              className="items-start gap-3 rounded-[1rem] px-3 py-2.5 focus:bg-slate-50"
            >
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[0.95rem] border border-slate-200/80 bg-slate-50/90 text-slate-600">
                <ItemIcon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-950">{item.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                  {item.description}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FileCanvasFloatingToolbar({
  structureItems,
  workerItems,
  onInsertItem,
}: FileCanvasFloatingToolbarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-5 z-30 flex justify-center px-4">
      <nav
        data-canvas-chrome="true"
        onContextMenuCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className={cn(
          'panel-surface pointer-events-auto flex max-w-full items-center gap-1 rounded-[1.6rem] p-1.5',
        )}
        aria-label="Canvas insert toolbar"
      >
        <ToolbarMenu
          items={structureItems}
          label={SECTION_META.Structure.label}
          icon={SECTION_META.Structure.icon}
          onInsertItem={onInsertItem}
        />
        <ToolbarMenu
          items={workerItems}
          label={SECTION_META.Worker.label}
          icon={SECTION_META.Worker.icon}
          onInsertItem={onInsertItem}
        />
      </nav>
    </div>
  );
}
