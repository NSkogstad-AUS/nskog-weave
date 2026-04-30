import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { CheckIcon, MinusIcon, MoveIcon, PlusIcon } from 'lucide-react';

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
const DOCUMENT_MIN_ZOOM = DOCUMENT_ZOOM_OPTIONS[0];
const DOCUMENT_MAX_ZOOM = DOCUMENT_ZOOM_OPTIONS[DOCUMENT_ZOOM_OPTIONS.length - 1];
const CONTENT_WIDTH_PX = 768; // 48rem at 16px base
const CONTENT_INITIAL_TOP = 68; // px — space below fixed header overlay
const CONTENT_BOTTOM_PADDING = 32;

type DocKind = 'pdf' | 'markdown' | 'json' | 'code' | 'text';

function detectKind(label: string, mimeType?: string | null): DocKind {
  const ext = label.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'md' || ext === 'mdx' || mimeType === 'text/markdown') return 'markdown';
  if (ext === 'json' || mimeType === 'application/json') return 'json';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'text';
}

function getPreviousZoomOption(value: number) {
  for (let index = DOCUMENT_ZOOM_OPTIONS.length - 1; index >= 0; index -= 1) {
    if (DOCUMENT_ZOOM_OPTIONS[index] < value) {
      return DOCUMENT_ZOOM_OPTIONS[index];
    }
  }
  return DOCUMENT_MIN_ZOOM;
}

function getNextZoomOption(value: number) {
  return DOCUMENT_ZOOM_OPTIONS.find((option) => option > value) ?? DOCUMENT_MAX_ZOOM;
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
  totalPages,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
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

        const viewport = page.getViewport({ scale: DOC_RENDER_SCALE });
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
  }, [pageNumber, pdf]);

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

