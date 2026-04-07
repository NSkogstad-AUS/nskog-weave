export interface DownloadableFile {
  label: string;
  description?: string | null;
  contentText?: string | null;
  mimeType?: string | null;
}

const TEXTUAL_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/javascript',
  'application/typescript',
  'application/sql',
  'image/svg+xml',
]);

const TEXTUAL_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'ndjson',
  'csv',
  'tsv',
  'xml',
  'yaml',
  'yml',
  'toml',
  'html',
  'svg',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'rb',
  'rs',
  'sql',
  'sh',
  'zsh',
  'env',
  'ini',
  'conf',
  'config',
  'log',
]);

function sanitizeFilename(value: string, fallback = 'download') {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '');

  return normalized.length > 0 ? normalized : fallback;
}

function getFileExtension(value: string) {
  const filename = value.split('/').at(-1) ?? value;
  const lastDotIndex = filename.lastIndexOf('.');

  if (lastDotIndex <= 0 || lastDotIndex === filename.length - 1) {
    return '';
  }

  return filename.slice(lastDotIndex + 1).toLowerCase();
}

function isTextualMimeType(mimeType: string | null | undefined) {
  if (!mimeType) {
    return false;
  }

  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return normalized.startsWith('text/') || TEXTUAL_MIME_TYPES.has(normalized);
}

function isTextualFilename(filename: string) {
  const extension = getFileExtension(filename);
  return extension.length > 0 && TEXTUAL_EXTENSIONS.has(extension);
}

function ensureTextFilename(filename: string) {
  const sanitized = sanitizeFilename(filename);
  return isTextualFilename(sanitized) ? sanitized : `${sanitized}.txt`;
}

function triggerBlobDownload(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], {
    type: mimeType,
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1_000);
}

export function downloadFile(file: DownloadableFile) {
  const filename = sanitizeFilename(file.label, 'download');
  const contentText = typeof file.contentText === 'string' ? file.contentText : '';
  const description = typeof file.description === 'string' ? file.description.trim() : '';
  const useTextExport = !isTextualMimeType(file.mimeType) && !isTextualFilename(filename);

  if (useTextExport) {
    const fallbackContent =
      contentText.trim().length > 0
        ? contentText
        : [
            '# File Export',
            '',
            `Original file: ${filename}`,
            description ? `Description: ${description}` : '',
            '',
            'No original binary bytes are stored in the workspace export.',
          ]
            .filter(Boolean)
            .join('\n');

    triggerBlobDownload(ensureTextFilename(filename), 'text/plain;charset=utf-8', fallbackContent);
    return;
  }

  const resolvedMimeType =
    isTextualMimeType(file.mimeType) && file.mimeType
      ? file.mimeType
      : 'text/plain;charset=utf-8';
  triggerBlobDownload(
    getFileExtension(filename).length > 0 ? filename : `${filename}.txt`,
    resolvedMimeType,
    contentText,
  );
}

export function downloadFiles(files: DownloadableFile[]) {
  files.forEach((file, index) => {
    window.setTimeout(() => {
      downloadFile(file);
    }, index * 120);
  });
}
