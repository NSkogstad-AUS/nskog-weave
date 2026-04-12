import { useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import {
  ArrowUpDownIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronUpIcon,
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
        'group flex min-w-0 items-center gap-1 rounded-[1.1rem] border border-slate-200/80 bg-white/88 px-3 py-2 text-left shadow-[0_12px_30px_-28px_rgba(15,23,42,0.34)] transition',
        'cursor-grab active:cursor-grabbing hover:-translate-y-px hover:border-slate-300/80 hover:bg-white',
        isDragging && 'border-sky-300/80 bg-sky-50/90 shadow-[0_18px_34px_-28px_rgba(14,165,233,0.85)]',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[0.95rem] text-slate-600">
        <Icon className="size-4" />
      </span>
      <span className="-ml-0.5 min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-950">{item.label}</span>
      </span>
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
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const toolbarRef = useRef<HTMLElement | null>(null);
  const items = [...structureItems, ...workerItems];

  useLayoutEffect(() => {
    const toolbarElement = toolbarRef.current;

    if (!toolbarElement) {
      return;
    }

    const updateToolbarHeight = () => {
      setToolbarHeight(toolbarElement.getBoundingClientRect().height);
    };

    updateToolbarHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateToolbarHeight();
    });

    resizeObserver.observe(toolbarElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [items.length]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-5 z-30 flex justify-center px-4">
      <div
        data-canvas-chrome="true"
        onContextMenuCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className="pointer-events-auto flex max-w-full flex-col items-center"
      >
        <div
          className={cn(
            'w-full max-w-[min(100%,72rem)] overflow-hidden transition-[height,opacity,transform] duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height,opacity,transform]',
            isCollapsed ? '-translate-y-0.5 opacity-0' : 'translate-y-0 opacity-100',
          )}
          style={{
            height: isCollapsed ? 0 : toolbarHeight,
          }}
        >
          <nav
            id="canvas-insert-toolbar"
            ref={toolbarRef}
            className={cn(
              'panel-surface flex max-w-full items-center gap-2 overflow-x-auto rounded-[1.6rem] p-2 soft-scrollbar',
              'transition-[transform,opacity] duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity]',
              isCollapsed
                ? '-translate-y-2 opacity-0 pointer-events-none'
                : 'translate-y-0 opacity-100',
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

        <button
          type="button"
          onClick={() => setIsCollapsed((current) => !current)}
          aria-expanded={!isCollapsed}
          aria-controls="canvas-insert-toolbar"
          className={cn(
            'flex h-11 items-center justify-center rounded-[1.05rem] border border-slate-200/85 bg-white/92 px-4 shadow-[0_20px_40px_-30px_rgba(15,23,42,0.32)] backdrop-blur-md transition-[width,margin,transform,background-color,border-color,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
            isCollapsed ? 'mt-0.5 w-44 -translate-y-1' : 'mt-2 w-24 translate-y-0',
            'hover:-translate-y-px hover:border-slate-300/85 hover:bg-white',
          )}
          aria-label={isCollapsed ? 'Show header tools' : 'Hide header tools'}
        >
          {isCollapsed ? (
            <ChevronDownIcon className="size-4 shrink-0 text-slate-500" />
          ) : (
            <ChevronUpIcon className="size-4 shrink-0 text-slate-500" />
          )}
        </button>
      </div>
    </div>
  );
}
