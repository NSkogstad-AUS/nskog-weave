import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { MinusIcon, PlusIcon } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getPdfBinary } from '@/lib/pdfBinaryStore';
import { loadPdfJs } from '@/lib/pdfRuntime';
import type { WorkspaceFile } from '@/data/sidebarNavigation';

// ─── File-type detection ───────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'php',
  'sh', 'bash', 'zsh', 'fish',
  'css', 'scss', 'sass', 'less',
  'html', 'htm', 'xml', 'svg',
  'yaml', 'yml', 'toml', 'ini', 'env',
  'sql', 'graphql', 'gql',
]);
const DOCUMENT_ZOOM_OPTIONS = [50, 75, 90, 100, 125, 150, 175, 200];

type DocKind = 'pdf' | 'markdown' | 'json' | 'code' | 'text';

function detectKind(label: string, mimeType?: string | null): DocKind {
  const ext = label.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'md' || ext === 'mdx' || mimeType === 'text/markdown') return 'markdown';
  if (ext === 'json' || mimeType === 'application/json') return 'json';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'text';
}

// ─── Inline markdown ───────────────────────────────────────────────────────────

function renderInline(raw: string): ReactNode {
  const segments = raw.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[([^\]]+)\]\([^)]+\))/g);
  const out: ReactNode[] = [];
  let idx = 0;
  while (idx < segments.length) {
    const seg = segments[idx];
    if (!seg) { idx++; continue; }
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
      out.push(<strong key={idx} className="font-semibold">{seg.slice(2, -2)}</strong>);
    } else if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) {
      out.push(<em key={idx}>{seg.slice(1, -1)}</em>);
    } else if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
      out.push(
        <code key={idx} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.88em] text-slate-700 dark:bg-slate-700/60 dark:text-slate-200">
          {seg.slice(1, -1)}
        </code>,
      );
    } else if (seg.startsWith('[')) {
      out.push(<span key={idx} className="underline decoration-slate-400">{segments[idx + 1] || seg}</span>);
      idx += 2;
      continue;
    } else {
      out.push(seg);
    }
    idx++;
  }
  return out;
}

// ─── Markdown renderer ─────────────────────────────────────────────────────────

