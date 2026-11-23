// src/lib/dpm-invitation/image.ts
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MIN_SHORT_SIDE = 600;
const MAX_INPUT_SIDE = 8000;
const OUTPUT_MAX_SIDE = 2400;
const PIXEL_LIMIT = 50_000_000;
const IMAGE_KEY = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export class ImageInputError extends Error {}

function imageDir(): string {
  return process.env.DPM_INVITATION_IMAGE_DIR || path.join(process.cwd(), 'data', 'dpm-invitations');
}

export function isSafeImageKey(key: string): boolean {
  return IMAGE_KEY.test(key);
}

/** Checks the real content, auto-rotates, strips metadata, resizes and re-encodes to WebP. */
export async function processInvitationImage(bytes: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  if (bytes.length === 0) throw new ImageInputError('Could not read this image.');
  if (bytes.length > IMAGE_MAX_BYTES) throw new ImageInputError('Image must be 8 MB or smaller.');
  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: PIXEL_LIMIT }).metadata();
  } catch {
    throw new ImageInputError('Could not read this image.');
  }
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new ImageInputError('Use a JPG, PNG or WebP image.');
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (Math.min(width, height) < MIN_SHORT_SIDE) throw new ImageInputError('Image is too small (minimum 600 px on the short side).');
  if (Math.max(width, height) > MAX_INPUT_SIDE) throw new ImageInputError('Image is too large (maximum 8000 px on each side).');
  try {
    // sharp drops EXIF, ICC and XMP unless withMetadata()/withExif() is called, so nothing leaks to the public page.
    const { data, info } = await sharp(bytes, { limitInputPixels: PIXEL_LIMIT })
      .rotate()
      .resize({ width: OUTPUT_MAX_SIDE, height: OUTPUT_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ImageInputError('Could not read this image.');
  }
}

export async function saveInvitationImage(bytes: Buffer): Promise<{ key: string; mime: 'image/webp'; width: number; height: number }> {
  const processed = await processInvitationImage(bytes);
  const key = `${randomUUID()}.webp`;
  await mkdir(imageDir(), { recursive: true });
  await writeFile(path.join(imageDir(), key), processed.data);
  return { key, mime: 'image/webp', width: processed.width, height: processed.height };
}

export async function readInvitationImage(key: string): Promise<Buffer | null> {
  if (!isSafeImageKey(key)) return null;
  try {
    return await readFile(path.join(imageDir(), key));
  } catch {
    return null;
  }
}

export async function removeInvitationImage(key: string): Promise<void> {
  if (!isSafeImageKey(key)) return;
  try {
    await unlink(path.join(imageDir(), key));
  } catch (error) {
    console.error('DPM invitation image remove failed', (error as NodeJS.ErrnoException).code ?? 'unknown');
  }
}
