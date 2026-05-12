import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TiptapUnderline from '@tiptap/extension-underline';
import {
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  DownloadIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  MinusIcon,
  MoveIcon,
  PlusIcon,
  StickyNoteIcon,
  UnderlineIcon,
} from 'lucide-react';

import { getPdfBinary } from '@/lib/pdfBinaryStore';
import { loadPdfJs } from '@/lib/pdfRuntime';
import type { PdfDocument } from '@/lib/pdfRuntime';
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
const NOTES_PANEL_WIDTH = 384; // px — matches w-96 Tailwind class
const NOTES_PANEL_GAP = 24; // gap between content and notes panel (fixed overlay fallback)
const NOTES_FLEX_GAP = 16; // ml-4 in px — gap used in the in-canvas flex row
const PDF_PAGE_SIDEBAR_TOP = 60;
const PDF_PAGE_SIDEBAR_BUTTON_TOP = 63;
const PDF_PAGE_SIDEBAR_WIDTH = 200;
const PDF_PAGE_SIDEBAR_MARGIN = 16;
const PDF_PAGE_THUMBNAIL_WIDTH = 140;
const DOC_RENDER_MAX_CONCURRENT = 2;
const EMPTY_PAGE_NOTES: Record<number, string> = {};
const NOTE_EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    underline: false,
  }),
  TiptapUnderline,
];

let activeDocumentPageRenders = 0;
const documentPageRenderQueue: Array<() => void> = [];

function scheduleDocumentPageRender<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeDocumentPageRenders += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeDocumentPageRenders = Math.max(0, activeDocumentPageRenders - 1);
          const next = documentPageRenderQueue.shift();
          next?.();
        });
    };

    if (activeDocumentPageRenders < DOC_RENDER_MAX_CONCURRENT) {
      run();
    } else {
      documentPageRenderQueue.push(run);
    }
  });
}

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

type DocKind = 'pdf' | 'markdown' | 'json' | 'code' | 'text';

function detectKind(label: string, mimeType?: string | null): DocKind {
  const ext = label.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'md' || ext === 'mdx' || mimeType === 'text/markdown') return 'markdown';
  if (ext === 'json' || mimeType === 'application/json') return 'json';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'text';
}

// In notes mode each displayed zoom step maps to 2× actual zoom
const NOTES_DISPLAY_OPTIONS = DOCUMENT_ZOOM_OPTIONS; // [50,75,90,100,125,150,175,200] shown as effective
const NOTES_MIN_ZOOM = NOTES_DISPLAY_OPTIONS[0] * 2; // 100 actual
const NOTES_MAX_ZOOM = NOTES_DISPLAY_OPTIONS[NOTES_DISPLAY_OPTIONS.length - 1] * 2; // 400 actual

function getPreviousZoomOption(value: number, options = DOCUMENT_ZOOM_OPTIONS) {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (options[index] < value) return options[index];
  }
  return options[0];
}

function getNextZoomOption(value: number, options = DOCUMENT_ZOOM_OPTIONS) {
  return options.find((option) => option > value) ?? options[options.length - 1];
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

// ─── Rich notes editor ────────────────────────────────────────────────────────

type HeadingLevel = 1 | 2 | 3;

function escapeHtml(raw: string) {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function noteValueToEditorContent(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/<\/?[a-z][\s\S]*>/i.test(trimmed)) return value;

  return trimmed
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function stripNoteHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function isNoteMeaningful(value: string) {
  const html = noteValueToEditorContent(value).trim();
  return Boolean(html && (/<hr\b/i.test(html) || stripNoteHtml(html).length > 0));
}

function inlineMarkdownFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.replace(/\u00a0/g, ' ') ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const content = Array.from(element.childNodes).map(inlineMarkdownFromNode).join('');

  switch (element.tagName) {
    case 'BR':
      return '\n';
    case 'STRONG':
    case 'B':
      return content ? `**${content}**` : '';
    case 'EM':
    case 'I':
      return content ? `*${content}*` : '';
    case 'U':
      return content ? `<u>${content}</u>` : '';
    case 'S':
    case 'DEL':
      return content ? `~~${content}~~` : '';
    case 'CODE':
      return content ? `\`${content.replace(/`/g, '\\`')}\`` : '';
    default:
      return content;
  }
}

function listItemMarkdown(element: HTMLElement, ordered: boolean, index: number) {
  const nestedLists: HTMLElement[] = [];
  const ownContent = Array.from(element.childNodes)
    .map((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childElement = child as HTMLElement;
        if (childElement.tagName === 'UL' || childElement.tagName === 'OL') {
          nestedLists.push(childElement);
          return '';
        }
        if (childElement.tagName === 'P') {
          return Array.from(childElement.childNodes).map(inlineMarkdownFromNode).join('');
        }
      }
      return blockMarkdownFromNode(child);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const prefix = ordered ? `${index + 1}. ` : '- ';
  const nested = nestedLists
    .map((list) => blockMarkdownFromNode(list))
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .map((line) => `  ${line}`)
    .join('\n');

  return `${prefix}${ownContent}${nested ? `\n${nested}` : ''}`;
}

function blockMarkdownFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.trim() ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const inlineContent = () => Array.from(element.childNodes).map(inlineMarkdownFromNode).join('').trim();

  switch (element.tagName) {
    case 'P':
      return inlineContent();
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Number(element.tagName.slice(1));
      return `${'#'.repeat(level)} ${inlineContent()}`;
    }
    case 'HR':
      return '---';
    case 'UL':
    case 'OL': {
      const ordered = element.tagName === 'OL';
      return Array.from(element.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'LI')
        .map((child, index) => listItemMarkdown(child, ordered, index))
        .join('\n');
    }
    case 'BLOCKQUOTE': {
      const quote = Array.from(element.childNodes)
        .map(blockMarkdownFromNode)
        .filter(Boolean)
        .join('\n\n');
      return quote.split('\n').map((line) => `> ${line}`).join('\n');
    }
    case 'PRE':
      return `\`\`\`\n${(element.textContent ?? '').replace(/\n$/g, '')}\n\`\`\``;
    default:
      return Array.from(element.childNodes).map(blockMarkdownFromNode).filter(Boolean).join('\n\n');
  }
}

