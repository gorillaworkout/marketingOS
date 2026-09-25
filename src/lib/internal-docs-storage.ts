import path from 'node:path';

export const INTERNAL_DOCS_DIR = path.join('data', 'internal-docs');
export const MAX_INTERNAL_DOC_BYTES = 15 * 1024 * 1024;

const KINDS = [
  { ext: '.pdf', mimeType: 'application/pdf' },
  { ext: '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { ext: '.md', mimeType: 'text/markdown' },
  { ext: '.txt', mimeType: 'text/plain' },
] as const;

export type InternalDocKind = { ext: string; mimeType: string };

export function internalDocKind(filename: string, mimeType: string): InternalDocKind | null {
  const name = filename.trim().toLowerCase();
  const mime = mimeType.trim().toLowerCase();
  const byExt = KINDS.find(kind => name.endsWith(kind.ext));
  if (byExt) return { ext: byExt.ext, mimeType: byExt.mimeType };
  if (mime === 'text/x-markdown' || mime === 'text/md') return { ext: '.md', mimeType: 'text/markdown' };
  const byMime = KINDS.find(kind => kind.mimeType === mime);
  return byMime ? { ext: byMime.ext, mimeType: byMime.mimeType } : null;
}

export function internalDocsDirectory(): string {
  return path.join(process.cwd(), INTERNAL_DOCS_DIR);
}

export function storageKeyFor(id: string, ext: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid document id');
  if (!KINDS.some(kind => kind.ext === ext)) throw new Error('Invalid document extension');
  return `${id}${ext}`;
}

/** Resolve a stored key to an absolute path inside the private docs directory. */
export function resolveStoredInternalDoc(storageKey: string): string | null {
  if (!storageKey || storageKey !== path.basename(storageKey)) return null;
  if (storageKey.includes('..')) return null;
  const ext = path.extname(storageKey).toLowerCase();
  if (!KINDS.some(kind => kind.ext === ext)) return null;
  const root = path.resolve(internalDocsDirectory());
  const full = path.resolve(root, storageKey);
  if (full !== path.join(root, storageKey)) return null;
  return full;
}

export function titleFromFilename(filename: string): string {
  const base = (filename.split(/[/\\]/).pop() || 'Document').replace(/\.(pdf|docx|md|txt)$/i, '');
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Document').slice(0, 200);
}

export function sanitizeDocumentTitle(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 200);
}

export function safeDownloadName(originalName: string, ext: string): string {
  const base = (originalName.split(/[/\\]/).pop() || `document${ext}`)
    .replace(/["\r\n]/g, '')
    .slice(0, 180);
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`;
}
