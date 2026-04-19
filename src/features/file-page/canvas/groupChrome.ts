import {
  GROUP_CONTENT_INSET_BOTTOM,
  GROUP_CONTENT_INSET_LEFT,
  GROUP_CONTENT_INSET_RIGHT,
  GROUP_CONTENT_INSET_TOP,
  GROUP_HEADER_HEIGHT,
  GROUP_TITLE_UNDERLINE_INSET,
} from './constants';

type GroupChromeState = {
  isSelected: boolean;
  isResizing: boolean;
  resizeAxis?: GroupResizeAxis;
};

export type GroupResizeAxis =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'bottom-right';
export type GroupGuideEdge = 'top' | 'right' | 'bottom' | 'left';

export const GROUP_CHROME = {
  frameClassName:
    'border-slate-300/90 bg-[rgba(245,248,252,0.98)] shadow-[0_28px_60px_-44px_rgba(15,23,42,0.3)] dark:border-slate-600/80 dark:bg-[rgba(15,23,42,0.95)] dark:shadow-[0_28px_60px_-44px_rgba(2,6,23,0.82)]',
  frameSelectedClassName: 'border-slate-900/25 ring-2 ring-slate-900/8 dark:border-slate-300/20 dark:ring-slate-200/10',
  frameResizingClassName: 'border-sky-300/85 ring-2 ring-sky-200/80',
  surfaceClassName:
    'pointer-events-none absolute inset-px rounded-[15px] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(241,245,249,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),inset_0_0_0_1px_rgba(148,163,184,0.08)] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(15,23,42,0.98))] dark:shadow-[inset_0_1px_0_rgba(148,163,184,0.08),inset_0_0_0_1px_rgba(51,65,85,0.32)]',
  headerContainerClassName: 'absolute left-4 right-4 top-4',
  titleClassName: 'truncate text-sm font-medium text-slate-950 dark:text-slate-100',
  titleInputClassName:
    'w-full rounded-md border border-slate-200/90 bg-white/95 px-2 py-1 text-sm font-medium text-slate-950 outline-none ring-0 dark:border-slate-700/80 dark:bg-slate-900/90 dark:text-slate-100',
  underlineClassName: 'pointer-events-none absolute bottom-0 h-px',
  guideIdleClassName: 'bg-slate-300/90 dark:bg-slate-600/90',
  guideActiveClassName: 'bg-sky-300/85',
  handleIdleClassName:
    'border-slate-300/90 bg-white/96 text-slate-600 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.22)] dark:border-slate-600/90 dark:bg-slate-900/96 dark:text-slate-300 dark:shadow-[0_10px_24px_-18px_rgba(2,6,23,0.72)]',
  handleActiveClassName:
    'border-sky-300/85 bg-sky-50/95 text-sky-600 shadow-[0_10px_24px_-16px_rgba(14,165,233,0.55)]',
  layout: {
    headerHeight: GROUP_HEADER_HEIGHT - 16,
    underlineInset: GROUP_TITLE_UNDERLINE_INSET,
    bottomGuide: {
      left: GROUP_CONTENT_INSET_LEFT,
      right: GROUP_CONTENT_INSET_RIGHT + 22,
      bottom: 18,
    },
    sideGuides: {
      top: GROUP_CONTENT_INSET_TOP,
      bottom: GROUP_CONTENT_INSET_BOTTOM + 22,
      left: 18,
      right: 18,
    },
    topLeftHandle: {
      left: 8,
      top: GROUP_HEADER_HEIGHT - 12,
    },
    bottomRightHandle: {
      right: 8,
      bottom: 8,
    },
    edgeResizeHitAreaInset: 44,
  },
} as const;

export function getGroupFrameStateClassName({ isSelected, isResizing }: GroupChromeState) {
  if (isSelected || isResizing) {
    return GROUP_CHROME.frameSelectedClassName;
  }

  return '';
}

function isActiveGuideEdge(edge: GroupGuideEdge, resizeAxis?: GroupResizeAxis) {
  if (!resizeAxis) {
    return false;
  }

  if (resizeAxis === 'top-left') {
    return edge === 'top' || edge === 'left';
  }

  if (resizeAxis === 'bottom-right') {
    return edge === 'right' || edge === 'bottom';
  }

  if (resizeAxis === 'left') {
    return edge === 'left';
  }

  if (resizeAxis === 'right') {
    return edge === 'right';
  }

  if (resizeAxis === 'top') {
    return edge === 'top';
  }

  if (resizeAxis === 'bottom') {
    return edge === 'bottom';
  }

  return false;
}

export function getGroupGuideStateClassName(edge: GroupGuideEdge, state: GroupChromeState) {
  return state.isResizing && isActiveGuideEdge(edge, state.resizeAxis)
    ? GROUP_CHROME.guideActiveClassName
    : GROUP_CHROME.guideIdleClassName;
}

export function getGroupHandleStateClassName({ isSelected, isResizing }: GroupChromeState) {
  return isResizing || isSelected
    ? GROUP_CHROME.handleActiveClassName
    : GROUP_CHROME.handleIdleClassName;
}
