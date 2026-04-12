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
      className="flex size-8 items-center justify-center rounded-xl border border-slate-200/80 bg-white/90 text-slate-500 transition hover:border-slate-300/85 hover:bg-white hover:text-slate-700"
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

  return (
    <section
      className="absolute z-50 overflow-hidden rounded-[1.45rem] border border-slate-200/85 bg-white/96 shadow-[0_38px_90px_-52px_rgba(15,23,42,0.38)] backdrop-blur-md"
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
          'flex h-[60px] items-center justify-between gap-3 border-b border-slate-200/80 px-4',
          isMinimized && 'border-b-transparent',
        )}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-3 cursor-grab active:cursor-grabbing"
          onPointerDown={onHeaderPointerDown}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/90 text-slate-600 shadow-[0_12px_30px_-26px_rgba(15,23,42,0.3)]">
            {target.type === 'file' ? (
              <FileTextIcon className="size-4" />
            ) : (
              <FolderIcon className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950">{target.label}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400">
              {metaBadges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-slate-200/80 bg-white/90 px-2 py-0.5"
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

      {!isMinimized ? (
        <div className="flex h-[calc(100%-60px)] min-h-0 flex-col">
          {target.description.trim().length > 0 ? (
            <div className="border-b border-slate-200/70 px-4 py-3 text-sm leading-6 text-slate-500">
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
                  'h-full w-full resize-none border-0 bg-transparent px-4 py-4 font-mono text-[13px] leading-6 text-slate-700 outline-none',
                  !target.editable && 'cursor-default text-slate-600',
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
                          'flex w-full items-start gap-3 rounded-[1rem] border border-slate-200/75 bg-white/88 px-3 py-3 text-left transition hover:border-slate-300/80 hover:bg-slate-50/90',
                          !onOpenItem && 'cursor-default hover:border-slate-200/75 hover:bg-white/88',
                        )}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200/75 bg-slate-50/90 text-slate-500">
                          {item.kind === 'file' ? (
                            <FileTextIcon className="size-4" />
                          ) : (
                            <FolderIcon className="size-4" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900">
                            {item.label}
                          </span>
                          {item.description ? (
                            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-500">
                              {item.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[1.2rem] border border-dashed border-slate-200/90 bg-slate-50/70 px-4 py-5 text-sm leading-6 text-slate-500">
                    This folder does not have previewable items yet.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}

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
