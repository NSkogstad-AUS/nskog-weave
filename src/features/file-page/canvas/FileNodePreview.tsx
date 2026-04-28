import { useMemo } from 'react';
import type { ReactNode } from 'react';

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
const MAX_INLINE_PREVIEW_CHARACTERS = 2_000;
const MAX_INLINE_PDF_TEXT_CHARACTERS = 1_200;

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
    const previewText = (textContent ?? '').slice(0, MAX_INLINE_PDF_TEXT_CHARACTERS).trim();

    if (previewText) {
      return (
        <div className="space-y-2">
          <div className="rounded-full border border-slate-200/70 bg-slate-100/85 px-2 py-1 text-[7.5px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-600/35 dark:bg-slate-800/60 dark:text-slate-400">
            PDF text excerpt
          </div>
          <pre className="whitespace-pre-wrap break-words text-[9.5px] leading-[1.55] text-slate-600 dark:text-slate-400">
            {previewText}
          </pre>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <div className="rounded-full border border-slate-200/70 bg-slate-100/85 px-2 py-1 text-[7.5px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-600/35 dark:bg-slate-800/60 dark:text-slate-400">
          PDF
        </div>
        <p className="text-[9px] text-slate-400 dark:text-slate-500">
          Open this file to view the full PDF. Inline page rendering is disabled in canvas cards for performance.
        </p>
        {fileId ? (
          <p className="text-[8px] text-slate-400/90 dark:text-slate-500">
            Full document rendering is still available when the file is opened.
          </p>
        ) : null}
      </div>
    );
  }

  const clipped = (textContent ?? '').slice(0, MAX_INLINE_PREVIEW_CHARACTERS);

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
