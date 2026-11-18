import sharp from 'sharp';

/**
 * Server-only helpers for Generate Image uploads.
 *
 * Visual references and assets are sent to the image model as real image
 * input (OpenRouter `input_references`, 9router `image`), never as a text
 * description, and never composited onto the output by us: the compositor
 * only adds the brand logo, footer and Swipe left pill.
 *
 * The two roles stay separate all the way to the prompt:
 * - a visual reference only guides style, pose, subject, palette and mood;
 *   the model is told not to include, collage or reproduce it;
 * - an asset is a thing that must appear, so the model redraws that item
 *   inside the scene, but never pastes the uploaded photo as an inset,
 *   thumbnail or panel.
 * The prompt says which input is which.
 */

export const MAX_REFERENCE_IMAGES = 4;
export const MAX_ASSET_IMAGES = 4;
/** Decoded bytes per uploaded image. The browser already downsizes to ≤2048 px. */
export const MAX_INPUT_IMAGE_BYTES = 8 * 1024 * 1024;
/** Longest side sent upstream. Keeps request bodies and input-token cost small. */
export const INPUT_IMAGE_MAX_SIDE = 1536;

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/;

export interface ParsedInputImage {
  mime: string;
  bytes: Buffer;
}

export type InputImageRole = 'reference' | 'asset';

export function parseImageDataUrl(value: unknown): ParsedInputImage {
  if (typeof value !== 'string') throw new Error('Each uploaded image must be a PNG, JPEG, or WebP data URL.');
  const match = DATA_URL_RE.exec(value.trim());
  if (!match) throw new Error('Each uploaded image must be a PNG, JPEG, or WebP data URL.');
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (bytes.length === 0) throw new Error('An uploaded image is empty.');
  if (bytes.length > MAX_INPUT_IMAGE_BYTES) throw new Error('Each uploaded image must be 8 MB or smaller.');
  return { mime: match[1] === 'image/jpg' ? 'image/jpeg' : match[1], bytes };
}

/** Validate the request arrays. Throws a user-facing message on bad input. */
export function readInputImageLists(body: { referenceImages?: unknown; assetImages?: unknown }): {
  references: ParsedInputImage[];
  assets: ParsedInputImage[];
} {
  const read = (value: unknown, max: number, label: string): ParsedInputImage[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error(`${label} must be a list of images.`);
    if (value.length > max) throw new Error(`Upload at most ${max} ${label.toLowerCase()}.`);
    return value.map(parseImageDataUrl);
  };
  return {
    references: read(body.referenceImages, MAX_REFERENCE_IMAGES, 'Visual references'),
    assets: read(body.assetImages, MAX_ASSET_IMAGES, 'Assets'),
  };
}

async function toDataUrl(image: ParsedInputImage): Promise<string> {
  const pipeline = sharp(image.bytes, { failOn: 'error' }).rotate();
  const meta = await pipeline.metadata();
  if (!meta.width || !meta.height) throw new Error('An uploaded image could not be read.');
  const resized = pipeline.resize(INPUT_IMAGE_MAX_SIDE, INPUT_IMAGE_MAX_SIDE, { fit: 'inside', withoutEnlargement: true });
  // Assets such as logos or cut-out products keep their transparency.
  if (meta.hasAlpha) {
    const png = await resized.png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  }
  const jpeg = await resized.jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch] as string));
}

export const SHEET_CELL_PX = 640;
export const SHEET_REFERENCE_LABEL = 'REFERENCE ONLY';
export const SHEET_ASSET_LABEL = 'ASSET';
const SHEET_LABEL_PX = 56;
const SHEET_GAP_PX = 16;

/**
 * One labelled sheet holding every upload, for gateways that forward a single
 * input image. Panels read "REFERENCE ONLY n" or "ASSET n" so the prompt can
 * point at them.
 */
export async function buildReferenceSheet(items: Array<{ role: InputImageRole; image: ParsedInputImage }>): Promise<Buffer> {
  if (items.length === 0) throw new Error('No images to place on the reference sheet.');
  const columns = Math.min(items.length, 4);
  const rows = Math.ceil(items.length / columns);
  const cellHeight = SHEET_CELL_PX + SHEET_LABEL_PX;
  const width = columns * SHEET_CELL_PX + (columns + 1) * SHEET_GAP_PX;
  const height = rows * cellHeight + (rows + 1) * SHEET_GAP_PX;
  let referenceIndex = 0;
  let assetIndex = 0;

  const layers: sharp.OverlayOptions[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const { role, image } = items[i];
    const label = role === 'reference' ? `${SHEET_REFERENCE_LABEL} ${++referenceIndex}` : `${SHEET_ASSET_LABEL} ${++assetIndex}`;
    const col = i % columns;
    const row = Math.floor(i / columns);
    const left = SHEET_GAP_PX + col * (SHEET_CELL_PX + SHEET_GAP_PX);
    const top = SHEET_GAP_PX + row * (cellHeight + SHEET_GAP_PX);
    const labelSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_CELL_PX}" height="${SHEET_LABEL_PX}">`
      + `<rect width="100%" height="100%" fill="${role === 'reference' ? '#0b3b44' : '#3b2a05'}"/>`
      + `<text x="20" y="38" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>`
      + '</svg>',
    );
    const panel = await sharp(image.bytes, { failOn: 'error' })
      .rotate()
      .resize(SHEET_CELL_PX, SHEET_CELL_PX, { fit: 'contain', background: { r: 128, g: 128, b: 128, alpha: 1 } })
      .flatten({ background: { r: 128, g: 128, b: 128 } })
      .png()
      .toBuffer();
    layers.push({ input: await sharp(labelSvg).png().toBuffer(), left, top });
    layers.push({ input: panel, left, top: top + SHEET_LABEL_PX });
  }

  return sharp({ create: { width, height, channels: 3, background: { r: 90, g: 90, b: 90 } } })
    .composite(layers)
    .png()
    .toBuffer();
}

