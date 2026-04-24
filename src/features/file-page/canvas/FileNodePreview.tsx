import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getPdfBinary } from '@/lib/pdfBinaryStore';

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// ─── PDF page cache (module-level, survives re-mounts) ────────────────────────

const pdfPageCache = new Map<string, string[]>();

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
  'dockerfile', 'makefile',
]);

type FileKind = 'pdf' | 'markdown' | 'json' | 'code' | 'text';

function detectKind(label: string, mimeType?: string | null): FileKind {
  const ext = label.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'md' || ext === 'mdx' || mimeType === 'text/markdown') return 'markdown';
  if (ext === 'json' || mimeType === 'application/json') return 'json';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'text';
}

// ─── Inline markdown ───────────────────────────────────────────────────────────

function renderInline(raw: string): ReactNode {
  // Split on **bold**, *italic*, `code`, stripping trailing link syntax simply
  const segments = raw.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[([^\]]+)\]\([^)]+\))/g);
  const out: ReactNode[] = [];

  let idx = 0;
  while (idx < segments.length) {
    const seg = segments[idx];
    if (!seg) { idx++; continue; }
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
      out.push(<strong key={idx} className="font-semibold text-slate-700 dark:text-slate-300">{seg.slice(2, -2)}</strong>);
    } else if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) {
      out.push(<em key={idx} className="italic text-slate-600 dark:text-slate-400">{seg.slice(1, -1)}</em>);
    } else if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
      out.push(
        <code key={idx} className="rounded bg-slate-100/90 px-[3px] py-[1px] font-mono text-[0.85em] text-slate-700 dark:bg-slate-700/60 dark:text-slate-200">
          {seg.slice(1, -1)}
        </code>,
      );
    } else if (seg.startsWith('[')) {
      // Render link text only (no href)
      const linkText = segments[idx + 1] ?? '';
      out.push(<span key={idx} className="underline text-slate-600 dark:text-slate-400">{linkText || seg}</span>);
      idx += 2;
      continue;
    } else {
      out.push(seg);
    }
    idx++;
  }
  return out;
}

// ─── Markdown block renderer ───────────────────────────────────────────────────

