import sharp from 'sharp';
import { MIN_OUTPUT_LONG_SIDE } from '@/lib/image-aspect-ratio';

/**
 * Server-only. Bring a generated image up to the 2K floor before the Dupoin
 * chrome is composited, so the logo, footer and Swipe pill are drawn once at
 * the final canvas size instead of being stretched with the scene.
 */
export interface UpscaleResult {
  bytes: Buffer;
  width: number;
  height: number;
  /** "WxH" of the model output when it was enlarged, else null. */
  upscaledFrom: string | null;
}

/** Target size that keeps the aspect ratio and makes the long side exactly `minLongSide`. */
export function upscaleTarget(width: number, height: number, minLongSide: number = MIN_OUTPUT_LONG_SIDE): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const long = Math.max(width, height);
  if (long >= minLongSide) return null;
  const scale = minLongSide / long;
  return width >= height
    ? { width: minLongSide, height: Math.max(1, Math.round(height * scale)) }
    : { width: Math.max(1, Math.round(width * scale)), height: minLongSide };
}

export async function ensureMinLongSide(input: Buffer, minLongSide: number = MIN_OUTPUT_LONG_SIDE): Promise<UpscaleResult> {
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error('Image API returned an image without dimensions.');
  const target = upscaleTarget(width, height, minLongSide);
  if (!target) return { bytes: input, width, height, upscaledFrom: null };
  const bytes = await sharp(input)
    .resize(target.width, target.height, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .png()
    .toBuffer();
  return { bytes, width: target.width, height: target.height, upscaledFrom: `${width}x${height}` };
}
