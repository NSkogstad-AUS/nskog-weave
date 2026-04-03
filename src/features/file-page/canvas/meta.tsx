import {
  FileTextIcon,
  FolderIcon,
  LightbulbIcon,
  MessageSquareIcon,
  ShapesIcon,
  SparklesIcon,
  TargetIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { FilePageElementIcon, FilePageNode } from '@/types/filePage';

export const NODE_META = {
  folder: {
    icon: FolderIcon,
    eyebrow: 'Folder',
    className: 'border-slate-200/80 bg-white/95',
  },
  file: {
    icon: FileTextIcon,
    eyebrow: 'File',
    className: 'border-slate-200/80 bg-white/98',
  },
  element: {
    icon: SparklesIcon,
    eyebrow: 'Element',
    className: 'border-slate-200/80 bg-white/95',
  },
} satisfies Record<
  FilePageNode['kind'],
  {
    icon: typeof FolderIcon;
    eyebrow: string;
    className: string;
  }
>;

export const ELEMENT_ICON_META: Record<
  FilePageElementIcon,
  {
    icon: typeof SparklesIcon;
    label: string;
  }
> = {
  sparkles: {
    icon: SparklesIcon,
    label: 'Sparkles',
  },
  lightbulb: {
    icon: LightbulbIcon,
    label: 'Lightbulb',
  },
  shapes: {
    icon: ShapesIcon,
    label: 'Shapes',
  },
  'message-square': {
    icon: MessageSquareIcon,
    label: 'Message',
  },
  target: {
    icon: TargetIcon,
    label: 'Target',
  },
};

export const RESIZE_OPTIONS = [
  { widthUnits: 1, heightUnits: 1 },
  { widthUnits: 2, heightUnits: 1 },
  { widthUnits: 3, heightUnits: 1 },
  { widthUnits: 1, heightUnits: 2 },
  { widthUnits: 2, heightUnits: 2 },
  { widthUnits: 3, heightUnits: 2 },
  { widthUnits: 1, heightUnits: 3 },
  { widthUnits: 2, heightUnits: 3 },
  { widthUnits: 3, heightUnits: 3 },
] satisfies FilePageNode['size'][];

export function ResizeOptionSwatch({ size }: { size: FilePageNode['size'] }) {
  return (
    <span className="grid grid-cols-3 grid-rows-3 gap-0.5">
      {Array.from({ length: 9 }, (_, index) => {
        const column = (index % 3) + 1;
        const row = Math.floor(index / 3) + 1;
        const isActive = column <= size.widthUnits && row <= size.heightUnits;

        return (
          <span
            key={`${column}-${row}`}
            className={cn(
              'size-2 rounded-[3px] border transition-colors',
              isActive
                ? 'border-sky-300/80 bg-sky-300/75'
                : 'border-slate-200/80 bg-slate-100/90',
            )}
          />
        );
      })}
    </span>
  );
}