function MarkdownDocument({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let codeLang = '';
  let listItems: { ordered: boolean; content: string }[] = [];
  let key = 0;

  function nextKey() { return String(key++); }

  function flushList() {
    if (!listItems.length) return;
    const ordered = listItems[0].ordered;
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={nextKey()} className={ordered ? 'my-3 list-decimal space-y-1 pl-6' : 'my-3 list-disc space-y-1 pl-6'}>
        {listItems.map((item, i) => (
          <li key={i} className="text-[0.925rem] leading-relaxed text-slate-700 dark:text-slate-300">
            {renderInline(item.content)}
          </li>
        ))}
      </Tag>,
    );
    listItems = [];
  }

  lines.forEach((line) => {
    if (inCode) {
      if (line.startsWith('```')) {
        blocks.push(
          <pre key={nextKey()} className="my-4 overflow-x-auto rounded-xl border border-slate-200/80 bg-slate-50 p-4 text-[0.82rem] leading-relaxed text-slate-700 dark:border-slate-600/40 dark:bg-slate-800/60 dark:text-slate-200">
            {codeLang && <span className="mb-2 block font-sans text-[0.7rem] font-medium uppercase tracking-widest text-slate-400">{codeLang}</span>}
            <code className="font-mono">{codeLines.join('\n')}</code>
          </pre>,
        );
        inCode = false; codeLines = []; codeLang = '';
      } else { codeLines.push(line); }
      return;
    }
    if (line.startsWith('```')) {
      flushList();
      inCode = true; codeLang = line.slice(3).trim(); return;
    }
    if (line.trim() === '') { flushList(); return; }

    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushList();
      const depth = h[1].length;
      const cls = depth === 1
        ? 'mt-8 mb-3 text-2xl font-bold text-slate-900 dark:text-white first:mt-0'
        : depth === 2
        ? 'mt-6 mb-2 text-xl font-semibold text-slate-800 dark:text-slate-100 first:mt-0'
        : depth === 3
        ? 'mt-5 mb-2 text-lg font-semibold text-slate-800 dark:text-slate-100 first:mt-0'
        : 'mt-4 mb-1.5 text-base font-semibold text-slate-700 dark:text-slate-200 first:mt-0';
      blocks.push(<div key={nextKey()} className={cls}>{renderInline(h[2])}</div>);
      return;
    }
    if (/^[*_-]{3,}$/.test(line.replace(/\s/g, ''))) {
      flushList();
      blocks.push(<hr key={nextKey()} className="my-5 border-slate-200/80 dark:border-slate-600/40" />);
      return;
    }
    if (line.startsWith('>')) {
      flushList();
      blocks.push(
        <blockquote key={nextKey()} className="my-3 border-l-4 border-slate-300/70 pl-4 text-[0.925rem] italic leading-relaxed text-slate-500 dark:border-slate-500/50 dark:text-slate-400">
          {renderInline(line.replace(/^>\s?/, ''))}
        </blockquote>,
      );
      return;
    }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      if (listItems.length && listItems[0].ordered) flushList();
      listItems.push({ ordered: false, content: bullet[1] }); return;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (listItems.length && !listItems[0].ordered) flushList();
      listItems.push({ ordered: true, content: ordered[1] }); return;
    }
    if (line.startsWith('    ') && !listItems.length) {
      blocks.push(
        <pre key={nextKey()} className="font-mono text-[0.82rem] leading-relaxed text-slate-600 dark:text-slate-400">{line.slice(4)}</pre>,
      );
      return;
    }
    flushList();
    blocks.push(
      <p key={nextKey()} className="text-[0.925rem] leading-[1.7] text-slate-700 dark:text-slate-300">
        {renderInline(line)}
      </p>,
    );
  });

  flushList();
  if (inCode && codeLines.length) {
    blocks.push(
      <pre key={nextKey()} className="my-4 overflow-x-auto rounded-xl border border-slate-200/80 bg-slate-50 p-4 font-mono text-[0.82rem] leading-relaxed text-slate-700 dark:border-slate-600/40 dark:bg-slate-800/60 dark:text-slate-200">
        {codeLines.join('\n')}
      </pre>,
    );
  }

  return <div className="space-y-1">{blocks}</div>;
}

// ─── PDF renderer ──────────────────────────────────────────────────────────────

const DOC_RENDER_SCALE = 1.5;
const DOC_MAX_PAGES = 40;

type PdfDocState =
  | { status: 'loading' }
  | {
      status: 'ready';
      pdf: PDFDocumentProxy;
      pageCount: number;
      totalPageCount: number;
    }
  | { status: 'no-data' }
  | { status: 'error' };

type PdfPageStatus = 'waiting' | 'rendering' | 'ready' | 'error';

