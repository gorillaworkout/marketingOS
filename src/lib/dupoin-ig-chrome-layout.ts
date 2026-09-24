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
