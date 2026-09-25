import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import {
  DUPOIN_IG_CHROME_HEIGHT,
  DUPOIN_IG_CHROME_WIDTH,
  DUPOIN_IG_SWIPE_BUTTON_HEIGHT,
  DUPOIN_IG_SWIPE_BUTTON_WIDTH,
  chromePlacement,
  swipeButtonPlacement,
} from '@/lib/dupoin-ig-chrome-layout';

export {
  DUPOIN_IG_CHROME_HEIGHT,
  DUPOIN_IG_CHROME_WIDTH,
  DUPOIN_IG_FOOTER_BAND_PX,
  DUPOIN_IG_HEADER_BAND_PX,
  DUPOIN_IG_LOCKUP_HEIGHT,
  DUPOIN_IG_LOCKUP_LEFT,
  DUPOIN_IG_LOCKUP_TOP,
  DUPOIN_IG_LOCKUP_WIDTH,
  DUPOIN_IG_SWIPE_BUTTON_HEIGHT,
  DUPOIN_IG_SWIPE_BUTTON_WIDTH,
  DUPOIN_IG_SWIPE_GAP_ABOVE_FOOTER_PX,
  DUPOIN_IG_SWIPE_PROMPT_PADDING_PX,
  chromeClearancePercents,
  chromePlacement,
  swipeButtonPlacement,
  swipePromptClearancePercent,
  type ChromePlacement,
  type SwipeButtonPlacement,
} from '@/lib/dupoin-ig-chrome-layout';

/**
 * Server-only Dupoin Indonesia Instagram chrome for Social Post creatives.
 *
 * Do not import this module from Client Components or from
 * dupoin-image-prompt.ts. It loads sharp, fs, and the plate files.
 * Band sizes and prompt clearance live in dupoin-ig-chrome-layout.ts.
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
 * When includeSwipeLeft is set, the fixed "Swipe left →" pill is stamped
 * after the footer, centered, with its bottom edge above the white bar.
 * The pill plate is already transparent outside the capsule, so its black
 * fill is kept (unlike the header and footer fields).
 *
 * On any other canvas the plates scale with width and pin to the top and
 * bottom edges. The middle stays the generated scene.
 */
export const DUPOIN_SOCIAL_HEADER_PNG_PATH = path.join(process.cwd(), 'public', 'brand', 'dupoin-social-header.png');
export const DUPOIN_SOCIAL_FOOTER_PNG_PATH = path.join(process.cwd(), 'public', 'brand', 'dupoin-social-footer.png');
export const DUPOIN_SOCIAL_SWIPE_LEFT_PNG_PATH = path.join(process.cwd(), 'public', 'brand', 'dupoin-social-swipe-left.png');

/** Exact disclaimer on the official footer plate. Spelling "resiko" is intentional. */
export const DUPOIN_IG_FOOTER_LINE_1 =
  'PT Dupoin Futures Indonesia telah teregulasi oleh BAPPEBTI, OJK, dan BI. Dan diawasi oleh JFX, KBI, dan ASPEBTINDO.';
export const DUPOIN_IG_FOOTER_LINE_2 =
  '*Trading derivatif mengandung resiko kerugian tinggi.';

/** Channels at or below this are the plate's black field, not artwork. */
const NEAR_BLACK_MAX = 12;

/** A footer row this white is the regulatory bar, so black type on it stays. */
const WHITE_ROW_MIN = 0.45;

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

interface KeyedPlate {
  data: Buffer;
  width: number;
  height: number;
  contentHeight: number;
  contentTop: number;
}

let headerPlate: KeyedPlate | null = null;
let footerPlate: KeyedPlate | null = null;
let swipeButtonPng: { png: Buffer; width: number; height: number } | null = null;

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

async function loadSwipeButton(): Promise<{ png: Buffer; width: number; height: number }> {
  if (swipeButtonPng) return swipeButtonPng;
  if (!fs.existsSync(DUPOIN_SOCIAL_SWIPE_LEFT_PNG_PATH)) {
    throw new Error(`Dupoin Instagram swipe button missing at ${DUPOIN_SOCIAL_SWIPE_LEFT_PNG_PATH}; cannot brand the image.`);
  }
  const png = fs.readFileSync(DUPOIN_SOCIAL_SWIPE_LEFT_PNG_PATH);
  const meta = await sharp(png).metadata();
  if (meta.width !== DUPOIN_IG_SWIPE_BUTTON_WIDTH || meta.height !== DUPOIN_IG_SWIPE_BUTTON_HEIGHT) {
    throw new Error(
      `Dupoin Instagram swipe button must be ${DUPOIN_IG_SWIPE_BUTTON_WIDTH}×${DUPOIN_IG_SWIPE_BUTTON_HEIGHT}, got ${meta.width}×${meta.height}.`,
    );
  }
  swipeButtonPng = { png, width: meta.width, height: meta.height };
  return swipeButtonPng;
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

export interface InstagramChromeOptions {
  /** Stamp the fixed "Swipe left →" pill above the footer. Default off. */
  includeSwipeLeft?: boolean;
}

/**
 * Stamp Bayu's header plate, then the footer plate, onto a generated image.
 *
 * Header artwork keeps its alpha so the scene shows through the black field.
 * The footer bar covers the bottom edge. The middle of the generated image
 * is left untouched. Throws on failure: a creative missing the regulatory
 * footer must surface as an error rather than pass silently.
 *
 * With includeSwipeLeft, the pill plate is added last, centered, above the footer.
 */
export async function compositeDupoinInstagramChrome(
  imageBytes: Buffer,
  options?: InstagramChromeOptions,
): Promise<Buffer> {
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

  const layers: { input: Buffer; left: number; top: number }[] = [
    { input: headerStrip, left: place.left, top: 0 },
    { input: footerStrip, left: place.left, top: baseMeta.height - place.footerHeight },
  ];

  if (options?.includeSwipeLeft) {
    const button = await loadSwipeButton();
    const swipe = swipeButtonPlacement(baseMeta.width, baseMeta.height, place.footerHeight, place.headerHeight);
    const input = swipe.width === button.width && swipe.height === button.height
      ? button.png
      : await sharp(button.png).resize(swipe.width, swipe.height, { fit: 'fill' }).png().toBuffer();
    layers.push({ input, left: swipe.left, top: swipe.top });
  }

  return base.composite(layers).png().toBuffer();
}
