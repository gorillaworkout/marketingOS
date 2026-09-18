import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';

/**
 * Official Dupoin wordmark, committed to the repo.
 *
 * Extracted from the brand CDN (static.dupoin.co.id/std/logo/brand-light.svg)
 * and cropped to the wordmark alone — the CDN lockup also carries an
 * award badge ("MOST TRUSTED BROKER / CNN 2025") plus laurels and a divider
 * that must NOT appear on generated creatives.
 *
 * Every opaque pixel is Dupoin Blue #2EB5C4; the background is transparent.
 */
export const DUPOIN_LOGO_PNG_PATH = path.join(process.cwd(), 'public', 'brand', 'dupoin-logo.png');

/** Safe zone from the SOP: no critical type or logo within 80px of the edge. */
export const SAFE_ZONE_PX = 80;

/** Logo width as a share of the canvas's smaller side. Keeps it a mark, not a banner. */
const LOGO_SCALE = 0.18;

export interface LogoPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Lower-right placement that respects the 80px safe zone and preserves the
 * source aspect ratio. Scaling off the smaller side stops the mark dominating
 * wide canvases.
 */
export function logoPlacement(
  canvasWidth: number,
  canvasHeight: number,
  logoWidth: number,
  logoHeight: number,
): LogoPlacement {
  const width = Math.round(Math.min(canvasWidth, canvasHeight) * LOGO_SCALE);
  const height = Math.round((width * logoHeight) / logoWidth);
  return {
    width,
    height,
    left: Math.max(SAFE_ZONE_PX, canvasWidth - SAFE_ZONE_PX - width),
    top: Math.max(SAFE_ZONE_PX, canvasHeight - SAFE_ZONE_PX - height),
  };
}

/**
 * Stamp the real wordmark onto a generated image.
 *
 * Text-to-image models cannot reproduce a specific script logotype from a text
 * description — they invent one. Compositing the actual asset is the only way
 * the logo is pixel-accurate.
 *
 * Throws on failure: an unbranded creative must surface as an error rather than
 * pass silently as if it were correct.
 */
export async function compositeDupoinLogo(imageBytes: Buffer): Promise<Buffer> {
  if (!fs.existsSync(DUPOIN_LOGO_PNG_PATH)) {
    throw new Error(`Dupoin logo asset missing at ${DUPOIN_LOGO_PNG_PATH}; cannot brand the image.`);
  }

  const base = sharp(imageBytes);
  const baseMeta = await base.metadata();
  if (!baseMeta.width || !baseMeta.height) {
    throw new Error('Cannot composite logo: generated image has no readable dimensions.');
  }

  const logoMeta = await sharp(DUPOIN_LOGO_PNG_PATH).metadata();
  if (!logoMeta.width || !logoMeta.height) {
    throw new Error('Cannot composite logo: logo asset has no readable dimensions.');
  }

  const placement = logoPlacement(baseMeta.width, baseMeta.height, logoMeta.width, logoMeta.height);
  const resizedLogo = await sharp(DUPOIN_LOGO_PNG_PATH)
    .resize(placement.width, placement.height, { fit: 'fill' })
    .png()
    .toBuffer();

  return base
    .composite([{ input: resizedLogo, left: placement.left, top: placement.top }])
    .png()
    .toBuffer();
}
