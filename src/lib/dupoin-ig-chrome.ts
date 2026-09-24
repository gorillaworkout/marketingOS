import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';

/**
 * Dupoin Indonesia Instagram chrome for Social Post creatives.
 *
 * The header lockup (Dupoin script wordmark, divider, and the white
 * "MOST TRUSTED BROKER / CNN 2025" laurel) is the official CDN raster
 * committed at public/brand/dupoin-ig-lockup.png — the same brand-dark
 * lockup the wordmark-only stamp was cropped from. It is not redrawn.
 *
 * The white regulatory footer is typeset once into
 * public/brand/dupoin-ig-chrome.png and composited as pixels. The image
 * model never paints the logo, the badge, or the disclaimer.
 *
 * Native frame is the 1080×1350 Instagram portrait Bayu supplied. On any
 * other canvas the header and footer scale with width and pin to the
 * top and bottom edges; the middle stays the generated scene.
 */
export const DUPOIN_IG_CHROME_PNG_PATH = path.join(process.cwd(), 'public', 'brand', 'dupoin-ig-chrome.png');
export const DUPOIN_IG_LOCKUP_PNG_PATH = path.join(process.cwd(), 'public', 'brand', 'dupoin-ig-lockup.png');

export const DUPOIN_IG_CHROME_WIDTH = 1080;
export const DUPOIN_IG_CHROME_HEIGHT = 1350;

/** Placement of the official lockup inside the 1080×1350 chrome. */
export const DUPOIN_IG_LOCKUP_LEFT = 64;
export const DUPOIN_IG_LOCKUP_TOP = 48;
export const DUPOIN_IG_LOCKUP_HEIGHT = 108;

/**
 * Rows from the top of the native chrome that belong to the header.
 * The lockup sits inside this band; the rest of the band is transparent
 * so the generated background shows through around the mark.
 */
export const DUPOIN_IG_HEADER_BAND_PX = 172;

/** Opaque white regulatory footer, pinned to the bottom of the native chrome. */
export const DUPOIN_IG_FOOTER_BAND_PX = 80;

/** Exact disclaimer on Bayu's template. Spelling "resiko" is intentional. */
export const DUPOIN_IG_FOOTER_LINE_1 =
  'PT Dupoin Futures Indonesia telah teregulasi oleh BAPPEBTI, OJK, dan BI. Dan diawasi oleh JFX, KBI, dan ASPEBTINDO.';
export const DUPOIN_IG_FOOTER_LINE_2 =
  '*Trading derivatif mengandung resiko kerugian tinggi.';

export interface ChromePlacement {
  headerHeight: number;
  footerHeight: number;
  scaledWidth: number;
  left: number;
}

/**
 * Scale the native chrome with the canvas width and pin the bands to the
 * top and bottom. Very short canvases shrink both bands so they still fit.
 */
export function chromePlacement(canvasWidth: number, canvasHeight: number): ChromePlacement {
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth < 2 || canvasHeight < 2) {
    throw new Error('Cannot composite Instagram chrome: generated image has no readable dimensions.');
  }

  let scale = canvasWidth / DUPOIN_IG_CHROME_WIDTH;
  let headerHeight = Math.max(1, Math.round(DUPOIN_IG_HEADER_BAND_PX * scale));
  let footerHeight = Math.max(1, Math.round(DUPOIN_IG_FOOTER_BAND_PX * scale));
  if (headerHeight + footerHeight > canvasHeight) {
    scale = canvasHeight / (DUPOIN_IG_HEADER_BAND_PX + DUPOIN_IG_FOOTER_BAND_PX);
    headerHeight = Math.max(1, Math.round(DUPOIN_IG_HEADER_BAND_PX * scale));
    footerHeight = Math.max(1, canvasHeight - headerHeight);
  }

  let scaledWidth = Math.max(1, Math.round(DUPOIN_IG_CHROME_WIDTH * scale));
  if (scaledWidth > canvasWidth) scaledWidth = canvasWidth;
  const left = Math.max(0, Math.round((canvasWidth - scaledWidth) / 2));
  return { headerHeight, footerHeight, scaledWidth, left };
}

/** Clearance the image prompt must reserve, as a percentage of the canvas height. */
export function chromeClearancePercents(canvasWidth: number, canvasHeight: number): {
  headerPercent: number;
  footerPercent: number;
} {
  const place = chromePlacement(canvasWidth, canvasHeight);
  return {
    headerPercent: Math.ceil((place.headerHeight / canvasHeight) * 100),
    footerPercent: Math.ceil((place.footerHeight / canvasHeight) * 100),
  };
}

/**
 * Stamp the real Instagram chrome onto a generated image.
 *
 * Header lockup pixels keep their alpha so the scene shows through.
 * The footer is opaque white and covers the bottom band. The middle
 * of the generated image is left untouched.
 *
 * Throws on failure: a creative missing the regulatory footer must
 * surface as an error rather than pass silently.
 */
export async function compositeDupoinInstagramChrome(imageBytes: Buffer): Promise<Buffer> {
  if (!fs.existsSync(DUPOIN_IG_CHROME_PNG_PATH)) {
    throw new Error(`Dupoin Instagram chrome missing at ${DUPOIN_IG_CHROME_PNG_PATH}; cannot brand the image.`);
  }

  const base = sharp(imageBytes);
  const baseMeta = await base.metadata();
  if (!baseMeta.width || !baseMeta.height) {
    throw new Error('Cannot composite Instagram chrome: generated image has no readable dimensions.');
  }

  const place = chromePlacement(baseMeta.width, baseMeta.height);
  const headerStrip = await sharp(DUPOIN_IG_CHROME_PNG_PATH)
    .extract({ left: 0, top: 0, width: DUPOIN_IG_CHROME_WIDTH, height: DUPOIN_IG_HEADER_BAND_PX })
    .resize(place.scaledWidth, place.headerHeight, { fit: 'fill' })
    .png()
    .toBuffer();
  const footerStrip = await sharp(DUPOIN_IG_CHROME_PNG_PATH)
    .extract({
      left: 0,
      top: DUPOIN_IG_CHROME_HEIGHT - DUPOIN_IG_FOOTER_BAND_PX,
      width: DUPOIN_IG_CHROME_WIDTH,
      height: DUPOIN_IG_FOOTER_BAND_PX,
    })
    .resize(place.scaledWidth, place.footerHeight, { fit: 'fill' })
    .png()
    .toBuffer();

  // Full-bleed white so a height-constrained scale still covers the footer edge to edge.
  const footerPlate = await sharp({
    create: {
      width: baseMeta.width,
      height: place.footerHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  }).png().toBuffer();

  return base
    .composite([
      { input: headerStrip, left: place.left, top: 0 },
      { input: footerPlate, left: 0, top: baseMeta.height - place.footerHeight },
      { input: footerStrip, left: place.left, top: baseMeta.height - place.footerHeight },
    ])
    .png()
    .toBuffer();
}
