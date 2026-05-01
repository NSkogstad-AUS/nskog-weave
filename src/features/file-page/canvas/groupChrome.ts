import {
  GROUP_HEADER_HEIGHT,
} from './constants';

type GroupChromeState = {
  isSelected: boolean;
  isResizing: boolean;
};

export type GroupResizeAxis =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'bottom-right';

export const GROUP_CHROME = {
  frameClassName:
    'border-slate-200/90 bg-[rgba(248,250,252,0.94)] shadow-[0_22px_50px_-44px_rgba(15,23,42,0.24)] dark:border-slate-600/40 dark:bg-[rgba(30,41,59,0.66)] dark:shadow-[0_22px_50px_-44px_rgba(15,23,42,0.42)]',
  frameSelectedClassName: 'border-slate-300/95 dark:border-slate-400/35',
  surfaceClassName:
    'pointer-events-none absolute inset-px rounded-[15px] bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(248,250,252,0.78))] dark:bg-[linear-gradient(180deg,rgba(43,56,80,0.5),rgba(27,37,55,0.62))]',
  headerContainerClassName: 'absolute left-4 right-4 top-3.5',
  titleClassName: 'truncate text-sm font-medium text-slate-950 dark:text-slate-100',
  titleInputClassName:
    'w-full rounded-md border border-slate-200/90 bg-white/95 px-2 py-1 text-sm font-medium text-slate-950 outline-none ring-0 dark:border-slate-600/40 dark:bg-slate-800/72 dark:text-slate-100',
  layout: {
    headerHeight: GROUP_HEADER_HEIGHT - 16,
  },
} as const;

export function getGroupFrameStateClassName({ isSelected, isResizing }: GroupChromeState) {
  if (isSelected || isResizing) {
    return GROUP_CHROME.frameSelectedClassName;
  }

  return '';
}
