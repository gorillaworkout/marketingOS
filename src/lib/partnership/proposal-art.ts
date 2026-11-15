/**
 * Background art and brand assets for proposal exports (server only).
 * Backgrounds are soft light-blue blurs on a warm off-white, like the approved
 * Tadakado deck, rendered once per variant with sharp and cached.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export type BackgroundVariant = 'cover' | 'divider' | 'content';

export const PALETTE = {
  paper: '#FDFAF5',
  ink: '#1D1D1F',
  body: '#3A3A3C',
  muted: '#6B6B70',
  steel: '#4A8DB7',
  header: '#5596BC',
  teal: '#2EB5C4',
  tealDark: '#1F8F9C',
  tealSoft: '#E5F6F8',
  tealCell: '#F3FBFC',
  line: '#BFE3EA',
  blob: '#8CD2EA',
  docBlack: '#000000',
  tableHead: '#EFEFEF',
  tableLine: '#D9D9D9',
} as const;

const BLOBS: Record<BackgroundVariant, Array<[number, number, number, number]>> = {
  // [cx, cy, r, opacity] on a 1920x1080 canvas
  cover: [[1180, 120, 340, 1], [-40, 1060, 270, 0.75], [1900, 1000, 130, 0.35]],
  divider: [[560, 30, 310, 0.9], [1760, 600, 240, 0.95], [1500, 1080, 130, 0.4]],
  content: [[1930, -20, 270, 0.95], [-60, 1100, 210, 0.6]],
};

function backgroundSvg(variant: BackgroundVariant): string {
  const blobs = BLOBS[variant].map(([cx, cy, r, opacity], index) => `
    <radialGradient id="g${index}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${PALETTE.blob}" stop-opacity="${opacity}"/>
      <stop offset="60%" stop-color="${PALETTE.blob}" stop-opacity="${opacity * 0.55}"/>
      <stop offset="100%" stop-color="${PALETTE.blob}" stop-opacity="0"/>
    </radialGradient>
    <circle cx="${cx}" cy="${cy}" r="${r * 1.6}" fill="url(#g${index})" filter="url(#blur)"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs><filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter></defs>
    <rect width="1920" height="1080" fill="${PALETTE.paper}"/>${blobs}
  </svg>`;
}

const cache = new Map<string, Promise<Buffer>>();

export function slideBackground(variant: BackgroundVariant): Promise<Buffer> {
  const key = `bg:${variant}`;
  if (!cache.has(key)) cache.set(key, sharp(Buffer.from(backgroundSvg(variant))).jpeg({ quality: 88 }).toBuffer());
  return cache.get(key)!;
}

const assetPath = (...parts: string[]) => path.join(/*turbopackIgnore: true*/ process.cwd(), ...parts);

export function dupoinLogo(): Promise<Buffer> {
  if (!cache.has('logo')) cache.set('logo', readFile(assetPath('public', 'brand', 'dupoin-logo.png')));
  return cache.get('logo')!;
}

export const FONT_FILES = {
  light: 'FiraSans-Light.ttf',
  regular: 'FiraSans-Regular.ttf',
  semibold: 'FiraSans-SemiBold.ttf',
  bold: 'FiraSans-Bold.ttf',
} as const;
export type FontWeight = keyof typeof FONT_FILES;

export function fontPath(weight: FontWeight): string {
  return assetPath('assets', 'fonts', FONT_FILES[weight]);
}

/** Decodes a stored data URL logo to a PNG/JPEG buffer, or null. */
export function decodeDataUrl(dataUrl: string | null): Buffer | null {
  const match = dataUrl?.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  return match ? Buffer.from(match[2], 'base64') : null;
}

/** Pixel size of a PNG/JPEG for aspect-fit. */
export async function imageSize(buffer: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width || 1, height: meta.height || 1 };
}

/** Leaf centers and rotations (degrees, clockwise) for a laurel wreath around (cx, cy). */
export function laurelLeaves(cx: number, cy: number, r: number, perSide = 7): Array<{ x: number; y: number; rotate: number }> {
  const leaves: Array<{ x: number; y: number; rotate: number }> = [];
  for (let i = 0; i < perSide; i += 1) {
    const theta = 120 + (i * 115) / (perSide - 1);
    for (const angle of [theta, 180 - theta]) {
      const radians = (angle * Math.PI) / 180;
      leaves.push({ x: cx + r * Math.cos(radians), y: cy + r * Math.sin(radians), rotate: ((angle % 180) + 180) % 180 });
    }
  }
  return leaves;
}

/** Points of a five-pointed star. */
export function starPoints(cx: number, cy: number, r: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}
