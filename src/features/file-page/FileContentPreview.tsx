import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
} from 'lucide-react';

import { getPdfBinary } from '@/lib/pdfBinaryStore';
import { loadPdfJs } from '@/lib/pdfRuntime';
import type { PdfDocument } from '@/lib/pdfRuntime';
import { formatUploadedFileSize, type PreviewDocument } from '@/lib/workspaceFiles';

interface FileContentPreviewProps {
  document: PreviewDocument;
}

const MAX_SIDE_PREVIEW_CHARACTERS = 20_000;
const PDF_PREVIEW_PAGE_WIDTH = 228;
const PDF_PREVIEW_THUMBNAIL_WIDTH = 64;

type PdfPreviewState =
  | { status: 'loading' }
  | { status: 'ready'; pdf: PdfDocument; pageCount: number }
  | { status: 'no-data' }
  | { status: 'error' };

type PdfCanvasStatus = 'loading' | 'ready' | 'error';

function getIsolatedWheelDelta(event: WheelEvent, element: HTMLElement) {
  const baseDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return baseDelta * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return baseDelta * element.clientHeight;
  }

  return baseDelta;
}

function isPdfDocument(document: PreviewDocument) {
  const ext = document.label.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'pdf' || document.mimeType === 'application/pdf';
}

function PdfPreviewCanvas({
  pageNumber,
  pdf,
  width,
}: {
  pageNumber: number;
  pdf: PdfDocument;
  width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<PdfCanvasStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    setStatus('loading');

    async function renderPage() {
      try {
        const page = await pdf.getPage(pageNumber);

        if (cancelled) {
          page.cleanup();
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const renderScale = baseViewport.width > 0 ? (width * pixelRatio) / baseViewport.width : pixelRatio;
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');

        if (!canvas || !ctx) {
          page.cleanup();
          setStatus('error');
          return;
        }

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${Math.round(
          baseViewport.width > 0 ? width * (baseViewport.height / baseViewport.width) : viewport.height / pixelRatio,
        )}px`;

        renderTask = page.render({ canvas, canvasContext: ctx, viewport });
        await renderTask.promise;
        page.cleanup();

        if (!cancelled) {
          setStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // Ignore cancellation races from pdf.js.
      }
    };
  }, [pageNumber, pdf, width]);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-[0_12px_36px_-30px_rgba(15,23,42,0.7)] dark:border-white/[0.08] dark:bg-white"
      style={{ width, minHeight: Math.round(width * 1.25) }}
    >
      <canvas
        ref={canvasRef}
        aria-label={`Preview page ${pageNumber}`}
        className={`block ${status === 'ready' ? '' : 'invisible'}`}
      />
      {status !== 'ready' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-xs text-slate-400 dark:bg-slate-800/40 dark:text-slate-500">
          {status === 'error' ? 'Could not render page.' : 'Rendering page...'}
        </div>
      ) : null}
    </div>
  );
}

function PdfPreviewThumbnail({
  isActive,
  onClick,
  pageNumber,
  pdf,
}: {
  isActive: boolean;
  onClick: () => void;
  pageNumber: number;
  pdf: PdfDocument;
}) {
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (!('IntersectionObserver' in window)) {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;

        setShouldRender(true);
        observer.disconnect();
      },
      { rootMargin: '420px 0px' },
    );

    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={rootRef}
      type="button"
      data-preview-pdf-page-nav={pageNumber}
      aria-current={isActive ? 'page' : undefined}
      aria-label={`Preview page ${pageNumber}`}
      onClick={onClick}
      className={`mb-2 flex w-full flex-col items-center gap-1 rounded-md border px-1 py-1.5 transition ${
        isActive
          ? 'border-slate-900/35 bg-white text-slate-950 shadow-[0_8px_22px_-20px_rgba(15,23,42,0.7)] dark:border-white/35 dark:bg-white/[0.08] dark:text-slate-100'
          : 'border-transparent text-slate-500 hover:bg-slate-100/65 dark:text-slate-400 dark:hover:bg-slate-800/45'
      }`}
    >
      {shouldRender ? (
        <PdfPreviewCanvas pageNumber={pageNumber} pdf={pdf} width={PDF_PREVIEW_THUMBNAIL_WIDTH} />
      ) : (
        <div
          className="flex items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-[0.62rem] text-slate-300 dark:border-slate-600/35 dark:bg-slate-800/45 dark:text-slate-500"
          style={{ width: PDF_PREVIEW_THUMBNAIL_WIDTH, minHeight: Math.round(PDF_PREVIEW_THUMBNAIL_WIDTH * 1.25) }}
        >
          {pageNumber}
        </div>
      )}
      <span className="font-mono text-[0.62rem]">{pageNumber}</span>
    </button>
  );
}

function PdfDocumentPreview({ document }: { document: PreviewDocument }) {
  const [state, setState] = useState<PdfPreviewState>({ status: 'loading' });
  const [selectedPage, setSelectedPage] = useState(1);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadedPdf: PdfDocument | null = null;

    setState({ status: 'loading' });
    setSelectedPage(1);
    setIsSidebarCollapsed(true);

    async function load() {
      try {
        const data = await getPdfBinary(document.id);

        if (cancelled) return;

        if (!data) {
          setState({ status: 'no-data' });
          return;
        }

        const { getDocument } = await loadPdfJs();
        loadedPdf = await getDocument({
          data: new Uint8Array(data),
          useWorkerFetch: false,
          isEvalSupported: false,
        }).promise;

        if (cancelled) {
          await loadedPdf.destroy();
          return;
        }

        setState({
          status: 'ready',
          pdf: loadedPdf,
          pageCount: loadedPdf.numPages,
        });
      } catch {
        if (!cancelled) {
          setState({ status: 'error' });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      void loadedPdf?.destroy();
    };
  }, [document.id]);

  useEffect(() => {
    const activeButton = sidebarRef.current?.querySelector<HTMLElement>(
      `[data-preview-pdf-page-nav="${selectedPage}"]`,
    );
    activeButton?.scrollIntoView({ block: 'nearest' });
  }, [selectedPage]);

  useEffect(() => {
    const element = sidebarRef.current;
    if (!element) return undefined;

    const handleSidebarWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      element.scrollTop += getIsolatedWheelDelta(event, element);
    };

    element.addEventListener('wheel', handleSidebarWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleSidebarWheel);
  }, [isSidebarCollapsed, state.status]);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-sm text-slate-500 dark:border-slate-600/40 dark:bg-slate-800/50 dark:text-slate-300">
        <span className="size-2 animate-pulse rounded-full bg-slate-300 dark:bg-slate-600" />
        Rendering PDF preview...
      </div>
    );
  }

  if (state.status !== 'ready') {
    return (
      <div className="rounded-xl border border-dashed border-slate-200/90 bg-slate-50/60 p-4 text-sm leading-6 text-slate-500 dark:border-slate-600/40 dark:bg-[rgba(51,65,85,0.34)] dark:text-slate-300">
        {state.status === 'no-data'
          ? 'PDF binary not found for this preview.'
          : 'Could not render this PDF preview.'}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/55 dark:border-slate-600/35 dark:bg-slate-900/25">
      <div className="soft-scrollbar min-w-0 flex-1 overflow-auto px-4 py-4">
        <div className="flex justify-center">
          <PdfPreviewCanvas pageNumber={selectedPage} pdf={state.pdf} width={PDF_PREVIEW_PAGE_WIDTH} />
        </div>
      </div>

      <button
        type="button"
        aria-label={isSidebarCollapsed ? 'Show preview page sidebar' : 'Hide preview page sidebar'}
        aria-expanded={!isSidebarCollapsed}
        onClick={() => setIsSidebarCollapsed((value) => !value)}
        className="pointer-events-auto absolute right-2 top-2 z-20 flex size-8 items-center justify-center rounded-full border border-slate-200/75 bg-white/92 text-slate-700 shadow-[0_10px_28px_-20px_rgba(15,23,42,0.65)] backdrop-blur-md transition-[background-color,box-shadow,transform] duration-200 hover:bg-white hover:shadow-[0_14px_34px_-22px_rgba(15,23,42,0.7)] active:scale-95 dark:border-slate-600/40 dark:bg-slate-900/90 dark:text-slate-200"
      >
        {isSidebarCollapsed ? (
          <ChevronLeftIcon className="size-4" strokeWidth={2.5} />
        ) : (
          <ChevronRightIcon className="size-4" strokeWidth={2.5} />
        )}
      </button>

      <aside
        aria-label="Preview PDF pages"
        className={`flex shrink-0 flex-col overflow-hidden border-l bg-white/78 transition-[width,opacity] duration-200 ease-out dark:bg-slate-900/62 ${
          isSidebarCollapsed
            ? 'pointer-events-none w-0 border-transparent opacity-0 dark:border-transparent'
            : 'pointer-events-auto w-[96px] border-slate-200/65 opacity-100 dark:border-slate-600/35'
        }`}
        onWheel={(event) => event.stopPropagation()}
      >
          <div className="flex h-10 shrink-0 items-center border-b border-slate-200/65 px-3 dark:border-slate-600/35">
            <span className="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Pages
            </span>
          </div>

          <div
            ref={sidebarRef}
            className="soft-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3"
            onWheel={(event) => event.stopPropagation()}
          >
            {Array.from({ length: state.pageCount }, (_, index) => {
              const pageNumber = index + 1;
              return (
                <PdfPreviewThumbnail
                  key={`${document.id}-${pageNumber}`}
                  isActive={pageNumber === selectedPage}
                  onClick={() => setSelectedPage(pageNumber)}
                  pageNumber={pageNumber}
                  pdf={state.pdf}
                />
              );
            })}
          </div>
      </aside>
    </div>
  );
}

export function FileContentPreview({ document }: FileContentPreviewProps) {
  const textLength = document.textContent?.length ?? 0;
  const previewText =
    document.textContent && document.textContent.length > MAX_SIDE_PREVIEW_CHARACTERS
      ? `${document.textContent.slice(0, MAX_SIDE_PREVIEW_CHARACTERS)}\n\n[preview clipped to keep the app responsive]`
      : document.textContent;

  const isPdf = isPdfDocument(document);

  return (
    <aside className={`hidden shrink-0 flex-col border-l border-slate-200/80 bg-white/82 backdrop-blur-sm lg:flex dark:border-slate-600/40 dark:bg-[rgba(30,41,59,0.66)] ${isPdf ? 'w-[34rem]' : 'w-[24rem]'}`}>
      <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-600/35">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.28)] dark:border-slate-600/40 dark:bg-slate-800/74 dark:shadow-[0_12px_30px_-24px_rgba(15,23,42,0.38)]">
            <FileTextIcon className="size-4 text-slate-600 dark:text-slate-200" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-400">
              Document Preview
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
              {document.label}
            </div>
            {document.description ? (
              <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-300">
                {document.description}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400 dark:text-slate-400">
          {document.mimeType ? (
            <span className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1 dark:border-slate-600/40 dark:bg-slate-800/72">
              {document.mimeType}
            </span>
          ) : null}
          {typeof document.sizeBytes === 'number' ? (
            <span className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1 dark:border-slate-600/40 dark:bg-slate-800/72">
              {formatUploadedFileSize(document.sizeBytes)}
            </span>
          ) : null}
          {textLength > 0 ? (
            <span className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1 dark:border-slate-600/40 dark:bg-slate-800/72">
              {textLength.toLocaleString()} chars
            </span>
          ) : null}
        </div>
      </div>

      <div className={`min-h-0 flex-1 px-5 py-4 ${isPdf ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
        {isPdf ? (
          <PdfDocumentPreview document={document} />
        ) : previewText ? (
          <pre className="whitespace-pre-wrap break-words rounded-[1.25rem] border border-slate-200/80 bg-slate-50/85 p-4 text-[12px] leading-6 text-slate-700 dark:border-slate-600/40 dark:bg-[rgba(22,32,49,0.76)] dark:text-slate-200">
            {previewText}
          </pre>
        ) : (
          <div className="rounded-[1.25rem] border border-dashed border-slate-200/90 bg-slate-50/60 p-4 text-sm leading-6 text-slate-500 dark:border-slate-600/40 dark:bg-[rgba(51,65,85,0.34)] dark:text-slate-300">
            No extracted text is available for this item yet. Upload a text-like file or run a worker
            that produces text output to preview it here.
          </div>
        )}
      </div>
    </aside>
  );
}