function MarkdownContent({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.split('\n');
    const result: ReactNode[] = [];
    let inCode = false;
    let codeLines: string[] = [];
    let codeLang = '';
    let listItems: { ordered: boolean; content: string }[] = [];

    function flushList(key: string) {
      if (!listItems.length) return;
      const ordered = listItems[0].ordered;
      const Tag = ordered ? 'ol' : 'ul';
      result.push(
        <Tag key={key} className={ordered ? 'list-decimal ml-3.5 space-y-[1px]' : 'list-disc ml-3.5 space-y-[1px]'}>
          {listItems.map((item, i) => (
            <li key={i} className="text-[9.5px] leading-[1.55] text-slate-600 dark:text-slate-400">
              {renderInline(item.content)}
            </li>
          ))}
        </Tag>,
      );
      listItems = [];
    }

    lines.forEach((line, i) => {
      const key = String(i);

      // Inside a fenced code block
      if (inCode) {
        if (line.startsWith('```')) {
          result.push(
            <pre key={`code-${key}`} className="overflow-x-hidden whitespace-pre-wrap break-all rounded-[6px] border border-slate-200/70 bg-slate-50/90 px-2 py-1.5 font-mono text-[8.5px] leading-[1.55] text-slate-700 dark:border-slate-600/30 dark:bg-slate-800/60 dark:text-slate-300">
              {codeLang ? <span className="mb-1 block font-sans text-[7.5px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{codeLang}</span> : null}
              {codeLines.join('\n')}
            </pre>,
          );
          inCode = false;
          codeLines = [];
          codeLang = '';
        } else {
          codeLines.push(line);
        }
        return;
      }

      // Fenced code block start
      if (line.startsWith('```')) {
        flushList(`list-before-code-${key}`);
        inCode = true;
        codeLang = line.slice(3).trim();
        return;
      }

      // Blank line
      if (line.trim() === '') {
        flushList(`list-${key}`);
        return;
      }

      // ATX heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushList(`list-before-h-${key}`);
        const depth = headingMatch[1].length;
        const headingClass =
          depth === 1 ? 'text-[12px] font-bold text-slate-900 dark:text-white leading-tight mt-1.5 first:mt-0' :
          depth === 2 ? 'text-[11px] font-semibold text-slate-800 dark:text-slate-100 leading-tight mt-1 first:mt-0' :
                        'text-[10px] font-semibold text-slate-700 dark:text-slate-200 leading-tight mt-0.5 first:mt-0';
        result.push(
          <div key={key} className={headingClass}>{renderInline(headingMatch[2])}</div>,
        );
        return;
      }

      // Setext heading (underline style)
      if (/^[=]{2,}$/.test(line.trim()) && result.length > 0) {
        // Upgrade last element visually — skip for simplicity
        return;
      }
      if (/^[-]{2,}$/.test(line.trim()) && result.length > 0) {
        // Check if previous is a setext h2 candidate; else treat as hr
        result.push(<hr key={key} className="my-1 border-slate-200/70 dark:border-slate-600/40" />);
        return;
      }

      // Horizontal rule
      if (/^[*_-]{3,}$/.test(line.replace(/\s/g, ''))) {
        flushList(`list-before-hr-${key}`);
        result.push(<hr key={key} className="my-1 border-slate-200/70 dark:border-slate-600/40" />);
        return;
      }

      // Blockquote
      if (line.startsWith('>')) {
        flushList(`list-before-bq-${key}`);
        result.push(
          <div key={key} className="border-l-[2px] border-slate-300/70 pl-2 text-[9px] italic leading-[1.55] text-slate-500 dark:border-slate-500/50 dark:text-slate-400">
            {renderInline(line.replace(/^>\s?/, ''))}
          </div>,
        );
        return;
      }

      // Bullet list item
      const bulletMatch = line.match(/^[-*+]\s+(.+)$/);
      if (bulletMatch) {
        if (listItems.length > 0 && listItems[0].ordered) flushList(`list-${key}`);
        listItems.push({ ordered: false, content: bulletMatch[1] });
        return;
      }

      // Ordered list item
      const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/);
      if (orderedMatch) {
        if (listItems.length > 0 && !listItems[0].ordered) flushList(`list-${key}`);
        listItems.push({ ordered: true, content: orderedMatch[1] });
        return;
      }

      // Indented code (4-space)
      if (line.startsWith('    ') && !listItems.length) {
        result.push(
          <pre key={key} className="font-mono text-[8.5px] leading-[1.55] text-slate-600 dark:text-slate-400">
            {line.slice(4)}
          </pre>,
        );
        return;
      }

      // Paragraph line — flush any pending list first
      flushList(`list-before-p-${key}`);
      result.push(
        <p key={key} className="text-[9.5px] leading-[1.55] text-slate-600 dark:text-slate-400">
          {renderInline(line)}
        </p>,
      );
    });

    // Flush any trailing list or open code block
    flushList('list-end');
    if (inCode && codeLines.length > 0) {
      result.push(
        <pre key="code-end" className="overflow-x-hidden whitespace-pre-wrap break-all rounded-[6px] border border-slate-200/70 bg-slate-50/90 px-2 py-1.5 font-mono text-[8.5px] leading-[1.55] text-slate-700 dark:border-slate-600/30 dark:bg-slate-800/60 dark:text-slate-300">
          {codeLines.join('\n')}
        </pre>,
      );
    }

    return result;
  }, [text]);

  return <div className="space-y-[3px]">{blocks}</div>;
}

// ─── JSON renderer ─────────────────────────────────────────────────────────────

function JsonContent({ text }: { text: string }) {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }, [text]);

  return (
    <pre className="whitespace-pre-wrap break-all font-mono text-[8.5px] leading-[1.6] text-slate-600 dark:text-slate-400">
      {formatted}
    </pre>
  );
}

// ─── Code renderer ─────────────────────────────────────────────────────────────

function CodeContent({ text, ext }: { text: string; ext: string }) {
  return (
    <div>
      {ext ? (
        <span className="mb-1.5 inline-block rounded-full bg-slate-100/90 px-1.5 py-[1px] font-mono text-[7.5px] uppercase tracking-wide text-slate-400 dark:bg-slate-700/50 dark:text-slate-500">
          .{ext}
        </span>
      ) : null}
      <pre className="whitespace-pre-wrap break-all font-mono text-[8.5px] leading-[1.6] text-slate-600 dark:text-slate-400">
        {text}
      </pre>
    </div>
  );
}

// ─── PDF renderer ─────────────────────────────────────────────────────────────

