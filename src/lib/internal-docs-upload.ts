/**
 * Client-safe FAQ & Guides upload checks.
 * The browser and the upload route share these rules so a rejected file
 * shows the same message before and after the request.
 */

export const MAX_INTERNAL_DOC_MB = 100;

/**
 * App-enforced FAQ & Guides upload cap. The browser and the upload route
 * share it and reject larger files with the same error.
 * A reverse proxy in front of this process must allow at least this many
 * bytes or it drops the request before that check. That includes nginx
 * `client_max_body_size`. Next.js `proxyClientMaxBodySize` is set above
 * this cap in next.config.ts so a proxy does not truncate the multipart body.
 */
export const MAX_INTERNAL_DOC_BYTES = MAX_INTERNAL_DOC_MB * 1024 * 1024;

export const INTERNAL_DOC_FILE_ACCEPT =
  '.pdf,.docx,.md,.txt,application/pdf,text/plain,text/markdown,text/x-markdown';

const KINDS = [
  { ext: '.pdf', mimeType: 'application/pdf' },
  { ext: '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { ext: '.md', mimeType: 'text/markdown' },
  { ext: '.txt', mimeType: 'text/plain' },
] as const;

export const INTERNAL_DOC_KINDS = KINDS;

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

export function internalDocUploadIssue(file: { name: string; size: number; type?: string }): string | null {
  if (file.size <= 0) return 'The file is empty.';
  if (file.size > MAX_INTERNAL_DOC_BYTES) return `File is larger than ${MAX_INTERNAL_DOC_MB} MB.`;
  if (!internalDocKind(file.name, file.type || '')) return 'Unsupported file type. Use PDF, DOCX, MD, or TXT.';
  return null;
}

/** Optional title applies to a one-file upload. A batch uses each file name. */
export function titleForInternalDocUpload(fileCount: number, title: string): string {
  if (fileCount !== 1) return '';
  return title.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}
