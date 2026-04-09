import { useMemo, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import {
  ArrowUpDownIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  ShapesIcon,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type CanvasPaletteTemplateId = 'ai-worker' | 'sort-worker' | 'group';

export interface CanvasPaletteSidebarItem {
  id: CanvasPaletteTemplateId;
  label: string;
  description: string;
  section: 'Workers' | 'Structure';
}

type CanvasPaletteSection = CanvasPaletteSidebarItem['section'];

interface CanvasPaletteSidebarProps {
  draggedItemId: CanvasPaletteTemplateId | null;
  isCanvasDropActive: boolean;
  isOpen: boolean;
  items: CanvasPaletteSidebarItem[];
  onDragEndItem: () => void;
  onDragStartItem: (
    itemId: CanvasPaletteTemplateId,
    event: ReactDragEvent<HTMLButtonElement>,
  ) => void;
  onInsertItem: (itemId: CanvasPaletteTemplateId) => void;
  onOpenChange: (open: boolean) => void;
}

const SECTION_ORDER: CanvasPaletteSection[] = ['Workers', 'Structure'];

const ITEM_ICON_MAP: Record<CanvasPaletteTemplateId, LucideIcon> = {
  'ai-worker': BotIcon,
  'sort-worker': ArrowUpDownIcon,
  group: ShapesIcon,
};

export function CanvasPaletteSidebar({
  draggedItemId,
  isCanvasDropActive,
  isOpen,
  items,
  onDragEndItem,
  onDragStartItem,
  onInsertItem,
  onOpenChange,
}: CanvasPaletteSidebarProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Workers: true,
    Structure: true,
  });
  const [activeSection, setActiveSection] = useState<CanvasPaletteSection>('Workers');
  const sections = useMemo(
    () =>
      SECTION_ORDER.map((section) => ({
        section,
        items: items.filter((item) => item.section === section),
      })).filter((section) => section.items.length > 0),
    [items],
  );
  const handleSectionSelect = (section: CanvasPaletteSection) => {
    setActiveSection(section);
    setOpenSections((current) => ({
      ...current,
      [section]: true,
    }));

    if (!isOpen) {
      onOpenChange(true);
    }
  };

  return (
    <aside
      data-canvas-chrome="true"
      onContextMenuCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className={cn(
        'hidden h-full shrink-0 border-l border-sidebar-border/80 bg-sidebar/95 backdrop-blur-md transition-[width] duration-300 ease-out md:flex',
        isOpen ? 'w-[19rem]' : 'w-[4.25rem]',
      )}
    >
      <div className={cn('min-w-0 flex-1 flex-col', isOpen ? 'flex' : 'hidden')}>
        <div className="border-b border-sidebar-border/80 px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
            Canvas Tools
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-950">
            Drag blocks into the workflow
          </div>
          <div className="mt-2 text-xs leading-5 text-slate-500">
            Add workers and groups from a docked sidebar instead of the canvas context menu.
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
          <div
            className={cn(
              'rounded-[1.1rem] border px-3.5 py-3 text-xs leading-5 transition',
              isCanvasDropActive
                ? 'border-sky-300/80 bg-sky-50/90 text-sky-700'
                : 'border-slate-200/80 bg-slate-50/80 text-slate-500',
            )}
          >
            {isCanvasDropActive
              ? 'Release anywhere on the canvas to place the block.'
              : 'Click a block to drop it into view, or drag it to a specific spot.'}
          </div>

          <div className="mt-3 space-y-2">
            {sections.map(({ section, items: sectionItems }) => {
              const sectionOpen = openSections[section] ?? true;

              return (
                <div
                  key={section}
                  className="overflow-hidden rounded-[1.2rem] border border-slate-200/80 bg-white/76"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSection(section);
                      setOpenSections((current) => ({
                        ...current,
                        [section]: !sectionOpen,
                      }));
                    }}
                    className={cn(
                      'flex w-full items-center justify-between px-3.5 py-3 text-left transition hover:bg-slate-50/90',
                      activeSection === section && 'bg-slate-50/95',
                    )}
                  >
                    <span
                      className={cn(
                        'text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500',
                        activeSection === section && 'text-slate-700',
                      )}
                    >
                      {section}
                    </span>
                    <ChevronDownIcon
                      className={cn(
                        'size-4 text-slate-400 transition-transform duration-200',
                        activeSection === section && 'text-slate-600',
                        sectionOpen ? 'rotate-0' : '-rotate-90',
                      )}
                    />
                  </button>

                  {sectionOpen ? (
                    <div className="space-y-2 border-t border-slate-200/70 px-2.5 py-2.5">
                      {sectionItems.map((item) => {
                        const Icon = ITEM_ICON_MAP[item.id];
                        const isDragging = draggedItemId === item.id;

                        return (
                          <button
                            key={item.id}
                            type="button"
                            draggable
                            onClick={() => {
                              setActiveSection(item.section);
                              onInsertItem(item.id);
                            }}
                            onDragStart={(event) => onDragStartItem(item.id, event)}
                            onDragEnd={onDragEndItem}
                            className={cn(
                              'group flex w-full items-start gap-3 rounded-[1rem] border border-slate-200/80 bg-white px-3 py-3 text-left transition',
                              isDragging
                                ? 'border-sky-300/80 bg-sky-50/90 shadow-[0_14px_28px_-24px_rgba(14,165,233,0.9)]'
                                : 'hover:-translate-y-px hover:border-slate-300/80 hover:bg-slate-50/95',
                            )}
                          >
                            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[0.95rem] border border-slate-200/80 bg-slate-50/95 text-slate-600 transition group-hover:border-slate-300/80 group-hover:bg-white">
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
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex w-[4.25rem] shrink-0 flex-col border-l border-sidebar-border/80">
        <div className="flex h-16 items-center justify-center border-b border-sidebar-border/80 px-2">
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            onClick={() => onOpenChange(!isOpen)}
            className="size-9 rounded-2xl border-sidebar-border bg-background/80 shadow-sm"
          >
            {isOpen ? (
              <ChevronRightIcon className="size-4 text-slate-600" />
            ) : (
              <ChevronLeftIcon className="size-4 text-slate-600" />
            )}
            <span className="sr-only">Toggle canvas tools sidebar</span>
          </Button>
        </div>

        <div className="flex flex-1 flex-col items-center gap-3 px-2 py-4">
          {sections.map(({ section, items: sectionItems }) => {
            const firstItem = sectionItems[0];

            if (!firstItem) {
              return null;
            }

            const Icon = ITEM_ICON_MAP[firstItem.id];

            return (
              <button
                key={section}
                type="button"
                onClick={() => handleSectionSelect(section)}
                className={cn(
                  'flex w-full flex-col items-center gap-2 rounded-[1.2rem] border px-2 py-3 transition',
                  activeSection === section
                    ? 'border-slate-300/85 bg-slate-100/95 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.45)]'
                    : 'border-slate-200/75 bg-white/80 hover:border-slate-300/80 hover:bg-slate-50/90',
                )}
                aria-pressed={activeSection === section}
                title={section}
              >
                <Icon
                  className={cn(
                    'size-4',
                    activeSection === section ? 'text-slate-700' : 'text-slate-500',
                  )}
                />
                <span
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-[0.22em] [writing-mode:vertical-rl]',
                    activeSection === section ? 'text-slate-600' : 'text-slate-400',
                  )}
                >
                  {section}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
