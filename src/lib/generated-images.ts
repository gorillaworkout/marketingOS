const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function isSafeGeneratedImageFilename(filename: string): boolean {
  if (!filename || filename !== filename.split('/').pop()) return false;
  const extension = extensionOf(filename);
  return Boolean(extension && CONTENT_TYPES[extension]);
}

export function generatedImageContentType(filename: string): string | null {
  return CONTENT_TYPES[extensionOf(filename)] || null;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

/**
 * Next free `_V<n>` for this base name: highest existing version + 1. Counting
 * files instead would reuse a live version after a gallery delete and
 * overwrite that image.
 */
export function nextSopVersion(existingFiles: readonly string[], baseName: string): number {
  let max = 0;
  const prefix = `${baseName}_V`;
  for (const file of existingFiles) {
    if (!file.startsWith(prefix)) continue;
    const match = /^(\d+)_/.exec(file.slice(prefix.length));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}
