import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { IMAGE_ASPECT_RATIOS, MIN_OUTPUT_LONG_SIDE, type ImageAspectRatio } from '@/lib/image-aspect-ratio';
import { generatedImageOriginalsDir, generatedImagesDir, isDeletableImageFilename, resolveInside } from '@/lib/generated-image-delete';

/**
 * Server-only helpers for editing a generated image.
 *
 * Every new image keeps a pre-chrome original (after the 2K upscale, before
 * the logo / footer / pill) as `<fileName>.jpg` in data/generated-image-originals
 * (outside public/). Edits send that original as the input image, so the
 * chrome is never fed back to the model. Older images only have the
 * composited PNG; that is sent instead and the prompt asks the model to
 * repaint the header and footer bands as clean background.
 *
 * TODO(later phase): mask / inpaint (edit only a painted area). Not built.
 */

export function generatedImageOriginalPath(fileName: string, cwd: string = process.cwd()): string | null {
  if (!isDeletableImageFilename(fileName)) return null;
  return resolveInside(generatedImageOriginalsDir(cwd), `${fileName}.jpg`);
}

export function hasGeneratedImageOriginal(fileName: string, cwd: string = process.cwd()): boolean {
  const file = generatedImageOriginalPath(fileName, cwd);
  return Boolean(file && fs.existsSync(file));
}

/** JPEG q92 keeps the original at ~1–2 MB instead of a second multi-MB PNG on the VPS disk. */
export async function saveGeneratedImageOriginal(fileName: string, bytes: Buffer, cwd: string = process.cwd()): Promise<void> {
  const file = generatedImageOriginalPath(fileName, cwd);
  if (!file) throw new Error('Invalid image file name.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const jpeg = await sharp(bytes).flatten({ background: '#000000' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  fs.writeFileSync(file, jpeg);
}

export interface EditSource {
  dataUrl: string;
  /** True when the pre-chrome original was used. */
  clean: boolean;
  width: number;
  height: number;
}

/** Longest side of the image sent to the edit model. */
export const EDIT_INPUT_MAX_SIDE = MIN_OUTPUT_LONG_SIDE;

export async function loadEditSource(fileName: string, cwd: string = process.cwd()): Promise<EditSource | null> {
  if (!isDeletableImageFilename(fileName)) return null;
  const original = generatedImageOriginalPath(fileName, cwd);
  const composited = resolveInside(generatedImagesDir(cwd), fileName);
  const clean = Boolean(original && fs.existsSync(original));
  const file = clean ? original : composited && fs.existsSync(composited) ? composited : null;
  if (!file) return null;
  const meta = await sharp(file).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return null;
  const input = await sharp(file)
    .resize({ width: EDIT_INPUT_MAX_SIDE, height: EDIT_INPUT_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#000000' })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { dataUrl: `data:image/jpeg;base64,${input.toString('base64')}`, clean, width, height };
}

/** The supported ratio closest to the source image, so the edit keeps its frame. */
export function nearestAspectRatio(width: number, height: number): ImageAspectRatio {
  const target = Math.log(width / height);
  let best: ImageAspectRatio = IMAGE_ASPECT_RATIOS[0];
  let bestDistance = Infinity;
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number);
    const distance = Math.abs(Math.log(w / h) - target);
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best;
}

export function buildEditPrompt(instruction: string, clean: boolean): string {
  const lines = [
    'Edit the input image. Apply only this change:',
    instruction.trim(),
    'Keep everything else the same: composition, framing, subjects, faces, text, colours and lighting. Return the whole edited image, not a crop or a collage.',
  ];
  if (!clean) {
    lines.push('The input still shows a logo header at the top and a white regulatory footer at the bottom. Repaint those areas as clean background that continues the scene, with no logo, text or white bar.');
  }
  return lines.join('\n');
}
