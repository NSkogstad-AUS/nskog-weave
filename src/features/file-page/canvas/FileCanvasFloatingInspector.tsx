import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  FileTextIcon,
  FolderIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  XIcon,
} from 'lucide-react';

import { formatUploadedFileSize } from '@/lib/workspaceFiles';
import { cn } from '@/lib/utils';
import type { FilePageContentItem } from '@/types/filePage';

export type CanvasFloatingInspectorTarget =
  | {
      type: 'file';
      label: string;
      description: string;
      textContent: string;
      editable: boolean;
      mimeType: string | null;
      sizeBytes: number | null;
    }
  | {
      type: 'folder';
      label: string;
      description: string;
      items: FilePageContentItem[];
    };

export interface CanvasFloatingInspectorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FileCanvasFloatingInspectorProps {
  rect: CanvasFloatingInspectorRect;
  target: CanvasFloatingInspectorTarget;
  isMinimized: boolean;
  isMaximized: boolean;
  phase: 'opening' | 'open' | 'closing';
  onClose: () => void;
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeHandlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTextChange: (value: string) => void;
  onToggleMaximize: () => void;
  onToggleMinimize: () => void;
  onOpenItem?: (item: FilePageContentItem) => void;
}

function WindowButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className="flex size-8 items-center justify-center rounded-xl border border-slate-200/80 bg-white/90 text-slate-500 transition hover:border-slate-300/85 hover:bg-white hover:text-slate-700 dark:border-slate-600/40 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:border-slate-500/55 dark:hover:bg-slate-700/28 dark:hover:text-slate-100"
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function FileCanvasFloatingInspector({
  rect,
  target,
  isMinimized,
  isMaximized,
  phase,
  onClose,
  onHeaderPointerDown,
  onResizeHandlePointerDown,
  onTextChange,
  onToggleMaximize,
  onToggleMinimize,
  onOpenItem,
}: FileCanvasFloatingInspectorProps) {
  const metaBadges =
    target.type === 'file'
      ? [
          target.mimeType,
          typeof target.sizeBytes === 'number' ? formatUploadedFileSize(target.sizeBytes) : null,
          `${target.textContent.length.toLocaleString()} chars`,
          target.editable ? 'Editable' : 'Read only',
        ].filter((value): value is string => Boolean(value))
      : [
          `${target.items.length} item${target.items.length === 1 ? '' : 's'}`,
        ];
  const contentMaxHeight = Math.max(rect.height - 60, 0);
  const isClosedLike = phase !== 'open';

  return (
    <section
      className={cn(
        'absolute z-20 overflow-hidden rounded-[1.45rem] border border-slate-200/85 bg-white/96 backdrop-blur-md transition-[left,top,width,height,opacity,transform,box-shadow] duration-300 ease-out dark:border-slate-600/45 dark:bg-[rgba(30,41,59,0.9)]',
        isClosedLike
          ? 'opacity-0 scale-[0.985] shadow-[0_20px_55px_-40px_rgba(15,23,42,0.22)] dark:shadow-[0_20px_55px_-40px_rgba(15,23,42,0.38)]'
          : 'opacity-100 scale-100 shadow-[0_38px_90px_-52px_rgba(15,23,42,0.38)] dark:shadow-[0_38px_90px_-52px_rgba(15,23,42,0.48)]',
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: isMinimized ? 60 : rect.height,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div
        className={cn(
          'flex h-[60px] items-center justify-between gap-3 border-b border-slate-200/80 px-4 dark:border-slate-600/35',
          isMinimized && 'border-b-transparent',
        )}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-3 cursor-grab active:cursor-grabbing"
          onPointerDown={onHeaderPointerDown}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/90 text-slate-600 shadow-[0_12px_30px_-26px_rgba(15,23,42,0.3)] dark:border-slate-600/40 dark:bg-slate-800/72 dark:text-slate-200 dark:shadow-[0_12px_30px_-26px_rgba(15,23,42,0.4)]">
            {target.type === 'file' ? (
              <FileTextIcon className="size-4" />
            ) : (
              <FolderIcon className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{target.label}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400 dark:text-slate-400">
              {metaBadges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-slate-200/80 bg-white/90 px-2 py-0.5 dark:border-slate-600/35 dark:bg-slate-800/72"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <WindowButton label={isMinimized ? 'Restore window' : 'Minimize window'} onClick={onToggleMinimize}>
            <MinusIcon className="size-4" />
          </WindowButton>
          <WindowButton label={isMaximized ? 'Restore size' : 'Expand window'} onClick={onToggleMaximize}>
            {isMaximized ? (
              <Minimize2Icon className="size-4" />
            ) : (
              <Maximize2Icon className="size-4" />
            )}
          </WindowButton>
          <WindowButton label="Close window" onClick={onClose}>
            <XIcon className="size-4" />
          </WindowButton>
        </div>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-col overflow-hidden transition-[max-height,opacity] duration-300 ease-out',
          isMinimized && 'pointer-events-none opacity-0',
          !isMinimized && 'opacity-100',
        )}
        style={{
          maxHeight: isMinimized ? 0 : contentMaxHeight,
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {target.description.trim().length > 0 ? (
            <div className="border-b border-slate-200/70 px-4 py-3 text-sm leading-6 text-slate-500 dark:border-slate-600/30 dark:text-slate-300">
              {target.description}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-hidden">
            {target.type === 'file' ? (
              <textarea
                value={target.textContent}
                readOnly={!target.editable}
                onChange={(event) => onTextChange(event.target.value)}
                spellCheck={false}
                className={cn(
                  'h-full w-full resize-none border-0 bg-transparent px-4 py-4 font-mono text-[13px] leading-6 text-slate-700 outline-none dark:text-slate-200',
                  !target.editable && 'cursor-default text-slate-600 dark:text-slate-300',
                )}
                placeholder={
                  target.editable
                    ? 'Start writing here...'
                    : 'No text is available for this item yet.'
                }
              />
            ) : (
              <div className="h-full overflow-y-auto px-3 py-3">
                {target.items.length > 0 ? (
                  <div className="space-y-2">
                    {target.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onOpenItem?.(item)}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-[1rem] border border-slate-200/75 bg-white/88 px-3 py-3 text-left transition hover:border-slate-300/80 hover:bg-slate-50/90 dark:border-slate-600/35 dark:bg-[rgba(30,41,59,0.78)] dark:hover:border-slate-500/55 dark:hover:bg-slate-700/24',
                          !onOpenItem && 'cursor-default hover:border-slate-200/75 hover:bg-white/88 dark:hover:border-slate-600/35 dark:hover:bg-[rgba(30,41,59,0.78)]',
                        )}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200/75 bg-slate-50/90 text-slate-500 dark:border-slate-600/35 dark:bg-slate-800/66 dark:text-slate-300">
                          {item.kind === 'file' ? (
                            <FileTextIcon className="size-4" />
                          ) : (
                            <FolderIcon className="size-4" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                            {item.label}
                          </span>
                          {item.description ? (
                            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-500 dark:text-slate-300">
                              {item.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[1.2rem] border border-dashed border-slate-200/90 bg-slate-50/70 px-4 py-5 text-sm leading-6 text-slate-500 dark:border-slate-600/40 dark:bg-[rgba(51,65,85,0.34)] dark:text-slate-300">
                    This folder does not have previewable items yet.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {!isMinimized ? (
        <div
          role="presentation"
          className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize"
          onPointerDown={onResizeHandlePointerDown}
        />
      ) : null}
    </section>
  );
}