function noteHtmlToMarkdown(value: string) {
  const html = noteValueToEditorContent(value);
  if (!html.trim()) return '';
  if (typeof DOMParser === 'undefined') return stripNoteHtml(html);

  const documentValue = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(documentValue.body.childNodes)
    .map(blockMarkdownFromNode)
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderNotePreviewNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.replace(/\u00a0/g, ' ') ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const children = Array.from(element.childNodes).map((child, index) => renderNotePreviewNode(child, `${key}-${index}`));

  switch (element.tagName) {
    case 'SCRIPT':
    case 'STYLE':
      return null;
    case 'BR':
      return <br key={key} />;
    case 'P':
      return <p key={key}>{children}</p>;
    case 'H1':
      return <h1 key={key}>{children}</h1>;
    case 'H2':
      return <h2 key={key}>{children}</h2>;
    case 'H3':
      return <h3 key={key}>{children}</h3>;
    case 'STRONG':
    case 'B':
      return <strong key={key}>{children}</strong>;
    case 'EM':
    case 'I':
      return <em key={key}>{children}</em>;
    case 'U':
      return <u key={key}>{children}</u>;
    case 'S':
    case 'DEL':
      return <s key={key}>{children}</s>;
    case 'CODE':
      return <code key={key}>{children}</code>;
    case 'PRE':
      return <pre key={key}>{element.textContent ?? ''}</pre>;
    case 'UL':
      return <ul key={key}>{children}</ul>;
    case 'OL':
      return <ol key={key}>{children}</ol>;
    case 'LI':
      return <li key={key}>{children}</li>;
    case 'HR':
      return <hr key={key} />;
    case 'BLOCKQUOTE':
      return <blockquote key={key}>{children}</blockquote>;
    case 'A':
      return <span key={key} className="underline decoration-current/40">{children}</span>;
    default:
      return <span key={key}>{children}</span>;
  }
}

function NotePreviewContent({ value }: { value: string }) {
  const content = useMemo(() => {
    const html = noteValueToEditorContent(value);
    if (!html.trim() || typeof DOMParser === 'undefined') {
      return stripNoteHtml(html);
    }

    const documentValue = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(documentValue.body.childNodes).map((node, index) => renderNotePreviewNode(node, String(index)));
  }, [value]);

  return <>{content}</>;
}

function InactiveNoteEditor({
  ariaLabel,
  compact = false,
  onActivate,
  placeholder,
  value,
}: {
  ariaLabel: string;
  compact?: boolean;
  onActivate: () => void;
  placeholder: string;
  value: string;
}) {
  const hasContent = isNoteMeaningful(value);

  return (
    <div
      role="textbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-multiline="true"
      onClick={onActivate}
      onFocus={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onActivate();
        }
      }}
      className={`note-preview h-full min-h-0 cursor-text overflow-y-auto px-4 py-3 text-sidebar-foreground/80 outline-none transition hover:bg-sidebar-accent/30 focus:bg-sidebar-accent/30 soft-scrollbar ${compact ? 'note-preview-compact' : ''}`}
      style={{ '--note-editor-font-size': compact ? '9px' : '0.84rem' } as CSSProperties}
    >
      {hasContent ? (
        <NotePreviewContent value={value} />
      ) : (
        <span className="text-sidebar-foreground/25">{placeholder}</span>
      )}
    </div>
  );
}

function NoteToolbarButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded-md transition disabled:pointer-events-none disabled:opacity-35 ${
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/50 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground/80'
      }`}
    >
      {children}
    </button>
  );
}

function NoteToolbar({ editor, compact = false }: { editor: Editor | null; compact?: boolean }) {
  const iconClassName = compact ? 'size-3' : 'size-3.5';
  const disabled = !editor;
  const run = (command: (target: Editor) => void) => {
    if (!editor) return;
    command(editor);
  };
  const headingButton = (level: HeadingLevel, icon: ReactNode) => (
    <NoteToolbarButton
      key={level}
      label={`Heading ${level}`}
      disabled={disabled}
      active={editor?.isActive('heading', { level }) ?? false}
      onClick={() => run((target) => target.chain().focus().toggleHeading({ level }).run())}
    >
      {icon}
    </NoteToolbarButton>
  );

  return (
    <div className="flex items-center gap-1 rounded-xl border border-sidebar-border/35 bg-sidebar/95 p-1 shadow-lg backdrop-blur-xl">
      <NoteToolbarButton
        label="Bold"
        disabled={disabled}
        active={editor?.isActive('bold') ?? false}
        onClick={() => run((target) => target.chain().focus().toggleBold().run())}
      >
        <BoldIcon className={iconClassName} />
      </NoteToolbarButton>
      <NoteToolbarButton
        label="Italic"
        disabled={disabled}
        active={editor?.isActive('italic') ?? false}
        onClick={() => run((target) => target.chain().focus().toggleItalic().run())}
      >
        <ItalicIcon className={iconClassName} />
      </NoteToolbarButton>
      <NoteToolbarButton
        label="Underline"
        disabled={disabled}
        active={editor?.isActive('underline') ?? false}
        onClick={() => run((target) => target.chain().focus().toggleUnderline().run())}
      >
        <UnderlineIcon className={iconClassName} />
      </NoteToolbarButton>

      <div className="mx-1 h-4 w-px bg-sidebar-border/40" />

      {headingButton(1, <Heading1Icon className={iconClassName} />)}
      {headingButton(2, <Heading2Icon className={iconClassName} />)}
      {headingButton(3, <Heading3Icon className={iconClassName} />)}
    </div>
  );
}

function NoteEditor({
  ariaLabel,
  autoFocus = false,
  compact = false,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string;
  autoFocus?: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const [editorUiState, setEditorUiState] = useState({
    hasTextSelection: false,
    isEmpty: !isNoteMeaningful(value),
    revision: 0,
  });
  const refreshEditorState = useCallback((target: Editor) => {
    const { from, to } = target.state.selection;
    const hasTextSelection = target.isFocused && from !== to && target.state.doc.textBetween(from, to, ' ').trim().length > 0;

    setEditorUiState((previous) => {
      const shouldTrackToolbarState = hasTextSelection || previous.hasTextSelection;
      if (
        previous.isEmpty === target.isEmpty
        && previous.hasTextSelection === hasTextSelection
        && !shouldTrackToolbarState
      ) {
        return previous;
      }

      return {
        hasTextSelection,
        isEmpty: target.isEmpty,
        revision: shouldTrackToolbarState ? previous.revision + 1 : previous.revision,
      };
    });
  }, []);
  const editor = useEditor({
    extensions: NOTE_EDITOR_EXTENSIONS,
    content: noteValueToEditorContent(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        spellcheck: 'true',
      },
    },
    onCreate: ({ editor: target }) => refreshEditorState(target),
    onBlur: ({ editor: target }) => refreshEditorState(target),
    onSelectionUpdate: ({ editor: target }) => refreshEditorState(target),
    onUpdate: ({ editor: target }) => {
      onChange(target.isEmpty ? '' : target.getHTML());
      refreshEditorState(target);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const nextContent = noteValueToEditorContent(value);
    const currentContent = editor.isEmpty ? '' : editor.getHTML();
    if (nextContent === currentContent || (!nextContent && editor.isEmpty)) return;
    editor.commands.setContent(nextContent || '<p></p>', { emitUpdate: false });
    refreshEditorState(editor);
  }, [editor, refreshEditorState, value]);

  useEffect(() => {
    if (!editor || !autoFocus) return undefined;
    const frame = window.requestAnimationFrame(() => {
      editor.commands.focus('end');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, editor]);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{ '--note-editor-font-size': compact ? '9px' : '0.84rem' } as CSSProperties}
    >
      <div className="relative min-h-0 flex-1">
        {editor && editorUiState.hasTextSelection ? (
          <div className="absolute left-3 top-2 z-10">
            <NoteToolbar editor={editor} compact={compact} />
          </div>
        ) : null}
        <EditorContent
          editor={editor}
          className={`note-editor h-full overflow-y-auto text-sidebar-foreground/80 soft-scrollbar ${compact ? 'note-editor-compact' : ''}`}
        />
        {editorUiState.isEmpty ? (
          <div className={`pointer-events-none absolute left-4 top-3 text-sidebar-foreground/25 ${compact ? 'text-[9px]' : 'text-[0.84rem]'}`}>
            {placeholder}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── PDF renderer ──────────────────────────────────────────────────────────────

const DOC_RENDER_PIXEL_RATIO = 2;
const DOC_MAX_PAGES = 1000;

type PdfDocState =
  | { status: 'loading' }
  | {
      status: 'ready';
      pdf: PdfDocument;
      pageCount: number;
      totalPageCount: number;
    }
  | { status: 'no-data' }
  | { status: 'error' };

type PdfPageStatus = 'waiting' | 'rendering' | 'ready' | 'error';
type PdfSidebarDocument = {
  fileId: string;
  pdf: PdfDocument;
  pageCount: number;
  totalPageCount: number;
} | null;

function PdfPage({
  pdf,
  pageNumber,
  totalPages,
}: {
  pdf: PdfDocument;
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
        await scheduleDocumentPageRender(async () => {
          if (cancelled) {
            return;
          }

          const page = await pdf.getPage(pageNumber);

          if (cancelled) {
            page.cleanup();
            return;
          }

          const baseViewport = page.getViewport({ scale: 1 });
          const renderScale =
            baseViewport.width > 0
              ? (CONTENT_WIDTH_PX * DOC_RENDER_PIXEL_RATIO) / baseViewport.width
              : DOC_RENDER_PIXEL_RATIO;
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
          canvas.style.width = `${CONTENT_WIDTH_PX}px`;
          canvas.style.height = `${Math.round(
            baseViewport.width > 0
              ? CONTENT_WIDTH_PX * (baseViewport.height / baseViewport.width)
              : viewport.height / DOC_RENDER_PIXEL_RATIO,
          )}px`;
          renderTask = page.render({ canvas, canvasContext: ctx, viewport });
          await renderTask.promise;
          page.cleanup();

          if (!cancelled) {
            setStatus('ready');
          }
        });
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
      data-document-pdf-page
      ref={rootRef}
      className="relative overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_2px_16px_rgba(15,23,42,0.08)] dark:border-white/[0.07] dark:bg-white dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_40px_rgba(0,0,0,0.55)]"
      style={{
        width: CONTENT_WIDTH_PX,
        ...(status === 'ready' ? {} : { minHeight: 420 }),
      }}
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
      <span className="absolute bottom-2 right-2 rounded bg-black/25 px-1 py-px font-mono text-[0.58rem] text-white/70 backdrop-blur-sm">
        {pageNumber} / {totalPages}
      </span>
    </div>
  );
}

function PdfPageThumbnail({
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

    async function renderThumbnail() {
      if (cancelled || hasStarted) return;

      hasStarted = true;
      setStatus('rendering');

      try {
        await scheduleDocumentPageRender(async () => {
          if (cancelled) return;

          const page = await pdf.getPage(pageNumber);

          if (cancelled) {
            page.cleanup();
            return;
          }

          const baseViewport = page.getViewport({ scale: 1 });
          const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
          const renderScale =
            baseViewport.width > 0
              ? (PDF_PAGE_THUMBNAIL_WIDTH * pixelRatio) / baseViewport.width
              : pixelRatio;
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
          canvas.style.width = `${PDF_PAGE_THUMBNAIL_WIDTH}px`;
          canvas.style.height = `${Math.round(
            baseViewport.width > 0
              ? PDF_PAGE_THUMBNAIL_WIDTH * (baseViewport.height / baseViewport.width)
              : viewport.height / pixelRatio,
          )}px`;
          renderTask = page.render({ canvas, canvasContext: ctx, viewport });
          await renderTask.promise;
          page.cleanup();

          if (!cancelled) {
            setStatus('ready');
          }
        });
      } catch {
        if (!cancelled) {
          setStatus('error');
        }
      }
    }

    if (!('IntersectionObserver' in window)) {
      void renderThumbnail();
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
        if (!entry.isIntersecting) return;

        observer.disconnect();
        void renderThumbnail();
      },
      { rootMargin: '500px 0px' },
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
    <button
      ref={rootRef}
      type="button"
      data-pdf-page-nav={pageNumber}
      aria-current={isActive ? 'page' : undefined}
      aria-label={`Go to page ${pageNumber}`}
      onClick={onClick}
      className={`mb-3 flex w-full flex-col items-center gap-1.5 rounded-lg border p-1.5 text-left transition ${
        isActive
          ? 'border-slate-900/60 bg-slate-900/[0.06] text-slate-900 shadow-sm dark:border-white/45 dark:bg-white/[0.08] dark:text-slate-100'
          : 'border-transparent text-muted-foreground hover:border-sidebar-border/65 hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground'
      }`}
    >
      <div
        className="relative overflow-hidden rounded-md border border-slate-200/85 bg-white shadow-[0_8px_22px_-20px_rgba(15,23,42,0.7)] dark:border-white/[0.08] dark:bg-white"
        style={{ width: PDF_PAGE_THUMBNAIL_WIDTH, minHeight: 72 }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className={`block ${status === 'ready' ? '' : 'invisible'}`}
        />
        {status !== 'ready' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-[0.62rem] text-slate-300 dark:bg-slate-800/45 dark:text-slate-500">
            {status === 'error' ? 'Error' : pageNumber}
          </div>
        ) : null}
      </div>
      <span className="w-full px-0.5 text-center text-[0.66rem] font-medium">
        {pageNumber}
      </span>
    </button>
  );
}

function PdfDocument({
  activeNotePage,
  fileId,
  isNotesOpen,
  onActivateNote,
  onPdfReady,
  pageNotes,
  onNoteChange,
  onPageCount,
}: {
  activeNotePage: number | null;
  fileId: string;
  isNotesOpen: boolean;
  onActivateNote: (page: number) => void;
  onPdfReady: (document: PdfSidebarDocument) => void;
  pageNotes: Record<number, string>;
  onNoteChange: (page: number, text: string) => void;
  onPageCount: (count: number) => void;
}) {
  const [state, setState] = useState<PdfDocState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let loadedPdf: PdfDocument | null = null;

    setState({ status: 'loading' });
    onPdfReady(null);

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

        const pageCount = Math.min(loadedPdf.numPages, DOC_MAX_PAGES);
        onPageCount(pageCount);
        onPdfReady({
          fileId,
          pdf: loadedPdf,
          pageCount,
          totalPageCount: loadedPdf.numPages,
        });
        setState({
          status: 'ready',
          pdf: loadedPdf,
          pageCount,
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
      onPdfReady(null);
      void loadedPdf?.destroy();
    };
  }, [fileId, onPdfReady]);

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
      {Array.from({ length: state.pageCount }, (_, index) => {
        const pageNumber = index + 1;
        return (
          <div
            key={`${fileId}-${pageNumber}`}
            data-document-page-row
            data-document-page-number={pageNumber}
            className="flex items-start"
          >
            <PdfPage pdf={state.pdf} pageNumber={pageNumber} totalPages={state.pageCount} />
            {isNotesOpen && (
              <div data-document-page-note className="ml-4 flex w-96 shrink-0 self-stretch flex-col overflow-hidden border-t border-sidebar-border/25 bg-sidebar/85 backdrop-blur-sm">
                {activeNotePage === pageNumber ? (
                  <NoteEditor
                    compact
                    autoFocus
                    ariaLabel={`Page ${pageNumber} notes`}
                    placeholder={`Page ${pageNumber} notes...`}
                    value={pageNotes[pageNumber] ?? ''}
                    onChange={(value) => onNoteChange(pageNumber, value)}
                  />
                ) : (
                  <InactiveNoteEditor
                    compact
                    ariaLabel={`Page ${pageNumber} notes`}
                    placeholder={`Page ${pageNumber} notes...`}
                    value={pageNotes[pageNumber] ?? ''}
                    onActivate={() => onActivateNote(pageNumber)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
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
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [activeNotePage, setActiveNotePage] = useState<number | null>(null);
  const [notesByFile, setNotesByFile] = useState<Record<string, Record<number, string>>>({});
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [activePdfPage, setActivePdfPage] = useState(1);
  const [pdfSidebarDocument, setPdfSidebarDocument] = useState<PdfSidebarDocument>(null);
  const [isPdfSidebarCollapsed, setIsPdfSidebarCollapsed] = useState(true);
  const pageNotes = notesByFile[file.id] ?? EMPTY_PAGE_NOTES;

  // Mutable ref for synchronous reads in event handlers — kept in sync with state
  const vpRef = useRef({ zoomPercent: 100, panX: 0, panY: CONTENT_INITIAL_TOP });
  const contentHeightRef = useRef(0);
  const isFreePanRef = useRef(false);
  const isNotesOpenRef = useRef(false);
  const zoomRafRef = useRef<number | null>(null);
  const pendingZoomRef = useRef<{ cx: number; cy: number; zoom: number } | null>(null);
  const panRafRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ clientX: 0, clientY: 0, panX: 0, panY: 0 });
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const pageSidebarRef = useRef<HTMLDivElement | null>(null);
  const pdfPageJumpLockUntilRef = useRef(0);

  const scale = zoomPercent / 100;
  const displayZoom = isNotesOpen ? Math.round(zoomPercent / 2) : zoomPercent;
  const canZoomOut = zoomPercent > (isNotesOpen ? NOTES_MIN_ZOOM : DOCUMENT_MIN_ZOOM);
  const canZoomIn = zoomPercent < (isNotesOpen ? NOTES_MAX_ZOOM : DOCUMENT_MAX_ZOOM);
  const hasDownloadableNotes = useMemo(() => {
    if (kind !== 'pdf') {
      return isNoteMeaningful(pageNotes[1] ?? '');
    }

    for (let page = 1; page <= pdfPageCount; page += 1) {
      if (isNoteMeaningful(pageNotes[page] ?? '')) return true;
    }

    return false;
  }, [kind, pageNotes, pdfPageCount]);

  useEffect(() => {
    const key = `${file.label}_notes`;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<number, string>;
        setNotesByFile((prev) => ({ ...prev, [file.id]: parsed }));
      }
    } catch {
      // ignore corrupt data
    }
  }, [file.id, file.label]);

  const updatePageNote = useCallback((page: number, note: string) => {
    setNotesByFile((previous) => {
      const updated = {
        ...previous,
        [file.id]: {
          ...(previous[file.id] ?? EMPTY_PAGE_NOTES),
          [page]: note,
        },
      };
      const key = `${file.label}_notes`;
      try {
        window.localStorage.setItem(key, JSON.stringify(updated[file.id]));
      } catch {
        // ignore quota errors
      }
      return updated;
    });
  }, [file.id, file.label]);

  const updatePdfSidebarDocument = useCallback((document: PdfSidebarDocument) => {
    setPdfSidebarDocument(document);
  }, []);

  const updateActivePdfPage = useCallback(() => {
    if (kind !== 'pdf' || pdfPageCount <= 0) {
      setActivePdfPage(1);
      return;
    }

    if (performance.now() < pdfPageJumpLockUntilRef.current) {
      return;
    }

    const rows = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>('[data-document-page-row]') ?? [],
    );
    if (rows.length === 0) {
      return;
    }

    const root = rootRef.current;
    const currentScale = vpRef.current.zoomPercent / 100;
    const focusY = root
      ? Math.min(
          Math.max(root.clientHeight * 0.35, CONTENT_INITIAL_TOP + 72),
          Math.max(CONTENT_INITIAL_TOP + 24, root.clientHeight - 80),
        )
      : CONTENT_INITIAL_TOP + 72;
    let nearestPage = 1;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const row of rows) {
      const rawPageNumber = Number(row.dataset.documentPageNumber);
      const pageNumber = Number.isFinite(rawPageNumber) && rawPageNumber > 0 ? rawPageNumber : nearestPage;
      const top = vpRef.current.panY + row.offsetTop * currentScale;
      const bottom = top + row.offsetHeight * currentScale;

      if (focusY >= top && focusY <= bottom) {
        nearestPage = pageNumber;
        nearestDistance = 0;
        break;
      }

      const distance = Math.min(Math.abs(focusY - top), Math.abs(focusY - bottom));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = pageNumber;
      }
    }

    setActivePdfPage((current) => (current === nearestPage ? current : nearestPage));
  }, [kind, pdfPageCount]);

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

  // Compute the centred panX.
  // Notes-open PDF view: center the split between page and notes, so both panes
  // share the viewport around the middle. Other note views keep block centering.
  // Notes-closed: standard behaviour — center and allow symmetric clipping at high zoom.
  const calcCentreX = useCallback((root: HTMLElement | null, scaledWidth: number) => {
    const total = root?.clientWidth ?? 0;
    if (isNotesOpenRef.current) {
      const scale = CONTENT_WIDTH_PX > 0 ? scaledWidth / CONTENT_WIDTH_PX : 1;
      if (kind === 'pdf') {
        const pageRow = contentRef.current?.querySelector<HTMLElement>('[data-document-page-row]');
        const pageElement = pageRow?.querySelector<HTMLElement>('[data-document-pdf-page]');
        const noteElement = pageRow?.querySelector<HTMLElement>('[data-document-page-note]');

        if (pageElement && noteElement) {
          const pageRight = pageElement.offsetLeft + pageElement.offsetWidth;
          const noteLeft = noteElement.offsetLeft;
          const splitAnchorX = (pageRight + noteLeft) / 2;
          return total / 2 - splitAnchorX * scale;
        }

        const fallbackSplitAnchorX = CONTENT_WIDTH_PX + NOTES_FLEX_GAP / 2;
        return total / 2 - fallbackSplitAnchorX * scale;
      }
      const blockWidth = scaledWidth + (NOTES_FLEX_GAP + NOTES_PANEL_WIDTH) * scale;
      return (total - blockWidth) / 2;
    }
    // For PDFs (notes closed), the page may be narrower than CONTENT_WIDTH_PX
    // (e.g. beamer slides). Measure the actual rendered page width from the DOM
    // so the centering matches what the user actually sees.
    if (kind === 'pdf') {
      const pageElement = contentRef.current?.querySelector<HTMLElement>('[data-document-pdf-page]');
      const actualWidth = pageElement ? pageElement.clientWidth * (scaledWidth / CONTENT_WIDTH_PX) : scaledWidth;
      return actualWidth >= total
        ? (total - actualWidth) / 2
        : Math.max(32, (total - actualWidth) / 2);
    }
    return scaledWidth >= total
      ? (total - scaledWidth) / 2
      : Math.max(32, (total - scaledWidth) / 2);
  }, [kind]);

  // Center content horizontally on first layout
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || initialized) return;
    const x = calcCentreX(root, CONTENT_WIDTH_PX);
    vpRef.current = { zoomPercent: 100, panX: x, panY: CONTENT_INITIAL_TOP };
    setPan({ x, y: CONTENT_INITIAL_TOP });
    setInitialized(true);
  }, [initialized, calcCentreX]);

  // Re-center horizontally when the container resizes (e.g. sidebar toggled)
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const recentre = () => {
      if (!initialized || isFreePanRef.current) return;
      const scaledWidth = CONTENT_WIDTH_PX * (vpRef.current.zoomPercent / 100);
      const x = calcCentreX(root, scaledWidth);
      if (x === vpRef.current.panX) return;
      vpRef.current = { ...vpRef.current, panX: x };
      setPan((prev) => ({ ...prev, x }));
    };
    // Re-centre immediately in case the container settled while initialized was false
    recentre();
    const observer = new ResizeObserver(() => window.requestAnimationFrame(recentre));
    observer.observe(root);
    return () => observer.disconnect();
  }, [initialized, calcCentreX]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;

    const updateContentHeight = () => {
      contentHeightRef.current = content.scrollHeight;
      const clampedY = clampPanY(vpRef.current.panY, vpRef.current.zoomPercent);
      const scaledWidth = CONTENT_WIDTH_PX * (vpRef.current.zoomPercent / 100);
      const nextPanX = initialized && !isFreePanRef.current
        ? calcCentreX(rootRef.current, scaledWidth)
        : vpRef.current.panX;

      if (clampedY !== vpRef.current.panY || nextPanX !== vpRef.current.panX) {
        vpRef.current = {
          ...vpRef.current,
          panX: nextPanX,
          panY: clampedY,
        };
        setPan({ x: nextPanX, y: clampedY });
      }

      updateActivePdfPage();
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
  }, [calcCentreX, clampPanY, file.id, initialized, kind, updateActivePdfPage]);

  // Keep vpRef, isFreePanRef, isNotesOpenRef in sync with React state
  useEffect(() => {
    vpRef.current = { zoomPercent, panX: pan.x, panY: pan.y };
    isFreePanRef.current = isFreePan;
    isNotesOpenRef.current = isNotesOpen;
  }, [zoomPercent, pan, isFreePan, isNotesOpen]);

  useEffect(() => {
    updateActivePdfPage();
  }, [pan, pdfPageCount, updateActivePdfPage, zoomPercent]);

  useEffect(() => {
    const element = pageSidebarRef.current;
    if (!element) return undefined;

    const handleSidebarWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      element.scrollTop += getIsolatedWheelDelta(event, element);
    };

    element.addEventListener('wheel', handleSidebarWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleSidebarWheel);
  }, [isPdfSidebarCollapsed, pdfSidebarDocument?.fileId]);

  useEffect(() => {
    setActiveNotePage(null);
    setPdfPageCount(0);
    setActivePdfPage(1);
    setPdfSidebarDocument(null);
    setIsPdfSidebarCollapsed(true);
  }, [file.id, kind]);

  useEffect(() => {
    if (!isNotesOpen) {
      setActiveNotePage(null);
    }
  }, [isNotesOpen]);

  // Touchpad pinch-zoom: zooms at cursor in freeform mode, stays centred otherwise
  const applyZoomAt = useCallback((nextZoomPercent: number, cx: number, cy: number) => {
    const maxZoom = isNotesOpenRef.current ? NOTES_MAX_ZOOM : DOCUMENT_MAX_ZOOM;
    const bounded = Math.max(DOCUMENT_MIN_ZOOM, Math.min(maxZoom, Math.round(nextZoomPercent)));
    const { zoomPercent: curZoom, panX, panY } = vpRef.current;
    if (bounded === curZoom) return;
    const factor = bounded / curZoom;
    if (isFreePanRef.current) {
      const newPanX = clampPanX(cx + (panX - cx) * factor, bounded);
      const newPanY = clampPanY(cy + (panY - cy) * factor, bounded);
      vpRef.current = { zoomPercent: bounded, panX: newPanX, panY: newPanY };
      setZoomPercent(bounded);
      setPan({ x: newPanX, y: newPanY });
    } else if (isNotesOpenRef.current) {
      // Notes mode: keep the combined page+notes block centered horizontally.
      const root = rootRef.current;
      const scaledWidth = CONTENT_WIDTH_PX * (bounded / 100);
      const newPanX = root ? calcCentreX(root, scaledWidth) : panX;
      const newPanY = clampPanY(cy + (panY - cy) * factor, bounded);
      vpRef.current = { zoomPercent: bounded, panX: newPanX, panY: newPanY };
      setZoomPercent(bounded);
      setPan({ x: newPanX, y: newPanY });
    } else {
      const root = rootRef.current;
      const scaledWidth = CONTENT_WIDTH_PX * (bounded / 100);
      const centredX = root ? calcCentreX(root, scaledWidth) : panX;
      const newPanY = clampPanY(cy + (panY - cy) * factor, bounded);
      vpRef.current = { zoomPercent: bounded, panX: centredX, panY: newPanY };
      setZoomPercent(bounded);
      setPan({ x: centredX, y: newPanY });
    }
  }, [clampPanX, clampPanY, calcCentreX]);

  // +/- buttons and dropdown zoom steps: always centred, never free-form
  const applyZoomCentred = useCallback((nextZoomPercent: number) => {
    const maxZoom = isNotesOpenRef.current ? NOTES_MAX_ZOOM : DOCUMENT_MAX_ZOOM;
    const bounded = Math.max(DOCUMENT_MIN_ZOOM, Math.min(maxZoom, nextZoomPercent));
    const root = rootRef.current;
    const scaledWidth = CONTENT_WIDTH_PX * (bounded / 100);
    const centredX = root ? calcCentreX(root, scaledWidth) : vpRef.current.panX;
    const clampedY = clampPanY(vpRef.current.panY, bounded);
    isFreePanRef.current = false;
    vpRef.current = { zoomPercent: bounded, panX: centredX, panY: clampedY };
    setIsFreePan(false);
    setZoomPercent(bounded);
    setPan({ x: centredX, y: clampedY });
  }, [clampPanY, calcCentreX]);

  const resetZoom = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const x = calcCentreX(root, CONTENT_WIDTH_PX);
    isFreePanRef.current = false;
    vpRef.current = { zoomPercent: 100, panX: x, panY: CONTENT_INITIAL_TOP };
    setIsFreePan(false);
    setZoomPercent(100);
    setPan({ x, y: CONTENT_INITIAL_TOP });
  }, [calcCentreX]);

  const jumpToPdfPage = useCallback((pageNumber: number) => {
    if (kind !== 'pdf') return;

    const root = rootRef.current;
    const rows = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>('[data-document-page-row]') ?? [],
    );
    const targetRow = rows[pageNumber - 1];
    if (!root || !targetRow) return;

    const currentZoomPercent = vpRef.current.zoomPercent;
    const currentScale = currentZoomPercent / 100;
    const nextPanY = clampPanY(CONTENT_INITIAL_TOP - targetRow.offsetTop * currentScale, currentZoomPercent);
    const scaledWidth = CONTENT_WIDTH_PX * currentScale;
    const nextPanX = calcCentreX(root, scaledWidth);

    pdfPageJumpLockUntilRef.current = performance.now() + 350;
    isFreePanRef.current = false;
    vpRef.current = {
      zoomPercent: currentZoomPercent,
      panX: nextPanX,
      panY: nextPanY,
    };
    setIsFreePan(false);
    setPan({ x: nextPanX, y: nextPanY });
    setActivePdfPage(pageNumber);
  }, [calcCentreX, clampPanY, kind]);

  // Post-paint re-centre: fires once after initialization to correct any
  // layout that hadn't fully settled when the synchronous layoutEffect ran.
  useEffect(() => {
    if (!initialized) return;
    const raf = requestAnimationFrame(() => {
      if (isFreePanRef.current) return;
      const root = rootRef.current;
      if (!root) return;
      const scaledWidth = CONTENT_WIDTH_PX * (vpRef.current.zoomPercent / 100);
      const x = calcCentreX(root, scaledWidth);
      if (x === vpRef.current.panX) return;
      vpRef.current = { ...vpRef.current, panX: x };
      setPan((prev) => ({ ...prev, x }));
    });
    return () => cancelAnimationFrame(raf);
  }, [initialized, file.id, calcCentreX]);

  // Re-center when notes panel opens/closes
  useEffect(() => {
    if (!initialized || isFreePanRef.current) return;
    const root = rootRef.current;
    if (!root) return;
    const scaledWidth = CONTENT_WIDTH_PX * (vpRef.current.zoomPercent / 100);
    const x = calcCentreX(root, scaledWidth);
    vpRef.current = { ...vpRef.current, panX: x };
    setPan((prev) => ({ ...prev, x }));
  }, [isNotesOpen, initialized, calcCentreX]);

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
        const maxZoom = isNotesOpenRef.current ? NOTES_MAX_ZOOM : DOCUMENT_MAX_ZOOM;
        const nextZoom = Math.max(
          DOCUMENT_MIN_ZOOM,
          Math.min(maxZoom, Math.round(baseZoom * factor)),
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
      if (panRafRef.current === null) {
        panRafRef.current = requestAnimationFrame(() => {
          panRafRef.current = null;
          setPan({ x: vpRef.current.panX, y: vpRef.current.panY });
        });
      }
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      if (panRafRef.current !== null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
        setPan({ x: vpRef.current.panX, y: vpRef.current.panY });
      }
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

  const downloadNotes = useCallback(() => {
    const noteEntries: Array<[number, string]> = kind === 'pdf'
      ? Array.from({ length: pdfPageCount }, (_, index) => [index + 1, pageNotes[index + 1] ?? ''])
      : [[1, pageNotes[1] ?? '']];
    const meaningfulEntries = noteEntries.filter(([, note]) => isNoteMeaningful(note));
    if (!meaningfulEntries.length) return;

    const lines: string[] = [];
    if (kind !== 'pdf') {
      lines.push(`# ${file.label} Notes`, '');
    }

    meaningfulEntries.forEach(([page, note], index) => {
      if (kind === 'pdf') {
        lines.push(`### Page ${page}`, '');
      }
      lines.push(noteHtmlToMarkdown(note));
      if (index < meaningfulEntries.length - 1) {
        lines.push('');
      }
    });

    const blob = new Blob([`${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.label.replace(/\.[^.]+$/, '')}_notes.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [file.label, kind, pageNotes, pdfPageCount]);

  const documentContent = kind === 'pdf' ? (
    <PdfDocument
      activeNotePage={activeNotePage}
      fileId={file.id}
      isNotesOpen={isNotesOpen}
      onActivateNote={setActiveNotePage}
      onPdfReady={updatePdfSidebarDocument}
      pageNotes={pageNotes}
      onNoteChange={updatePageNote}
      onPageCount={setPdfPageCount}
    />
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
      className="relative h-full overflow-hidden bg-sidebar/95 text-sidebar-foreground"
    >
      {/* Canvas-style pan/zoom content layer */}
      <div
        className="absolute left-0 top-0 pb-24 [will-change:transform]"
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

      {kind === 'pdf' && pdfSidebarDocument?.fileId === file.id && (
        <button
          type="button"
          aria-label={isPdfSidebarCollapsed ? 'Show page sidebar' : 'Hide page sidebar'}
          aria-expanded={!isPdfSidebarCollapsed}
          onClick={() => setIsPdfSidebarCollapsed((value) => !value)}
          className="pointer-events-auto fixed z-40 flex size-9 items-center justify-center rounded-full border border-sidebar-border bg-background/88 text-foreground shadow-sm backdrop-blur-md transition-[background-color,transform] duration-[240ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-background/96 active:scale-95"
          style={{
            right: overlayInsets.right + PDF_PAGE_SIDEBAR_MARGIN,
            top: PDF_PAGE_SIDEBAR_BUTTON_TOP,
          }}
        >
          {isPdfSidebarCollapsed ? (
            <ChevronLeftIcon className="size-4" strokeWidth={2.5} />
          ) : (
            <ChevronRightIcon className="size-4" strokeWidth={2.5} />
          )}
        </button>
      )}

      {kind === 'pdf' && pdfSidebarDocument?.fileId === file.id && (
        <nav
          aria-label="PDF pages"
          className={`fixed z-30 hidden overflow-visible rounded-xl border border-sidebar-border/45 bg-background/86 shadow-[0_18px_48px_-36px_rgba(15,23,42,0.46)] backdrop-blur-md transition-transform duration-[240ms] ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform sm:flex dark:bg-slate-900/90 ${
            isPdfSidebarCollapsed
              ? 'pointer-events-none translate-x-[calc(100%+1rem)]'
              : 'pointer-events-auto translate-x-0'
          }`}
          style={{
            right: overlayInsets.right + PDF_PAGE_SIDEBAR_MARGIN,
            top: PDF_PAGE_SIDEBAR_TOP,
            bottom: 72,
            width: PDF_PAGE_SIDEBAR_WIDTH,
          }}
        >
          <div className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-sidebar-border/45 pl-3 pr-2">
              <span className="text-[0.68rem] font-semibold uppercase text-muted-foreground">
                Pages
              </span>
            </div>

            <div ref={pageSidebarRef} className="soft-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {Array.from({ length: pdfSidebarDocument.pageCount }, (_, index) => {
                const pageNumber = index + 1;
                return (
                  <PdfPageThumbnail
                    key={`${pdfSidebarDocument.fileId}-${pageNumber}`}
                    isActive={pageNumber === activePdfPage}
                    onClick={() => jumpToPdfPage(pageNumber)}
                    pageNumber={pageNumber}
                    pdf={pdfSidebarDocument.pdf}
                  />
                );
              })}
              {pdfSidebarDocument.totalPageCount > pdfSidebarDocument.pageCount ? (
                <p className="px-1 pb-2 text-center text-[0.66rem] text-muted-foreground">
                  First {pdfSidebarDocument.pageCount} of {pdfSidebarDocument.totalPageCount}
                </p>
              ) : null}
            </div>
          </div>
        </nav>
      )}

      {/* Fixed title overlay */}
      <div
        className={`pointer-events-none fixed top-0 z-40 h-16 overflow-hidden border-b border-sidebar-border/20 transition-transform duration-[240ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isHeaderCollapsed ? '-translate-y-full' : 'translate-y-0'
        }`}
        style={{ left: overlayInsets.left, right: overlayInsets.right }}
      >
        <div className="absolute inset-0 bg-sidebar/80 backdrop-blur-xl" />
        <div className="relative flex h-full items-center justify-center px-28 text-center">
          <h1 className="truncate text-[0.95rem] font-semibold tracking-tight text-sidebar-foreground/78">
            {file.label}
          </h1>
        </div>
      </div>

      {/* Collapse toggle — fixed independently so it stays reachable when header is hidden */}
      <button
        type="button"
        aria-label={isHeaderCollapsed ? 'Show title bar' : 'Hide title bar'}
        aria-expanded={!isHeaderCollapsed}
        onClick={() => setIsHeaderCollapsed((value) => !value)}
        className="pointer-events-auto fixed top-4 z-50 flex size-9 -translate-y-0 items-center justify-center rounded-2xl border border-sidebar-border bg-background/80 text-foreground shadow-sm backdrop-blur-md transition-[background-color,box-shadow] duration-200 hover:bg-background/95 active:scale-95"
        style={{ right: overlayInsets.right + 16 }}
      >
        {isHeaderCollapsed ? (
          <ChevronDownIcon className="size-4" strokeWidth={2.7} />
        ) : (
          <ChevronUpIcon className="size-4" strokeWidth={2.7} />
        )}
      </button>

      {/* Notes panel — fixed overlay for non-PDF content (PDFs use in-canvas per-page notes) */}
      {isNotesOpen && kind !== 'pdf' && (
        <div
          className="pointer-events-none fixed top-16 z-20 flex flex-col"
          style={{
            right: overlayInsets.right + NOTES_PANEL_GAP,
            bottom: 72,
            width: NOTES_PANEL_WIDTH,
          }}
        >
          <div className="pointer-events-auto flex h-full flex-col overflow-hidden rounded-2xl border border-sidebar-border/30 bg-sidebar/90 backdrop-blur-xl">
            <div className="flex items-center border-b border-sidebar-border/20 px-4 py-2.5">
              <span className="text-[0.78rem] font-semibold tracking-wide text-sidebar-foreground/50 uppercase">Notes</span>
            </div>
            {activeNotePage === 1 ? (
              <NoteEditor
                autoFocus
                ariaLabel={`${file.label} notes`}
                placeholder="Add notes for this file..."
                value={pageNotes[1] ?? ''}
                onChange={(value) => updatePageNote(1, value)}
              />
            ) : (
              <InactiveNoteEditor
                ariaLabel={`${file.label} notes`}
                placeholder="Add notes for this file..."
                value={pageNotes[1] ?? ''}
                onActivate={() => setActiveNotePage(1)}
              />
            )}
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div
        className="pointer-events-none fixed bottom-4 z-30 flex items-center justify-center gap-2"
        style={{ left: overlayInsets.left, right: overlayInsets.right }}
      >
        {/* Zoom pill */}
        <div className="pointer-events-auto flex items-center rounded-xl border border-slate-200/85 bg-white/94 p-1 shadow-[0_18px_44px_-30px_rgba(15,23,42,0.42)] backdrop-blur-md dark:border-white/[0.08] dark:bg-slate-900/95 dark:shadow-[0_18px_44px_-30px_rgba(0,0,0,0.7)]">
          <button
            type="button"
            disabled={!canZoomOut}
            onClick={() => {
              if (isNotesOpen) {
                const prev = getPreviousZoomOption(displayZoom, NOTES_DISPLAY_OPTIONS);
                const root = rootRef.current;
                applyZoomAt(prev * 2, root ? root.clientWidth / 2 : 0, root ? root.clientHeight / 2 : 0);
              } else {
                applyZoomCentred(getPreviousZoomOption(zoomPercent));
              }
            }}
            className="flex size-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:pointer-events-none disabled:text-slate-300 dark:text-slate-400 dark:hover:bg-white/8 dark:hover:text-slate-200 dark:disabled:text-slate-700"
            aria-label="Zoom out"
          >
            <MinusIcon className="size-4" />
          </button>

          <div className="relative mx-1" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen((v) => !v)}
              className="flex h-8 min-w-16 items-center justify-center rounded-lg px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/8 dark:hover:text-slate-100"
              aria-label={`Zoom level: ${displayZoom}%`}
            >
              {displayZoom}%
            </button>

            {isDropdownOpen && (
              <div className="absolute bottom-[calc(100%+6px)] left-1/2 z-10 min-w-[8.5rem] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200/85 bg-white/96 py-1 shadow-lg backdrop-blur-md dark:border-white/[0.07] dark:bg-slate-900/98">
                {(isNotesOpen ? NOTES_DISPLAY_OPTIONS : DOCUMENT_ZOOM_OPTIONS).map((option) => {
                  const actual = isNotesOpen ? option * 2 : option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                      if (isNotesOpen) {
                        const root = rootRef.current;
                        applyZoomAt(actual, root ? root.clientWidth / 2 : 0, root ? root.clientHeight / 2 : 0);
                      } else {
                        applyZoomCentred(actual);
                      }
                      setIsDropdownOpen(false);
                    }}
                      className="flex w-full items-center justify-between px-3.5 py-1.5 text-xs transition hover:bg-slate-100 dark:hover:bg-white/8"
                    >
                      <span className={zoomPercent === actual ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}>
                        {option}%
                      </span>
                      {zoomPercent === actual && <CheckIcon className="ml-4 size-3 text-slate-500 dark:text-slate-500" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={!canZoomIn}
            onClick={() => {
              if (isNotesOpen) {
                const next = getNextZoomOption(displayZoom, NOTES_DISPLAY_OPTIONS);
                const root = rootRef.current;
                applyZoomAt(next * 2, root ? root.clientWidth / 2 : 0, root ? root.clientHeight / 2 : 0);
              } else {
                applyZoomCentred(getNextZoomOption(zoomPercent));
              }
            }}
            className="flex size-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:pointer-events-none disabled:text-slate-300 dark:text-slate-400 dark:hover:bg-white/8 dark:hover:text-slate-200 dark:disabled:text-slate-700"
            aria-label="Zoom in"
          >
            <PlusIcon className="size-4" />
          </button>
        </div>

        {/* Tool pill — freeform + notes */}
        <div className="pointer-events-auto flex items-center rounded-xl border border-slate-200/85 bg-white/94 p-1 shadow-[0_18px_44px_-30px_rgba(15,23,42,0.42)] backdrop-blur-md dark:border-white/[0.08] dark:bg-slate-900/95 dark:shadow-[0_18px_44px_-30px_rgba(0,0,0,0.7)]">
          <button
            type="button"
            onClick={() => isFreePan ? resetZoom() : (setIsFreePan(true), isFreePanRef.current = true)}
            className={`flex size-8 items-center justify-center rounded-lg transition ${isFreePan ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-slate-200' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-600 dark:hover:bg-white/8 dark:hover:text-slate-400'}`}
            aria-label={isFreePan ? 'Exit freeform pan' : 'Enter freeform pan'}
          >
            <MoveIcon className="size-4" />
          </button>

          <div className="mx-1 h-4 w-px bg-slate-200/80 dark:bg-white/[0.08]" />

          <button
            type="button"
            onClick={downloadNotes}
            disabled={!hasDownloadableNotes}
            className="flex size-8 items-center justify-center rounded-lg transition text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:pointer-events-none disabled:text-slate-300 dark:text-slate-600 dark:hover:bg-white/8 dark:hover:text-slate-400 dark:disabled:text-slate-700"
            aria-label="Download notes as markdown"
          >
            <DownloadIcon className="size-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              const next = !isNotesOpen;
              isNotesOpenRef.current = next;
              setIsNotesOpen(next);
              if (next) {
                applyZoomCentred(Math.min(NOTES_MAX_ZOOM, vpRef.current.zoomPercent * 2));
              } else {
                applyZoomCentred(Math.max(DOCUMENT_MIN_ZOOM, Math.round(vpRef.current.zoomPercent / 2)));
              }
            }}
            className={`flex size-8 items-center justify-center rounded-lg transition ${isNotesOpen ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-slate-200' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-600 dark:hover:bg-white/8 dark:hover:text-slate-400'}`}
            aria-label={isNotesOpen ? 'Hide notes' : 'Show notes'}
          >
            <StickyNoteIcon className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
