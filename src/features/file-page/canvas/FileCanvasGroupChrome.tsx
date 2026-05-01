import type { PointerEvent as ReactPointerEvent } from 'react';

import { cn } from '@/lib/utils';
import type { FilePageNode } from '@/types/filePage';
import {
  GROUP_CHROME,
  type GroupResizeAxis,
} from './groupChrome';

interface FileCanvasGroupChromeProps {
  editingLabel: string;
  isEditing: boolean;
  isResizing?: boolean;
  isSelected: boolean;
  node: FilePageNode;
  onCommitRename: (node: FilePageNode) => void;
  onEditingLabelChange: (value: string) => void;
  onResizeHandlePointerDown?: (
    event: ReactPointerEvent<HTMLSpanElement>,
    node: FilePageNode,
    axis: GroupResizeAxis,
  ) => void;
  onStopRename: () => void;
}

export function FileCanvasGroupChrome({
  editingLabel,
  isEditing,
  isResizing = false,
  isSelected,
  node,
  onCommitRename,
  onEditingLabelChange,
  onResizeHandlePointerDown,
  onStopRename,
}: FileCanvasGroupChromeProps) {
  return (
    <>
      <span aria-hidden="true" className={GROUP_CHROME.surfaceClassName} />
      {isSelected || isResizing ? (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 rounded-2xl ring-1 transition-colors',
            isResizing ? 'ring-sky-300/80' : 'ring-slate-900/12 dark:ring-slate-200/14',
          )}
        />
      ) : null}
      <div
        className={GROUP_CHROME.headerContainerClassName}
        style={{ height: GROUP_CHROME.layout.headerHeight }}
      >
        {isEditing ? (
          <input
            autoFocus
            value={editingLabel}
            onChange={(event) => onEditingLabelChange(event.target.value)}
            onBlur={() => onCommitRename(node)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onCommitRename(node);
              }
              if (event.key === 'Escape') {
                onStopRename();
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className={GROUP_CHROME.titleInputClassName}
          />
        ) : (
          <div className={GROUP_CHROME.titleClassName}>{node.label}</div>
        )}
      </div>
      {onResizeHandlePointerDown ? (
        <>
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'top-left')}
            className="absolute left-0 top-0 z-30 size-6 cursor-nwse-resize"
          />
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'right')}
            className="absolute inset-y-3 right-0 z-20 w-5 cursor-ew-resize"
          />
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'bottom')}
            className="absolute inset-x-3 bottom-0 z-20 h-5 cursor-ns-resize"
          />
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'bottom-right')}
            className="absolute bottom-0 right-0 z-30 size-6 cursor-nwse-resize"
          />
        </>
      ) : null}
    </>
  );
}
