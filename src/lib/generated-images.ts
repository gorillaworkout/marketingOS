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