export interface PreparedInputImages {
  /** Data URLs in the order the prompt describes them. */
  images: string[];
  /** True when every upload was merged into one labelled sheet. */
  sheet: boolean;
  referenceCount: number;
  assetCount: number;
}

/**
 * Turn uploads into the images actually sent upstream.
 * `singleInputOnly` (9router gateway) merges more than one upload into a sheet.
 */
export async function prepareModelInputImages(input: {
  references: ParsedInputImage[];
  assets: ParsedInputImage[];
  maxInputImages: number;
  singleInputOnly: boolean;
}): Promise<PreparedInputImages> {
  const items = [
    ...input.references.map(image => ({ role: 'reference' as const, image })),
    ...input.assets.map(image => ({ role: 'asset' as const, image })),
  ];
  const base = { referenceCount: input.references.length, assetCount: input.assets.length };
  if (items.length === 0) return { images: [], sheet: false, ...base };
  if (input.singleInputOnly && items.length > 1) {
    const sheet = await buildReferenceSheet(items);
    return { images: [`data:image/png;base64,${sheet.toString('base64')}`], sheet: true, ...base };
  }
  if (items.length > input.maxInputImages) {
    throw new Error(`This model accepts at most ${input.maxInputImages} input image(s). Remove some references or assets, or pick another model.`);
  }
  return { images: await Promise.all(items.map(item => toDataUrl(item.image))), sheet: false, ...base };
}

/** Reference rule: guidance only. Wording kept in one place so every provider path sends the same text. */
export const REFERENCE_ONLY_RULE =
  'reference only, do not include, collage or reproduce these images. Use them only as guidance for style, pose, subject, colour palette, lighting and mood. '
  + 'Do not paste, inset, frame, thumbnail or tile them (or any part of them) into the result, and do not copy their text, buttons, UI elements, logos or watermarks. '
  + 'Create one new, original image';

/** Asset rule: the item must appear, redrawn into the scene, never pasted as a photo. */
export const ASSET_RULE =
  'it must appear in the new image as part of the scene, recognisable (same shape, colours, face or identity, and any text printed on the item itself), redrawn with the scene\'s light, perspective and scale. '
  + 'Never paste the uploaded photo itself: no inset, thumbnail, framed photo, picture-in-picture, sticker, collage or side-by-side panel, and do not copy its background or borders';

/**
 * Instructions placed before the scene prompt so the model treats each input
 * correctly: references only steer the look, assets must appear in the result.
 */
export function referencePromptBlock(input: { referenceCount: number; assetCount: number; sheet: boolean; assetNote?: string }): string {
  const { referenceCount, assetCount, sheet } = input;
  if (referenceCount + assetCount === 0) return '';
  const lines: string[] = [];

  if (sheet) {
    lines.push('INPUT IMAGE: one sheet of labelled panels. It is input material, not a layout or a canvas to edit.');
    if (referenceCount > 0) lines.push(`Panels labelled "${SHEET_REFERENCE_LABEL}" are visual references: ${REFERENCE_ONLY_RULE}.`);
    if (assetCount > 0) lines.push(`Each panel labelled "${SHEET_ASSET_LABEL}" is a real item: ${ASSET_RULE}.`);
    lines.push('Do not reproduce the sheet itself, its grid, grey panels, borders, labels or thumbnails.');
  } else {
    const range = (from: number, count: number) => (count === 1 ? `Input image ${from} is` : `Input images ${from}–${from + count - 1} are`);
    if (referenceCount > 0) lines.push(`${range(1, referenceCount)} ${referenceCount === 1 ? 'a visual reference' : 'visual references'}: ${REFERENCE_ONLY_RULE}.`);
    if (assetCount > 0) {
      const subject = assetCount === 1 ? `${range(referenceCount + 1, 1)} an asset` : `${range(referenceCount + 1, assetCount)} assets`;
      lines.push(`${subject}: ${assetCount === 1 ? '' : 'for each one, '}${ASSET_RULE}.`);
    }
    if (referenceCount > 0 && assetCount === 0) lines.push('No input image is an asset, so none of them appears in the result.');
  }
  const note = input.assetNote?.trim();
  if (note) lines.push(`How to use the uploads: ${note.slice(0, 500)}`);
  return lines.join(' ');
}