function PdfPage({
  pdf,
  pageNumber,
  renderScale,
  totalPages,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  renderScale: number;
  totalPages: number;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<PdfPageStatus>('waiting');

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    let cancelled = false;
    let hasStarted = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    setStatus('waiting');

    async function renderPage() {
      if (cancelled || hasStarted) {
        return;
      }

      hasStarted = true;
      setStatus('rendering');

      try {
        const page = await pdf.getPage(pageNumber);

        if (cancelled) {
          page.cleanup();
          return;
        }

        const viewport = page.getViewport({ scale: DOC_RENDER_SCALE * renderScale });
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');

        if (!canvas || !ctx) {
          page.cleanup();
          setStatus('error');
          return;
        }

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
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

    if (!('IntersectionObserver' in window)) {
      void renderPage();
      return () => {
        cancelled = true;
        try {
          renderTask?.cancel();
        } catch {
          // Ignore cancellation races from pdf.js.
        }
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          return;
        }

        observer.disconnect();
        void renderPage();
      },
      { rootMargin: '900px 0px' },
    );

    observer.observe(root);

    return () => {
      cancelled = true;
      observer.disconnect();
      try {
        renderTask?.cancel();
      } catch {
        // Ignore cancellation races from pdf.js.
      }
    };
  }, [pageNumber, pdf, renderScale]);

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.07)] dark:border-slate-600/40 dark:bg-slate-900/30"
      style={status === 'ready' ? undefined : { minHeight: 420 }}
    >
      <canvas
        ref={canvasRef}
        aria-label={`Page ${pageNumber}`}
        className={`block w-full select-none ${status === 'ready' ? '' : 'invisible'}`}
      />
      {status !== 'ready' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 text-sm text-slate-400 dark:bg-slate-800/35 dark:text-slate-500">
          {status === 'error' ? 'Could not render this page.' : 'Rendering page...'}
        </div>
      ) : null}
      <span className="absolute bottom-2 right-3 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[0.7rem] text-white/80 backdrop-blur-sm">
        {pageNumber} / {totalPages}
      </span>
    </div>
  );
}

function PdfDocument({ fileId, zoomScale }: { fileId: string; zoomScale: number }) {
  const [state, setState] = useState<PdfDocState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let loadedPdf: PDFDocumentProxy | null = null;

    setState({ status: 'loading' });

    async function load() {
      try {
        const data = await getPdfBinary(fileId);

        if (cancelled) {
          return;
        }

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
          pageCount: Math.min(loadedPdf.numPages, DOC_MAX_PAGES),
          totalPageCount: loadedPdf.numPages,
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
  }, [fileId]);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-3 py-4 text-sm text-slate-400">
        <span className="size-2 animate-pulse rounded-full bg-slate-300 dark:bg-slate-600" />
        Rendering PDF pages…
      </div>
    );
  }
  if (state.status === 'no-data' || state.status === 'error') {
    return (
      <p className="text-sm text-slate-400 dark:text-slate-500">
        {state.status === 'no-data'
          ? 'PDF binary not found — re-upload the file to enable page rendering.'
          : 'Could not render this PDF.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {Array.from({ length: state.pageCount }, (_, index) => (
        <PdfPage
          key={`${fileId}-${index + 1}`}
          pdf={state.pdf}
          pageNumber={index + 1}
          renderScale={zoomScale}
          totalPages={state.pageCount}
        />
      ))}
      {state.totalPageCount > DOC_MAX_PAGES ? (
        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          Showing first {DOC_MAX_PAGES} of {state.totalPageCount} pages.
        </p>
      ) : null}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface FileDocumentViewProps {
  file: WorkspaceFile;
}

