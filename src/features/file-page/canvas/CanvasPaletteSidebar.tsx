import { useMemo, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import {
  ArrowUpDownIcon,
  BotIcon,
  ChevronDownIcon,
  GripVerticalIcon,
  ShapesIcon,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type CanvasPaletteTemplateId = 'ai-worker' | 'sort-worker' | 'group';

export interface CanvasPaletteSidebarItem {
  id: CanvasPaletteTemplateId;
  label: string;
  description: string;
  section: 'Workers' | 'Structure';
}

interface CanvasPaletteSidebarProps {
  draggedItemId: CanvasPaletteTemplateId | null;
  isCanvasDropActive: boolean;
  items: CanvasPaletteSidebarItem[];
  onDragEndItem: () => void;
  onDragStartItem: (
    itemId: CanvasPaletteTemplateId,
    event: ReactDragEvent<HTMLButtonElement>,
  ) => void;
  onInsertItem: (itemId: CanvasPaletteTemplateId) => void;
}

const SECTION_ORDER = ['Workers', 'Structure'] as const;

const ITEM_ICON_MAP: Record<CanvasPaletteTemplateId, LucideIcon> = {
  'ai-worker': BotIcon,
  'sort-worker': ArrowUpDownIcon,
  group: ShapesIcon,
};

export function CanvasPaletteSidebar({
  draggedItemId,
  isCanvasDropActive,
  items,
  onDragEndItem,
  onDragStartItem,
  onInsertItem,
}: CanvasPaletteSidebarProps) {
  const [isOpen, setIsOpen] = useState(true);
  const sections = useMemo(
    () =>
      SECTION_ORDER.map((section) => ({
        section,
        items: items.filter((item) => item.section === section),
      })).filter((section) => section.items.length > 0),
    [items],
  );

  return (
    <aside
      data-canvas-chrome="true"
      onContextMenuCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDownCapture={(event) => {
        event.stopPropagation();
      }}
      className="pointer-events-auto absolute right-5 top-24 z-30 w-[min(19rem,calc(100%-2.5rem))]"
    >
      <div className="rounded-[1.7rem] border border-slate-200/80 bg-white/84 p-3 shadow-[0_28px_70px_-40px_rgba(15,23,42,0.38),0_14px_30px_-24px_rgba(15,23,42,0.24)] backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          className="flex w-full items-center justify-between rounded-[1.35rem] border border-slate-200/80 bg-white/78 px-4 py-3 text-left transition hover:border-slate-300/85 hover:bg-white"
        >
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              Canvas Shelf
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-950">
              Drag blocks onto the canvas
            </div>
          </div>
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 text-slate-500 transition-transform duration-200',
              isOpen ? 'rotate-0' : '-rotate-90',
            )}
          />
        </button>

        {isOpen ? (
          <div className="mt-3 space-y-3">
            <div
              className={cn(
                'rounded-[1.2rem] border px-3.5 py-3 text-xs leading-5 transition',
                isCanvasDropActive
                  ? 'border-sky-300/80 bg-sky-50/90 text-sky-700'
                  : 'border-slate-200/80 bg-slate-50/80 text-slate-500',
              )}
            >
              {isCanvasDropActive
                ? 'Release anywhere on the canvas to place the block.'
                : 'Click a block to insert it in view, or drag it into position.'}
            </div>

            {sections.map(({ section, items: sectionItems }) => (
              <div
                key={section}
                className="rounded-[1.25rem] border border-slate-200/75 bg-white/72 p-2.5"
              >
                <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  {section}
                </div>
                <div className="space-y-2">
                  {sectionItems.map((item) => {
                    const Icon = ITEM_ICON_MAP[item.id];
                    const isDragging = draggedItemId === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        draggable
                        onClick={() => onInsertItem(item.id)}
                        onDragStart={(event) => onDragStartItem(item.id, event)}
                        onDragEnd={onDragEndItem}
                        className={cn(
                          'group flex w-full items-start gap-3 rounded-[1.15rem] border border-slate-200/75 bg-white px-3 py-3 text-left transition',
                          isDragging
                            ? 'border-sky-300/80 bg-sky-50/90 shadow-[0_14px_28px_-24px_rgba(14,165,233,0.9)]'
                            : 'hover:-translate-y-px hover:border-slate-300/80 hover:bg-slate-50/95',
                        )}
                      >
                        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[1rem] border border-slate-200/80 bg-slate-50/95 text-slate-600 transition group-hover:border-slate-300/80 group-hover:bg-white">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-950">
                              {item.label}
                            </span>
                            <span className="rounded-full border border-slate-200/80 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                              Drag
                            </span>
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-slate-500">
                            {item.description}
                          </span>
                        </span>
                        <GripVerticalIcon className="mt-1 size-4 shrink-0 text-slate-300 transition group-hover:text-slate-400" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
