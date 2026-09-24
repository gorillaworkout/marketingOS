import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';

/**
 * Dupoin Indonesia Instagram chrome for Social Post creatives.
 *
 * The committed plates are 1080×1350. The header is the Dupoin script
 * wordmark plus the white CNN 2025 laurel. The footer is the white
 * regulatory bar. Everywhere else on both plates is solid black.
 *
 * Black that belongs to the plate background is turned transparent at
 * composite time so it cannot cover the generated scene. Black type inside
 * the white footer is kept. The image model never paints the logo, the badge,
 * or the disclaimer.
 *
 * On any other canvas the plates scale with width and pin to the top and
 * bottom edges. The middle stays the generated scene.
 */
export const DUPOIN_SOCIAL_HEADER_PNG_PATH = path.join(process.cwd(), 'public', 'brand', 'dupoin-social-header.png');
export const DUPOIN_SOCIAL_FOOTER_PNG_PATH = path.join(process.cwd(), 'public', 'brand', 'dupoin-social-footer.png');

export const DUPOIN_IG_CHROME_WIDTH = 1080;
export const DUPOIN_IG_CHROME_HEIGHT = 1350;

/**
 * Content height of each plate after the black background is removed,
 * measured from the committed assets (inclusive of the plate's own padding).
 * Prompt clearance uses the same numbers so the model reserves the real bands.
 */
export const DUPOIN_IG_HEADER_BAND_PX = 156;
export const DUPOIN_IG_FOOTER_BAND_PX = 70;

/** Exact disclaimer on the official footer plate. Spelling "resiko" is intentional. */
export const DUPOIN_IG_FOOTER_LINE_1 =
  'PT Dupoin Futures Indonesia telah teregulasi oleh BAPPEBTI, OJK, dan BI. Dan diawasi oleh JFX, KBI, dan ASPEBTINDO.';
export const DUPOIN_IG_FOOTER_LINE_2 =
  '*Trading derivatif mengandung resiko kerugian tinggi.';

/** Channels at or below this are the plate's black field, not artwork. */
const NEAR_BLACK_MAX = 12;

/** A footer row this white is the regulatory bar, so black type on it stays. */
const WHITE_ROW_MIN = 0.45;

export interface ChromePlacement {
  headerHeight: number;
  footerHeight: number;
  scaledWidth: number;
  left: number;
}

export interface RgbaImage {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Turn the plate's black field into transparency.
 *
 * Every near-black pixel outside a white bar becomes alpha 0, including black
 * enclosed by the laurel linework. Rows that are mostly white (the regulatory
 * bar) are protected so the black Indonesian type is not punched out.
 */
export function knockOutBlackBackground(image: RgbaImage, protectWhiteBar: boolean): Buffer {
  const { width, height } = image;
  const out = Buffer.from(image.data);
  const protectedRow = new Uint8Array(height);

  if (protectWhiteBar) {
    for (let y = 0; y < height; y++) {
      let white = 0;
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        const i = row + x * 4;
        if (out[i] > 220 && out[i + 1] > 220 && out[i + 2] > 220) white += 1;
      }
      if (white / width >= WHITE_ROW_MIN) protectedRow[y] = 1;
    }
    const dilated = Uint8Array.from(protectedRow);
    for (let y = 0; y < height; y++) {
      if (!protectedRow[y]) continue;
      for (let dy = -3; dy <= 3; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < height) dilated[yy] = 1;
      }
    }
    protectedRow.set(dilated);
  }

  for (let y = 0; y < height; y++) {
    if (protectedRow[y]) continue;
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const maxChannel = out[i] > out[i + 1]
        ? (out[i] > out[i + 2] ? out[i] : out[i + 2])
        : (out[i + 1] > out[i + 2] ? out[i + 1] : out[i + 2]);
      if (maxChannel <= NEAR_BLACK_MAX) out[i + 3] = 0;
    }
  }
  return out;
}

/** Last row that still holds artwork, or -1 when the plate is empty. */
export function lastContentRow(image: RgbaImage, minPixels = 8): number {
  const { data, width, height } = image;
  for (let y = height - 1; y >= 0; y--) {
    let hits = 0;
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (data[i + 3] > 20 && Math.max(data[i], data[i + 1], data[i + 2]) > NEAR_BLACK_MAX) {
        hits += 1;
        if (hits >= minPixels) return y;
      }
    }
  }
  return -1;
}

/** First row that still holds artwork, or -1 when the plate is empty. */
export function firstContentRow(image: RgbaImage, minPixels = 8): number {
  const { data, width, height } = image;
  for (let y = 0; y < height; y++) {
    let hits = 0;
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (data[i + 3] > 20 && Math.max(data[i], data[i + 1], data[i + 2]) > NEAR_BLACK_MAX) {
        hits += 1;
        if (hits >= minPixels) return y;
      }
    }
  }
  return -1;
}

/**
 * Scale the native chrome with the canvas width and pin the bands to the
 * top and bottom. Very short canvases shrink both bands so they still fit.
 */