export function FileDocumentView({ file }: FileDocumentViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const kind = detectKind(file.label, file.mimeType);
  const ext = file.label.split('.').pop()?.toLowerCase() ?? '';
  const text = file.contentText ?? '';
  const hasText = text.length > 0;
  const [zoomPercent, setZoomPercent] = useState(100);
  const [overlayInsets, setOverlayInsets] = useState({ left: 0, right: 0 });
  const zoomScale = zoomPercent / 100;
  const zoomIndex = DOCUMENT_ZOOM_OPTIONS.indexOf(zoomPercent);
  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex >= 0 && zoomIndex < DOCUMENT_ZOOM_OPTIONS.length - 1;
  const documentContent = kind === 'pdf' ? (
    <PdfDocument fileId={file.id} zoomScale={zoomScale} />
  ) : kind === 'markdown' && hasText ? (
    <MarkdownDocument text={text} />
  ) : kind === 'json' && hasText ? (
    <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-slate-200/80 bg-slate-50 p-5 font-mono text-[0.82rem] leading-relaxed text-slate-700 dark:border-slate-600/40 dark:bg-slate-800/60 dark:text-slate-200">
      {(() => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } })()}
    </pre>
  ) : (kind === 'code' || kind === 'text') && hasText ? (
    <div>
      {kind === 'code' && ext ? (
        <span className="mb-3 inline-block rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-wide text-slate-400 dark:bg-slate-700/50 dark:text-slate-500">
          .{ext}
        </span>
      ) : null}
      <pre className={`overflow-x-auto whitespace-pre-wrap break-all text-[0.82rem] leading-relaxed text-slate-700 dark:text-slate-300 ${kind === 'code' ? 'rounded-xl border border-slate-200/80 bg-slate-50 p-5 font-mono dark:border-slate-600/40 dark:bg-slate-800/60' : 'font-sans'}`}>
        {text}
      </pre>
    </div>
  ) : (
    <div className="rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/60 p-8 text-center text-sm text-slate-400 dark:border-slate-600/40 dark:bg-[rgba(51,65,85,0.34)] dark:text-slate-400">
      No content preview available for this file.
    </div>
  );

  useLayoutEffect(() => {
    const updateOverlayInsets = () => {
      const rect = rootRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      setOverlayInsets({
        left: Math.max(0, rect.left),
        right: Math.max(0, window.innerWidth - rect.right),
      });
    };

    updateOverlayInsets();
    window.addEventListener('resize', updateOverlayInsets);
    window.addEventListener('scroll', updateOverlayInsets, true);

    return () => {
      window.removeEventListener('resize', updateOverlayInsets);
      window.removeEventListener('scroll', updateOverlayInsets, true);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="relative h-full overflow-hidden bg-white/88 dark:bg-[rgba(30,41,59,0.68)]"
    >
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-3xl px-8 pb-24 pt-36">
          <div
            className="mx-auto"
            style={{ width: `${zoomPercent}%` } as CSSProperties}
          >
            {documentContent}
          </div>
        </div>
      </div>

      <div
        className="pointer-events-none fixed top-0 z-30 bg-white/88 dark:bg-[rgba(30,41,59,0.68)]"
        style={{ left: overlayInsets.left, right: overlayInsets.right }}
      >
        <div className="mx-auto max-w-3xl px-8 pt-10">
          <div className="border-b border-slate-200/80 pb-6 dark:border-slate-600/35">
            <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {file.label}
            </h1>
          </div>
        </div>
      </div>

      <div
        className="pointer-events-none fixed bottom-4 z-30 flex justify-center px-4"
        style={{ left: overlayInsets.left, right: overlayInsets.right }}
      >
        <div className="pointer-events-auto flex items-center rounded-xl border border-slate-200/85 bg-white/94 p-1 shadow-[0_18px_44px_-30px_rgba(15,23,42,0.42)] backdrop-blur-md dark:border-slate-600/40 dark:bg-[rgba(30,41,59,0.9)]">
          <button
            type="button"
            disabled={!canZoomOut}
            onClick={() => setZoomPercent(DOCUMENT_ZOOM_OPTIONS[Math.max(0, zoomIndex - 1)])}
            className="flex size-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:pointer-events-none disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-slate-700/45 dark:disabled:text-slate-600"
            aria-label="Zoom out"
          >
            <MinusIcon className="size-4" />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mx-1 flex h-8 min-w-16 items-center justify-center rounded-lg px-2 font-mono text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700/45"
                aria-label="Select zoom level"
              >
                {zoomPercent}%
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" side="top" className="w-28 min-w-28">
              <DropdownMenuRadioGroup
                value={String(zoomPercent)}
                onValueChange={(value) => setZoomPercent(Number(value))}
              >
                {DOCUMENT_ZOOM_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option} value={String(option)}>
                    {option}%
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            disabled={!canZoomIn}
            onClick={() =>
              setZoomPercent(
                DOCUMENT_ZOOM_OPTIONS[Math.min(DOCUMENT_ZOOM_OPTIONS.length - 1, zoomIndex + 1)],
              )
            }
            className="flex size-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:pointer-events-none disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-slate-700/45 dark:disabled:text-slate-600"
            aria-label="Zoom in"
          >
            <PlusIcon className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
