import type { DragEvent as ReactDragEvent } from 'react';
import {
  ArrowUpDownIcon,
  BotIcon,
  GripVerticalIcon,
  SparklesIcon,
  ShapesIcon,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type {
  CanvasPaletteSidebarItem,
  CanvasPaletteTemplateId,
} from './CanvasPaletteSidebar';

interface FileCanvasFloatingToolbarProps {
  draggedItemId: CanvasPaletteTemplateId | null;
  structureItems: CanvasPaletteSidebarItem[];
  workerItems: CanvasPaletteSidebarItem[];
  onDragEndItem: () => void;
  onDragStartItem: (
    itemId: CanvasPaletteTemplateId,
    event: ReactDragEvent<HTMLElement>,
  ) => void;
  onInsertItem: (itemId: CanvasPaletteTemplateId) => void;
}

const ITEM_ICON_MAP: Record<CanvasPaletteTemplateId, LucideIcon> = {
  'ai-worker': BotIcon,
  'sort-worker': ArrowUpDownIcon,
  group: ShapesIcon,
  element: SparklesIcon,
};

function ToolbarItemButton({
  draggedItemId,
  item,
  onDragEndItem,
  onDragStartItem,
  onInsertItem,
}: {
  draggedItemId: CanvasPaletteTemplateId | null;
  item: CanvasPaletteSidebarItem;
  onDragEndItem: () => void;
  onDragStartItem: (
    itemId: CanvasPaletteTemplateId,
    event: ReactDragEvent<HTMLElement>,
  ) => void;
  onInsertItem: (itemId: CanvasPaletteTemplateId) => void;
}) {
  const Icon = ITEM_ICON_MAP[item.id];
  const isDragging = draggedItemId === item.id;

  return (
    <button
      type="button"
      draggable
      onClick={() => onInsertItem(item.id)}
      onDragStart={(event) => onDragStartItem(item.id, event)}
      onDragEnd={onDragEndItem}
      className={cn(
        'group flex min-w-0 items-center gap-3 rounded-[1.1rem] border border-slate-200/80 bg-white/88 px-3 py-2 text-left shadow-[0_12px_30px_-28px_rgba(15,23,42,0.34)] transition',
        'cursor-grab active:cursor-grabbing hover:-translate-y-px hover:border-slate-300/80 hover:bg-white',
        isDragging && 'border-sky-300/80 bg-sky-50/90 shadow-[0_18px_34px_-28px_rgba(14,165,233,0.85)]',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[0.95rem] border border-slate-200/80 bg-slate-50/90 text-slate-600 transition group-hover:border-slate-300/80 group-hover:bg-white">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-950">{item.label}</span>
          <span className="rounded-full border border-slate-200/80 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Drag
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">{item.section}</span>
      </span>
      <GripVerticalIcon className="size-4 shrink-0 text-slate-300 transition group-hover:text-slate-400" />
    </button>
  );
}

export function FileCanvasFloatingToolbar({
  draggedItemId,
  structureItems,
  workerItems,
  onDragEndItem,
  onDragStartItem,
  onInsertItem,
}: FileCanvasFloatingToolbarProps) {
  const items = [...structureItems, ...workerItems];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-5 z-30 flex justify-center px-4">
      <nav
        data-canvas-chrome="true"
        onContextMenuCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className={cn(
          'panel-surface pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-[1.6rem] p-2',
        )}
        aria-label="Canvas insert toolbar"
      >
        {items.map((item) => (
          <ToolbarItemButton
            key={item.id}
            draggedItemId={draggedItemId}
            item={item}
            onDragEndItem={onDragEndItem}
            onDragStartItem={onDragStartItem}
            onInsertItem={onInsertItem}
          />
        ))}
      </nav>
    </div>
  );
}
