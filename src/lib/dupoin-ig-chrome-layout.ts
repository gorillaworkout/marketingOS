/**
 * Pure placement math for Dupoin Instagram header and footer bands.
 *
 * Safe to import from Client Components. Pixel compositing with sharp and
 * the plate files stays in dupoin-ig-chrome.ts, which must not be imported
 * from the browser bundle.
 */

export const DUPOIN_IG_CHROME_WIDTH = 1080;
export const DUPOIN_IG_CHROME_HEIGHT = 1350;

/**
 * Lockup box on Bayu's 1080×1350 sizing reference.
 * The composited mark must stay inside this box: more inset than a
 * full-width stamp, and not taller than the reference.
 */
export const DUPOIN_IG_LOCKUP_LEFT = 80;
export const DUPOIN_IG_LOCKUP_TOP = 64;
export const DUPOIN_IG_LOCKUP_WIDTH = 435;
export const DUPOIN_IG_LOCKUP_HEIGHT = 72;

/**
 * Content height of each plate after the black background is removed.
 * Header band is the sizing-reference top inset plus the lockup height.
 * Prompt clearance uses the same numbers.
 */
export const DUPOIN_IG_HEADER_BAND_PX = DUPOIN_IG_LOCKUP_TOP + DUPOIN_IG_LOCKUP_HEIGHT;
export const DUPOIN_IG_FOOTER_BAND_PX = 64;

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

/**
 * Bayu's "Swipe left →" pill on the 1080×1350 template.
 * The plate is public/brand/dupoin-social-swipe-left.png: a tight crop of the
 * ghost capsule (transparent fill, thin white border, white label) with
 * transparency outside it as well.
 * Compositing centers it and sits its bottom edge this many template pixels
 * above the white regulatory footer. The prompt reserves a little more so type
 * does not collide with the pill.
 */
export const DUPOIN_IG_SWIPE_BUTTON_WIDTH = 194;
export const DUPOIN_IG_SWIPE_BUTTON_HEIGHT = 56;
export const DUPOIN_IG_SWIPE_GAP_ABOVE_FOOTER_PX = 28;
export const DUPOIN_IG_SWIPE_PROMPT_PADDING_PX = 20;

export interface SwipeButtonPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  gapAboveFooter: number;
}

/**
 * Scale the pill with canvas width, center it, and pin it above the footer band.
 * Short canvases shrink the pill so it still fits between the header and footer.
 */
export function swipeButtonPlacement(
  canvasWidth: number,
  canvasHeight: number,
  footerHeight: number,
  headerHeight = 0,
): SwipeButtonPlacement {
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth < 2 || canvasHeight < 2) {
    throw new Error('Cannot place the Swipe left button: generated image has no readable dimensions.');
  }
  if (!Number.isFinite(footerHeight) || footerHeight < 1) {
    throw new Error('Cannot place the Swipe left button: footer band is missing.');
  }

  let scale = canvasWidth / DUPOIN_IG_CHROME_WIDTH;
  let width = Math.max(1, Math.round(DUPOIN_IG_SWIPE_BUTTON_WIDTH * scale));
  let height = Math.max(1, Math.round(DUPOIN_IG_SWIPE_BUTTON_HEIGHT * scale));
  let gapAboveFooter = Math.max(0, Math.round(DUPOIN_IG_SWIPE_GAP_ABOVE_FOOTER_PX * scale));

  const maxHeight = canvasHeight - footerHeight - Math.max(0, headerHeight) - gapAboveFooter - 8;
  if (height > maxHeight && maxHeight > 0) {
    const shrink = maxHeight / height;
    width = Math.max(1, Math.round(width * shrink));
    height = Math.max(1, Math.round(maxHeight));
    gapAboveFooter = Math.max(0, Math.round(gapAboveFooter * shrink));
  }
  if (width > canvasWidth) {
    const shrink = canvasWidth / width;
    width = canvasWidth;
    height = Math.max(1, Math.round(height * shrink));
  }

  const left = Math.max(0, Math.round((canvasWidth - width) / 2));
  const footerTop = canvasHeight - footerHeight;
  let top = footerTop - gapAboveFooter - height;
  if (top < 0) {
    gapAboveFooter = Math.min(gapAboveFooter, Math.max(0, footerTop - 1));
    height = Math.max(1, Math.min(height, footerTop - gapAboveFooter));
    top = Math.max(0, footerTop - gapAboveFooter - height);
  }
  return { left, top, width, height, gapAboveFooter };
}

/** Extra prompt clearance above the footer for the composited pill, as a percent of canvas height. */
export function swipePromptClearancePercent(canvasWidth: number, canvasHeight: number): number {
  const place = chromePlacement(canvasWidth, canvasHeight);
  const swipe = swipeButtonPlacement(canvasWidth, canvasHeight, place.footerHeight, place.headerHeight);
  const scale = canvasWidth / DUPOIN_IG_CHROME_WIDTH;
  const padding = Math.max(0, Math.round(DUPOIN_IG_SWIPE_PROMPT_PADDING_PX * scale));
  const extraPx = swipe.height + swipe.gapAboveFooter + padding;
  return Math.max(1, Math.ceil((extraPx / canvasHeight) * 100));
}