export function chromePlacement(
  canvasWidth: number,
  canvasHeight: number,
  bands: { headerPx: number; footerPx: number } = {
    headerPx: DUPOIN_IG_HEADER_BAND_PX,
    footerPx: DUPOIN_IG_FOOTER_BAND_PX,
  },
): ChromePlacement {
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth < 2 || canvasHeight < 2) {
    throw new Error('Cannot composite Instagram chrome: generated image has no readable dimensions.');
  }

  const headerPx = bands.headerPx;
  const footerPx = bands.footerPx;
  let scale = canvasWidth / DUPOIN_IG_CHROME_WIDTH;
  let headerHeight = Math.max(1, Math.round(headerPx * scale));
  let footerHeight = Math.max(1, Math.round(footerPx * scale));
  if (headerHeight + footerHeight > canvasHeight) {
    scale = canvasHeight / (headerPx + footerPx);
    headerHeight = Math.max(1, Math.round(headerPx * scale));
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

interface KeyedPlate {
  data: Buffer;
  width: number;
  height: number;
  contentHeight: number;
  contentTop: number;
}

let headerPlate: KeyedPlate | null = null;
let footerPlate: KeyedPlate | null = null;

async function readPlate(filePath: string, label: string): Promise<RgbaImage> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dupoin Instagram ${label} missing at ${filePath}; cannot brand the image.`);
  }
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== DUPOIN_IG_CHROME_WIDTH || info.height !== DUPOIN_IG_CHROME_HEIGHT || info.channels !== 4) {
    throw new Error(
      `Dupoin Instagram ${label} must be ${DUPOIN_IG_CHROME_WIDTH}×${DUPOIN_IG_CHROME_HEIGHT}, got ${info.width}×${info.height}.`,
    );
  }
  return { data, width: info.width, height: info.height };
}

async function keyedHeader(): Promise<KeyedPlate> {
  if (headerPlate) return headerPlate;
  const plate = await readPlate(DUPOIN_SOCIAL_HEADER_PNG_PATH, 'header');
  const data = knockOutBlackBackground(plate, false);
  const image = { data, width: plate.width, height: plate.height };
  const last = lastContentRow(image);
  if (last < 0) throw new Error('Dupoin Instagram header has no visible lockup after removing the black background.');
  headerPlate = { data, width: plate.width, height: plate.height, contentHeight: last + 1, contentTop: 0 };
  return headerPlate;
}

async function keyedFooter(): Promise<KeyedPlate> {
  if (footerPlate) return footerPlate;
  const plate = await readPlate(DUPOIN_SOCIAL_FOOTER_PNG_PATH, 'footer');
  const data = knockOutBlackBackground(plate, true);
  const image = { data, width: plate.width, height: plate.height };
  const first = firstContentRow(image);
  if (first < 0) throw new Error('Dupoin Instagram footer has no visible regulatory bar after removing the black background.');
  footerPlate = {
    data,
    width: plate.width,
    height: plate.height,
    contentHeight: plate.height - first,
    contentTop: first,
  };
  return footerPlate;
}

/** Content span of the committed plates. Tests lock the prompt bands to these. */
export async function measureOfficialChromeBands(): Promise<{ headerPx: number; footerPx: number }> {
  const [header, footer] = await Promise.all([keyedHeader(), keyedFooter()]);
  return { headerPx: header.contentHeight, footerPx: footer.contentHeight };
}

async function stripPng(plate: KeyedPlate, top: number, height: number, targetWidth: number, targetHeight: number): Promise<Buffer> {
  const crop = plate.data.subarray(top * plate.width * 4, (top + height) * plate.width * 4);
  let pipeline = sharp(crop, { raw: { width: plate.width, height, channels: 4 } });
  if (targetWidth !== plate.width || targetHeight !== height) {
    pipeline = pipeline.resize(targetWidth, targetHeight, { fit: 'fill' });
  }
  return pipeline.png().toBuffer();
}

/**
 * Stamp Bayu's header plate, then the footer plate, onto a generated image.
 *
 * Header artwork keeps its alpha so the scene shows through the black field.
 * The footer bar covers the bottom edge. The middle of the generated image
 * is left untouched. Throws on failure: a creative missing the regulatory
 * footer must surface as an error rather than pass silently.
 */
export async function compositeDupoinInstagramChrome(imageBytes: Buffer): Promise<Buffer> {
  const [header, footer] = await Promise.all([keyedHeader(), keyedFooter()]);
  const base = sharp(imageBytes);
  const baseMeta = await base.metadata();
  if (!baseMeta.width || !baseMeta.height) {
    throw new Error('Cannot composite Instagram chrome: generated image has no readable dimensions.');
  }

  const place = chromePlacement(baseMeta.width, baseMeta.height, {
    headerPx: header.contentHeight,
    footerPx: footer.contentHeight,
  });
  const headerStrip = await stripPng(header, 0, header.contentHeight, place.scaledWidth, place.headerHeight);
  const footerStrip = await stripPng(
    footer,
    footer.contentTop,
    footer.contentHeight,
    place.scaledWidth,
    place.footerHeight,
  );

  return base
    .composite([
      { input: headerStrip, left: place.left, top: 0 },
      { input: footerStrip, left: place.left, top: baseMeta.height - place.footerHeight },
    ])
    .png()
    .toBuffer();
}