const MAX_PREVIEW_PAGES = 12;
const RENDER_SCALE = 1.5;

type PdfState =
  | { status: 'loading' }
  | { status: 'ready'; pages: string[] }
  | { status: 'no-data' }
  | { status: 'error' };

function PdfContent({ fileId }: { fileId: string }) {
  const [state, setState] = useState<PdfState>(() => {
    const cached = pdfPageCache.get(fileId);
    return cached ? { status: 'ready', pages: cached } : { status: 'loading' };
  });
  const cancelRef = useRef(false);

  useEffect(() => {
    if (pdfPageCache.has(fileId)) {
      setState({ status: 'ready', pages: pdfPageCache.get(fileId)! });
      return;
    }

    cancelRef.current = false;

    async function renderPages() {
      try {
        const data = await getPdfBinary(fileId);
        if (cancelRef.current) return;

        if (!data) {
          setState({ status: 'no-data' });
          return;
        }

        const pdf = await getDocument({
          data: new Uint8Array(data),
          useWorkerFetch: false,
          isEvalSupported: false,
        }).promise;

        const count = Math.min(pdf.numPages, MAX_PREVIEW_PAGES);
        const urls: string[] = [];

        for (let n = 1; n <= count; n++) {
          if (cancelRef.current) break;
          const page = await pdf.getPage(n);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          urls.push(canvas.toDataURL('image/jpeg', 0.82));
        }

        await pdf.destroy();

        if (!cancelRef.current) {
          pdfPageCache.set(fileId, urls);
          setState({ status: 'ready', pages: urls });
        }
      } catch {
        if (!cancelRef.current) setState({ status: 'error' });
      }
    }

    void renderPages();
    return () => { cancelRef.current = true; };
  }, [fileId]);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-1.5 py-1">
        <span className="size-1.5 animate-pulse rounded-full bg-slate-300 dark:bg-slate-600" />
        <span className="text-[9px] text-slate-400 dark:text-slate-500">Rendering PDF…</span>
      </div>
    );
  }

  if (state.status === 'no-data' || state.status === 'error') {
    return (
      <p className="text-[9px] text-slate-400 dark:text-slate-500">
        {state.status === 'no-data'
          ? 'PDF binary not found — re-upload the file to enable page preview.'
          : 'Could not render PDF.'}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {state.pages.map((url, i) => (
        <div key={i} className="relative overflow-hidden rounded-[4px] border border-slate-200/70 shadow-[0_1px_3px_rgba(15,23,42,0.06)] dark:border-slate-600/30">
          <img
            src={url}
            alt={`Page ${i + 1}`}
            draggable={false}
            className="block w-full select-none"
          />
          <span className="absolute bottom-1 right-1.5 rounded-sm bg-black/30 px-1 py-[1px] font-mono text-[7px] text-white/80 backdrop-blur-[2px]">
            {i + 1}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface FileNodePreviewProps {
  textContent: string | null;
  label: string;
  mimeType?: string | null;
  fileId?: string | null;
}

export function FileNodePreview({ textContent, label, mimeType, fileId }: FileNodePreviewProps) {
  const ext = label.split('.').pop()?.toLowerCase() ?? '';
  const kind = detectKind(label, mimeType);

  if (kind === 'pdf') {
    if (fileId) {
      return <PdfContent fileId={fileId} />;
    }
    // Fallback: show extracted text if binary isn't available
    if (textContent) {
      return (
        <pre className="whitespace-pre-wrap break-words text-[9.5px] leading-[1.55] text-slate-600 dark:text-slate-400">
          {textContent.slice(0, 8000)}
        </pre>
      );
    }
    return (
      <p className="text-[9px] text-slate-400 dark:text-slate-500">
        Re-upload this PDF to enable page preview.
      </p>
    );
  }

  const clipped = (textContent ?? '').slice(0, 8000);

  return (
    <div className="h-full">
      {kind === 'markdown' ? (
        <MarkdownContent text={clipped} />
      ) : kind === 'json' ? (
        <JsonContent text={clipped} />
      ) : kind === 'code' ? (
        <CodeContent text={clipped} ext={ext} />
      ) : (
        <pre className="whitespace-pre-wrap break-words text-[9.5px] leading-[1.55] text-slate-600 dark:text-slate-400">
          {clipped}
        </pre>
      )}
    </div>
  );
}
