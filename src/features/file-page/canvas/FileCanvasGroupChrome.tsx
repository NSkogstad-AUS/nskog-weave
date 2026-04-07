import type { PointerEvent as ReactPointerEvent } from 'react';

import { cn } from '@/lib/utils';
import type { FilePageNode } from '@/types/filePage';
import {
  GROUP_CHROME,
  getGroupGuideStateClassName,
  getGroupHandleStateClassName,
  type GroupResizeAxis,
} from './groupChrome';

interface FileCanvasGroupChromeProps {
  editingLabel: string;
  isEditing: boolean;
  isResizing?: boolean;
  resizeAxis?: GroupResizeAxis;
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
  resizeAxis,
  isSelected,
  node,
  onCommitRename,
  onEditingLabelChange,
  onResizeHandlePointerDown,
  onStopRename,
}: FileCanvasGroupChromeProps) {
  const chromeState = { isSelected, isResizing, resizeAxis };
  const topGuideClassName = getGroupGuideStateClassName('top', chromeState);
  const rightGuideClassName = getGroupGuideStateClassName('right', chromeState);
  const bottomGuideClassName = getGroupGuideStateClassName('bottom', chromeState);
  const leftGuideClassName = getGroupGuideStateClassName('left', chromeState);
  const handleClassName = getGroupHandleStateClassName(chromeState);

  return (
    <>
      <span aria-hidden="true" className={GROUP_CHROME.surfaceClassName} />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute transition-colors duration-150',
          bottomGuideClassName,
        )}
        style={{
          left: GROUP_CHROME.layout.bottomGuide.left,
          right: GROUP_CHROME.layout.bottomGuide.right,
          bottom: GROUP_CHROME.layout.bottomGuide.bottom,
          height: 1,
        }}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute transition-colors duration-150',
          leftGuideClassName,
        )}
        style={{
          top: GROUP_CHROME.layout.sideGuides.top,
          bottom: GROUP_CHROME.layout.sideGuides.bottom,
          left: GROUP_CHROME.layout.sideGuides.left,
          width: 1,
        }}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute transition-colors duration-150',
          rightGuideClassName,
        )}
        style={{
          top: GROUP_CHROME.layout.sideGuides.top,
          bottom: GROUP_CHROME.layout.sideGuides.bottom,
          right: GROUP_CHROME.layout.sideGuides.right,
          width: 1,
        }}
      />
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
        <span
          aria-hidden="true"
          className={cn(GROUP_CHROME.underlineClassName, topGuideClassName)}
          style={{
            left: GROUP_CHROME.layout.underlineInset,
            right: GROUP_CHROME.layout.underlineInset,
          }}
        />
      </div>
      {onResizeHandlePointerDown ? (
        <>
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'top-left')}
            className={cn(
              'absolute z-30 flex size-7 cursor-nwse-resize items-center justify-center rounded-lg border transition-colors',
              handleClassName,
            )}
            style={{
              left: GROUP_CHROME.layout.topLeftHandle.left,
              top: GROUP_CHROME.layout.topLeftHandle.top,
            }}
          >
            <span className="size-3 rounded-tl-[7px] border-l-2 border-t-2 border-current" />
          </span>
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'right')}
            className="absolute inset-y-0 right-0 z-20 w-5 cursor-ew-resize"
            style={{ bottom: GROUP_CHROME.layout.edgeResizeHitAreaInset }}
          />
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'bottom')}
            className="absolute bottom-0 left-0 z-20 h-5 cursor-ns-resize"
            style={{ right: GROUP_CHROME.layout.edgeResizeHitAreaInset }}
          />
          <span
            role="presentation"
            onPointerDown={(event) => onResizeHandlePointerDown(event, node, 'bottom-right')}
            className={cn(
              'absolute z-30 flex size-7 cursor-nwse-resize items-center justify-center rounded-lg border transition-colors',
              handleClassName,
            )}
            style={{
              right: GROUP_CHROME.layout.bottomRightHandle.right,
              bottom: GROUP_CHROME.layout.bottomRightHandle.bottom,
            }}
          >
            <span className="size-3 rounded-br-[7px] border-b-2 border-r-2 border-current" />
          </span>
        </>
      ) : null}
    </>
  );
}