function PdfDocument({ fileId }: { fileId: string }) {
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
  const contentRef = useRef<HTMLDivElement | null>(null);
  const kind = detectKind(file.label, file.mimeType);
  const ext = file.label.split('.').pop()?.toLowerCase() ?? '';
  const text = file.contentText ?? '';
  const hasText = text.length > 0;

  const [zoomPercent, setZoomPercent] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: CONTENT_INITIAL_TOP });
  const [initialized, setInitialized] = useState(false);
  const [overlayInsets, setOverlayInsets] = useState({ left: 0, right: 0 });
  const [isFreePan, setIsFreePan] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Mutable ref for synchronous reads in event handlers — kept in sync with state
  const vpRef = useRef({ zoomPercent: 100, panX: 0, panY: CONTENT_INITIAL_TOP });
  const contentHeightRef = useRef(0);
  const isFreePanRef = useRef(false);
  const zoomRafRef = useRef<number | null>(null);
  const pendingZoomRef = useRef<{ cx: number; cy: number; zoom: number } | null>(null);
  const panRafRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ clientX: 0, clientY: 0, panX: 0, panY: 0 });
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const scale = zoomPercent / 100;
  const canZoomOut = zoomPercent > DOCUMENT_MIN_ZOOM;
  const canZoomIn = zoomPercent < DOCUMENT_MAX_ZOOM;

  const clampPanY = useCallback((candidateY: number, nextZoomPercent = vpRef.current.zoomPercent) => {
    const root = rootRef.current;
    if (!root) {
      return Math.min(CONTENT_INITIAL_TOP, candidateY);
    }

    const scaledHeight = contentHeightRef.current * (nextZoomPercent / 100);
    const minY = scaledHeight + CONTENT_INITIAL_TOP + CONTENT_BOTTOM_PADDING <= root.clientHeight
      ? CONTENT_INITIAL_TOP
      : root.clientHeight - scaledHeight - CONTENT_BOTTOM_PADDING;

    return Math.max(minY, Math.min(CONTENT_INITIAL_TOP, candidateY));
  }, []);

  // Clamp horizontal pan so at least a sliver of the content stays visible on each side
  const clampPanX = useCallback((candidateX: number, nextZoomPercent = vpRef.current.zoomPercent) => {
    const root = rootRef.current;
    if (!root) return candidateX;
    const scaledWidth = CONTENT_WIDTH_PX * (nextZoomPercent / 100);
    const edge = 80; // minimum px of content visible at either side
    const maxX = root.clientWidth - edge;
    const minX = edge - scaledWidth;
    return Math.max(minX, Math.min(maxX, candidateX));
  }, []);

  // Center content horizontally on first layout
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || initialized) return;
    const x = Math.max(32, (root.clientWidth - CONTENT_WIDTH_PX) / 2);
    vpRef.current = { zoomPercent: 100, panX: x, panY: CONTENT_INITIAL_TOP };
    setPan({ x, y: CONTENT_INITIAL_TOP });
    setInitialized(true);
  }, [initialized]);

  // Re-center horizontally when the container resizes (e.g. sidebar toggled)
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const recentre = () => {
      if (!initialized || isFreePanRef.current) return;
      const scaledWidth = CONTENT_WIDTH_PX * (vpRef.current.zoomPercent / 100);
      const x = scaledWidth >= root.clientWidth
        ? (root.clientWidth - scaledWidth) / 2
        : Math.max(32, (root.clientWidth - scaledWidth) / 2);
      if (x === vpRef.current.panX) return;
      vpRef.current = { ...vpRef.current, panX: x };
      setPan((prev) => ({ ...prev, x }));
    };
    const observer = new ResizeObserver(() => window.requestAnimationFrame(recentre));
    observer.observe(root);
    return () => observer.disconnect();
  }, [initialized]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;

    const updateContentHeight = () => {
      contentHeightRef.current = content.scrollHeight;
      const clampedY = clampPanY(vpRef.current.panY, vpRef.current.zoomPercent);

      if (clampedY !== vpRef.current.panY) {
        vpRef.current = {
          ...vpRef.current,
          panY: clampedY,
        };
        setPan({ x: vpRef.current.panX, y: clampedY });
      }
    };

    updateContentHeight();

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(updateContentHeight);
    });
    resizeObserver.observe(content);
    window.addEventListener('resize', updateContentHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateContentHeight);
    };
  }, [clampPanY, file.id, kind]);

  // Keep vpRef and isFreePanRef in sync with React state
  useEffect(() => {
    vpRef.current = { zoomPercent, panX: pan.x, panY: pan.y };
    isFreePanRef.current = isFreePan;
  }, [zoomPercent, pan, isFreePan]);

  // Touchpad pinch-zoom: zooms at cursor in freeform mode, stays centred otherwise
  const applyZoomAt = useCallback((nextZoomPercent: number, cx: number, cy: number) => {
    const bounded = Math.max(DOCUMENT_MIN_ZOOM, Math.min(DOCUMENT_MAX_ZOOM, Math.round(nextZoomPercent)));
    const { zoomPercent: curZoom, panX, panY } = vpRef.current;
    if (bounded === curZoom) return;
    if (isFreePanRef.current) {
      const factor = bounded / curZoom;
      const newPanX = clampPanX(cx + (panX - cx) * factor, bounded);
      const newPanY = clampPanY(cy + (panY - cy) * factor, bounded);
      vpRef.current = { zoomPercent: bounded, panX: newPanX, panY: newPanY };
      setZoomPercent(bounded);
      setPan({ x: newPanX, y: newPanY });
    } else {
      const root = rootRef.current;
      const scaledWidth = CONTENT_WIDTH_PX * (bounded / 100);
      const centredX = root
        ? scaledWidth >= root.clientWidth
          ? (root.clientWidth - scaledWidth) / 2
          : Math.max(32, (root.clientWidth - scaledWidth) / 2)
        : panX;
      const clampedY = clampPanY(panY, bounded);
      vpRef.current = { zoomPercent: bounded, panX: centredX, panY: clampedY };
      setZoomPercent(bounded);
      setPan({ x: centredX, y: clampedY });
    }
  }, [clampPanX, clampPanY]);

  // +/- buttons and dropdown zoom steps: always centred, never free-form
  const applyZoomCentred = useCallback((nextZoomPercent: number) => {
    const bounded = Math.max(DOCUMENT_MIN_ZOOM, Math.min(DOCUMENT_MAX_ZOOM, nextZoomPercent));
    const root = rootRef.current;
    const scaledWidth = CONTENT_WIDTH_PX * (bounded / 100);
    const centredX = root
      ? scaledWidth >= root.clientWidth
        ? (root.clientWidth - scaledWidth) / 2
        : Math.max(32, (root.clientWidth - scaledWidth) / 2)
      : vpRef.current.panX;
    const clampedY = clampPanY(vpRef.current.panY, bounded);
    isFreePanRef.current = false;
    vpRef.current = { zoomPercent: bounded, panX: centredX, panY: clampedY };
    setIsFreePan(false);
    setZoomPercent(bounded);
    setPan({ x: centredX, y: clampedY });
  }, [clampPanY]);

  const resetZoom = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const x = Math.max(32, (root.clientWidth - CONTENT_WIDTH_PX) / 2);
    isFreePanRef.current = false;
    vpRef.current = { zoomPercent: 100, panX: x, panY: CONTENT_INITIAL_TOP };
    setIsFreePan(false);
    setZoomPercent(100);
    setPan({ x, y: CONTENT_INITIAL_TOP });
  }, []);

  // Wheel: ctrl/cmd = zoom at cursor, otherwise pan
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
        const rect = root.getBoundingClientRect();
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;
        const baseZoom = pendingZoomRef.current?.zoom ?? vpRef.current.zoomPercent;
        const factor = Math.exp(-event.deltaY * 0.005);
        const nextZoom = Math.max(
          DOCUMENT_MIN_ZOOM,
          Math.min(DOCUMENT_MAX_ZOOM, Math.round(baseZoom * factor)),
        );

        pendingZoomRef.current = { cx, cy, zoom: nextZoom };

        if (zoomRafRef.current !== null) return;
        zoomRafRef.current = requestAnimationFrame(() => {
          zoomRafRef.current = null;
          const pending = pendingZoomRef.current;
          pendingZoomRef.current = null;
          if (!pending) return;
          applyZoomAt(pending.zoom, pending.cx, pending.cy);
        });
      } else {
        // Free-form: pan both axes. Centred mode: vertical only.
        if (isFreePanRef.current) {
          vpRef.current.panX = clampPanX(vpRef.current.panX - event.deltaX);
        }
        vpRef.current.panY = clampPanY(vpRef.current.panY - event.deltaY);

        if (panRafRef.current === null) {
          panRafRef.current = requestAnimationFrame(() => {
            panRafRef.current = null;
            setPan({ x: vpRef.current.panX, y: vpRef.current.panY });
          });
        }
      }
    };

    root.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      if (zoomRafRef.current !== null) { cancelAnimationFrame(zoomRafRef.current); zoomRafRef.current = null; }
      if (panRafRef.current !== null) { cancelAnimationFrame(panRafRef.current); panRafRef.current = null; }
      root.removeEventListener('wheel', handleWheel);
    };
  }, [applyZoomAt, clampPanX, clampPanY]);

  // Middle-mouse drag to pan
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      isDraggingRef.current = true;
      dragStartRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        panX: vpRef.current.panX,
        panY: vpRef.current.panY,
      };
      root.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const newPanY = clampPanY(
        dragStartRef.current.panY + (event.clientY - dragStartRef.current.clientY),
      );
      // In centred mode, horizontal drag is locked
      const newPanX = isFreePanRef.current
        ? clampPanX(dragStartRef.current.panX + (event.clientX - dragStartRef.current.clientX))
        : vpRef.current.panX;
      vpRef.current.panX = newPanX;
      vpRef.current.panY = newPanY;
      setPan({ x: newPanX, y: newPanY });
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
    };

    root.addEventListener('pointerdown', handlePointerDown);
    root.addEventListener('pointermove', handlePointerMove);
    root.addEventListener('pointerup', handlePointerUp);
    root.addEventListener('pointercancel', handlePointerUp);

    return () => {
      root.removeEventListener('pointerdown', handlePointerDown);
      root.removeEventListener('pointermove', handlePointerMove);
      root.removeEventListener('pointerup', handlePointerUp);
      root.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [clampPanX, clampPanY]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isDropdownOpen) return undefined;
    const handleMouseDown = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isDropdownOpen]);

  // Overlay insets (keeps fixed overlays aligned with the container)
  useLayoutEffect(() => {
    const updateOverlayInsets = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setOverlayInsets({
        left: Math.max(0, rect.left),
        right: Math.max(0, window.innerWidth - rect.right),
      });
    };
    const observedElements = [
      rootRef.current,
      rootRef.current?.parentElement,
      document.querySelector('[data-slot="sidebar-inset"]'),
    ].filter((element): element is Element => Boolean(element));
    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(updateOverlayInsets);
    });
    updateOverlayInsets();
    observedElements.forEach((element) => resizeObserver.observe(element));
    window.addEventListener('resize', updateOverlayInsets);
    window.addEventListener('scroll', updateOverlayInsets, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateOverlayInsets);
      window.removeEventListener('scroll', updateOverlayInsets, true);
    };
  }, []);

  const documentContent = kind === 'pdf' ? (
    <PdfDocument fileId={file.id} />
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

  return (
    <div
      ref={rootRef}
      className="relative h-full overflow-hidden bg-white/88 dark:bg-[rgba(30,41,59,0.68)]"
    >
      {/* Canvas-style pan/zoom content layer */}
      <div
        className="absolute left-0 top-0 pb-24"
        style={{
          width: CONTENT_WIDTH_PX,
          opacity: initialized ? 1 : 0,
          transformOrigin: '0 0',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
        } as CSSProperties}
      >
        <div ref={contentRef}>
          {documentContent}
        </div>
      </div>

      {/* Fixed title overlay */}
      <div
        className="pointer-events-none fixed top-0 z-30 overflow-hidden"
        style={{ left: overlayInsets.left, right: overlayInsets.right }}
      >
        <div className="absolute inset-0 bg-white/22 backdrop-blur-2xl [mask-image:linear-gradient(to_bottom,black_0%,black_55%,rgba(0,0,0,0.4)_78%,transparent_100%)] dark:bg-[rgba(15,23,42,0.22)]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.55),rgba(255,255,255,0.08)_48%,rgba(255,255,255,0.22))] [mask-image:linear-gradient(to_bottom,black_0%,black_52%,rgba(0,0,0,0.3)_75%,transparent_100%)] dark:bg-[linear-gradient(135deg,rgba(148,163,184,0.14),rgba(15,23,42,0.08)_50%,rgba(255,255,255,0.04))]" />
        <div className="relative pb-10 pt-[22px] text-center">
          <h1 className="truncate px-16 text-base font-semibold tracking-tight text-slate-700 dark:text-white/80">
            {file.label}
          </h1>
        </div>
      </div>

      {/* Zoom controls */}
      <div
        className="pointer-events-none fixed bottom-4 z-30 flex justify-center px-4"
        style={{ left: overlayInsets.left, right: overlayInsets.right }}
      >
        <div className="pointer-events-auto flex items-center rounded-xl border border-slate-200/85 bg-white/94 p-1 shadow-[0_18px_44px_-30px_rgba(15,23,42,0.42)] backdrop-blur-md dark:border-slate-600/40 dark:bg-[rgba(30,41,59,0.9)]">
          <button
            type="button"
            disabled={!canZoomOut}
            onClick={() => applyZoomCentred(getPreviousZoomOption(zoomPercent))}
            className="flex size-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:pointer-events-none disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-slate-700/45 dark:disabled:text-slate-600"
            aria-label="Zoom out"
          >
            <MinusIcon className="size-4" />
          </button>

          <div className="relative mx-1" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen((v) => !v)}
              className="flex h-8 min-w-16 items-center justify-center rounded-lg px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700/45"
              aria-label={`Zoom level: ${zoomPercent}%`}
            >
              {zoomPercent}%
            </button>

            {isDropdownOpen && (
              <div className="absolute bottom-[calc(100%+6px)] left-1/2 z-10 min-w-[8.5rem] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200/85 bg-white/96 py-1 shadow-lg backdrop-blur-md dark:border-slate-600/40 dark:bg-[rgba(30,41,59,0.96)]">
                {DOCUMENT_ZOOM_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => { applyZoomCentred(option); setIsDropdownOpen(false); }}
                    className="flex w-full items-center justify-between px-3.5 py-1.5 text-xs transition hover:bg-slate-100 dark:hover:bg-slate-700/45"
                  >
                    <span className={zoomPercent === option ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}>
                      {option}%
                    </span>
                    {zoomPercent === option && <CheckIcon className="ml-4 size-3 text-slate-500 dark:text-slate-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mx-1 h-4 w-px bg-slate-200/80 dark:bg-slate-600/50" />

          <button
            type="button"
            onClick={() => isFreePan ? resetZoom() : (setIsFreePan(true), isFreePanRef.current = true)}
            className={`flex size-8 items-center justify-center rounded-lg transition ${isFreePan ? 'bg-slate-100 text-slate-900 dark:bg-slate-700/55 dark:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700/45 dark:hover:text-slate-300'}`}
            aria-label={isFreePan ? 'Exit freeform pan' : 'Enter freeform pan'}
          >
            <MoveIcon className="size-4" />
          </button>

          <button
            type="button"
            disabled={!canZoomIn}
            onClick={() => applyZoomCentred(getNextZoomOption(zoomPercent))}
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
