/**
 * Multi-file selection helpers for the Onboarding Reports upload dropzone.
 * The Uploads UI used to keep only files[0], so dropping a summary + user_approved
 * pair silently discarded the second file. These helpers enforce the shared limits
 * and are unit-tested without the DOM.
 */

/** Matches server MAX_UPLOAD_BYTES in service.ts (kept local so this module stays client-safe). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_MULTI_UPLOAD_FILES = 10;

export type IncomingFileLike = {
  name: string;
  size: number;
};

export type RejectedUploadFile = {
  name: string;
  reason: string;
};

export type SelectUploadFilesResult<T extends IncomingFileLike> = {
  /** Files that stay in the queue after applying the limits. */
  accepted: T[];
  rejected: RejectedUploadFile[];
  /** True when the caller tried to exceed the max file count. */
  hitFileCap: boolean;
};

/**
 * Merge newly picked/dropped files into the current queue.
 * - Keeps existing entries first.
 * - Skips exact name+size duplicates already in the queue.
 * - Rejects files larger than maxBytes.
 * - Caps the queue at maxFiles (extras are rejected, earlier ones win).
 */
export function selectUploadFiles<T extends IncomingFileLike>(
  existing: readonly T[],
  incoming: readonly T[],
  options: { maxFiles?: number; maxBytes?: number } = {},
): SelectUploadFilesResult<T> {
  const maxFiles = options.maxFiles ?? MAX_MULTI_UPLOAD_FILES;
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
  const accepted: T[] = [...existing];
  const rejected: RejectedUploadFile[] = [];
  let hitFileCap = false;

  const seen = new Set(existing.map(file => `${file.name}::${file.size}`));

  for (const file of incoming) {
    const key = `${file.name}::${file.size}`;
    if (seen.has(key)) {
      rejected.push({ name: file.name, reason: 'Already in the queue' });
      continue;
    }
    if (file.size > maxBytes) {
      rejected.push({ name: file.name, reason: `Larger than ${Math.round(maxBytes / (1024 * 1024))} MB` });
      continue;
    }
    if (accepted.length >= maxFiles) {
      hitFileCap = true;
      rejected.push({ name: file.name, reason: `Limit is ${maxFiles} files per batch` });
      continue;
    }
    seen.add(key);
    accepted.push(file);
  }

  return { accepted, rejected, hitFileCap };
}

/** Items that passed preview and can be committed. */
export function validItemsForImport<T extends { ok: boolean; error?: string | null }>(
  items: readonly T[],
): T[] {
  return items.filter(item => item.ok && !item.error);
}
