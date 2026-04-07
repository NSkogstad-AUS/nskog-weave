import { FileTextIcon } from 'lucide-react';

import { formatUploadedFileSize, type PreviewDocument } from '@/lib/workspaceFiles';

interface FileContentPreviewProps {
  document: PreviewDocument;
}

export function FileContentPreview({ document }: FileContentPreviewProps) {
  const textLength = document.textContent?.length ?? 0;

  return (
    <aside className="hidden w-[24rem] shrink-0 flex-col border-l border-slate-200/80 bg-white/82 backdrop-blur-sm lg:flex">
      <div className="border-b border-slate-200/80 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.28)]">
            <FileTextIcon className="size-4 text-slate-600" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              Document Preview
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950">
              {document.label}
            </div>
            {document.description ? (
              <div className="mt-1 text-xs leading-5 text-slate-500">
                {document.description}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
          {document.mimeType ? (
            <span className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1">
              {document.mimeType}
            </span>
          ) : null}
          {typeof document.sizeBytes === 'number' ? (
            <span className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1">
              {formatUploadedFileSize(document.sizeBytes)}
            </span>
          ) : null}
          {textLength > 0 ? (
            <span className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1">
              {textLength.toLocaleString()} chars
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {document.textContent ? (
          <pre className="whitespace-pre-wrap break-words rounded-[1.25rem] border border-slate-200/80 bg-slate-50/85 p-4 text-[12px] leading-6 text-slate-700">
            {document.textContent}
          </pre>
        ) : (
          <div className="rounded-[1.25rem] border border-dashed border-slate-200/90 bg-slate-50/60 p-4 text-sm leading-6 text-slate-500">
            No extracted text is available for this item yet. Upload a text-like file or run a worker
            that produces text output to preview it here.
          </div>
        )}
      </div>
    </aside>
  );
}
