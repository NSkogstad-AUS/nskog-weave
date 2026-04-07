import type { WorkspaceFile } from '@/data/sidebarNavigation';
import type { FilePageContentItem } from '@/types/filePage';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface PreviewDocument {
  id: string;
  label: string;
  description: string;
  textContent: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

const MAX_IMPORTED_FILE_TEXT_BYTES = 512 * 1024;
const MAX_IMPORTED_FILE_TEXT_CHARACTERS = 120_000;
const MAX_IMPORTED_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMPORTED_PDF_PAGES = 40;

const TEXT_FILE_EXTENSIONS = new Set([
  'bash',
  'c',
  'cc',
  'conf',
  'config',
  'cpp',
  'css',
  'csv',
  'env',
  'gitignore',
  'go',
  'graphql',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsx',
  'log',
  'md',
  'mjs',
  'ndjson',
  'pdf.txt',
  'php',
  'proto',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svg',
  'ts',
  'tsx',
  'txt',
  'toml',
  'tsv',
  'xml',
  'yaml',
  'yml',
  'zsh',
]);

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export function getUploadedFileTypeLabel(file: File) {
  if (file.type.trim().length > 0) {
    const subtype = file.type.split('/').at(-1) ?? file.type;
    return subtype.replace(/[-+]/g, ' ').toUpperCase();
  }

  const extension = file.name.includes('.') ? file.name.split('.').at(-1) ?? '' : '';
  return extension ? extension.toUpperCase() : 'FILE';
}

export function formatUploadedFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (sizeBytes >= 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }

  return `${Math.max(1, sizeBytes)} B`;
}

export function inferUploadedFileKind(fileName: string): WorkspaceFile['kind'] {
  const lowerName = fileName.trim().toLowerCase();

  if (lowerName.endsWith('.canvas') || lowerName.endsWith('.fig') || lowerName.endsWith('.sketch')) {
    return 'canvas';
  }

  if (
    lowerName.endsWith('.outline') ||
    lowerName.endsWith('.opml') ||
    lowerName.endsWith('.csv') ||
    lowerName.endsWith('.tsv')
  ) {
    return 'outline';
  }

  if (
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.rtf') ||
    lowerName.endsWith('.doc') ||
    lowerName.endsWith('.docx')
  ) {
    return 'memo';
  }

  return 'brief';
}

function isTextLikeFile(file: File) {
  if (file.type.startsWith('text/')) {
    return true;
  }

  if (
    file.type === 'application/json' ||
    file.type === 'application/ld+json' ||
    file.type === 'application/x-ndjson' ||
    file.type === 'application/yaml' ||
    file.type === 'application/x-yaml' ||
    file.type === 'application/xml' ||
    file.type === 'application/x-sh' ||
    file.type === 'application/sql' ||
    file.type === 'application/x-httpd-php' ||
    file.type === 'text/csv' ||
    file.type === 'text/tab-separated-values' ||
    file.type === 'image/svg+xml'
  ) {
    return true;
  }

  const extension = file.name.includes('.') ? file.name.split('.').at(-1)?.toLowerCase() ?? '' : '';
  return TEXT_FILE_EXTENSIONS.has(extension);
}

function isPdfFile(file: File) {
  if (file.type === 'application/pdf') {
    return true;
  }

  return file.name.trim().toLowerCase().endsWith('.pdf');
}

function truncateTextContent(text: string) {
  if (text.length <= MAX_IMPORTED_FILE_TEXT_CHARACTERS) {
    return text;
  }

  return `${text.slice(0, MAX_IMPORTED_FILE_TEXT_CHARACTERS)}\n\n[truncated for local preview]`;
}

async function extractPdfText(file: File) {
  if (file.size > MAX_IMPORTED_PDF_BYTES) {
    return {
      textContent: null,
      extractionState: 'PDF preview unavailable over 20 MB',
    } as const;
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdfDocument = await getDocument({
    data: new Uint8Array(arrayBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;
  const pageCount = Math.min(pdfDocument.numPages, MAX_IMPORTED_PDF_PAGES);
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .flatMap((item) => {
        const textItem = item as { str?: unknown };
        return typeof textItem.str === 'string' ? [textItem.str] : [];
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (pageText.length > 0) {
      pageTexts.push(pageText);
    }
  }

  await pdfDocument.destroy();

  const normalizedText = truncateTextContent(pageTexts.join('\n\n'));

  return {
    textContent: normalizedText.length > 0 ? normalizedText : null,
    extractionState:
      normalizedText.length > 0
        ? pdfDocument.numPages > MAX_IMPORTED_PDF_PAGES
          ? `Text extracted from first ${MAX_IMPORTED_PDF_PAGES} pages`
          : 'Text extracted'
        : 'No readable text found',
  } as const;
}

export function buildContentSnippet(text: string | null | undefined, fallbackDescription = '') {
  const normalizedText = text?.trim() ?? '';

  if (normalizedText.length > 0) {
    return normalizedText.slice(0, 220).replace(/\s+/g, ' ');
  }

  return fallbackDescription.trim();
}

export async function buildUploadedWorkspaceFile(file: File, index: number): Promise<WorkspaceFile> {
  let contentText: string | null = null;
  let extractionState = 'Binary preview unavailable';

  if (isPdfFile(file)) {
    const pdfExtraction = await extractPdfText(file);
    contentText = pdfExtraction.textContent;
    extractionState = pdfExtraction.extractionState;
  } else if (isTextLikeFile(file)) {
    if (file.size <= MAX_IMPORTED_FILE_TEXT_BYTES) {
      contentText = truncateTextContent(await file.text());
      extractionState = contentText ? 'Text extracted' : 'No readable text found';
    } else {
      extractionState = 'Preview unavailable over 512 KB';
    }
  }

  const descriptionTokens = [
    'Imported upload',
    getUploadedFileTypeLabel(file),
    formatUploadedFileSize(file.size),
    extractionState,
  ];

  return {
    id: `uploaded-file-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    label: file.name,
    description: descriptionTokens.join(' · '),
    kind: inferUploadedFileKind(file.name),
    contentText,
    mimeType: file.type || null,
    sizeBytes: file.size,
  };
}

export function workspaceFileToContentItem(
  file: WorkspaceFile,
  itemId: string = file.id,
): FilePageContentItem {
  return {
    id: itemId,
    kind: 'file',
    label: file.label,
    description: file.description,
    textContent: file.contentText ?? null,
    mimeType: file.mimeType ?? null,
    sizeBytes: file.sizeBytes ?? null,
  };
}

export function workspaceFileToPreviewDocument(file: WorkspaceFile): PreviewDocument {
  return {
    id: file.id,
    label: file.label,
    description: file.description,
    textContent: file.contentText ?? null,
    mimeType: file.mimeType ?? null,
    sizeBytes: file.sizeBytes ?? null,
  };
}

export function contentItemToPreviewDocument(item: FilePageContentItem): PreviewDocument {
  return {
    id: item.id,
    label: item.label,
    description: item.description ?? '',
    textContent: item.textContent ?? null,
    mimeType: item.mimeType ?? null,
    sizeBytes: item.sizeBytes ?? null,
  };
}
