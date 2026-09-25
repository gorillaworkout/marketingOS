import path from 'node:path';
import { INTERNAL_DOC_KINDS } from './internal-docs-upload';

export const INTERNAL_DOCS_DIR = path.join('data', 'internal-docs');
export { MAX_INTERNAL_DOC_BYTES, internalDocKind } from './internal-docs-upload';
export type { InternalDocKind } from './internal-docs-upload';

export function internalDocsDirectory(): string {
  return path.join(process.cwd(), INTERNAL_DOCS_DIR);
}

export function storageKeyFor(id: string, ext: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid document id');
  if (!INTERNAL_DOC_KINDS.some(kind => kind.ext === ext)) throw new Error('Invalid document extension');
  return `${id}${ext}`;
}

/** Resolve a stored key to an absolute path inside the private docs directory. */
export function resolveStoredInternalDoc(storageKey: string): string | null {
  if (!storageKey || storageKey !== path.basename(storageKey)) return null;
  if (storageKey.includes('..')) return null;
  const ext = path.extname(storageKey).toLowerCase();
  if (!INTERNAL_DOC_KINDS.some(kind => kind.ext === ext)) return null;
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
