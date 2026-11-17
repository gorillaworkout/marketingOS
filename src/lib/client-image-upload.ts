'use client';

/** Browser-side prep for Generate Image uploads: type/size checks and a downscale. */
export const ACCEPTED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_UPLOAD_SOURCE_BYTES = 20 * 1024 * 1024;
export const UPLOAD_MAX_SIDE = 2048;

export interface PreparedUpload {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The file is not a readable image.'));
    img.src = src;
  });
}

/**
 * Validate one file and shrink it so the longest side is at most 2048 px.
 * PNG and WebP stay PNG (they may carry transparency, e.g. a logo or cut-out
 * product); JPEG stays JPEG.
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  if (!(ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    throw new Error(`${file.name}: use a PNG, JPEG, or WebP image.`);
  }
  if (file.size > MAX_UPLOAD_SOURCE_BYTES) throw new Error(`${file.name}: the file is larger than 20 MB.`);
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  let dataUrl = original;
  if (scale < 1 || file.type === 'image/webp') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot resize images.');
    ctx.drawImage(img, 0, 0, width, height);
    dataUrl = file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
  }
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, dataUrl, width, height };
}
