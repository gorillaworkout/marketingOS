/**
 * Rebuild public/brand/dupoin-ig-chrome.png from the official lockup plus
 * the regulatory footer. Runtime compositing reads the committed PNG and
 * does not call this script.
 *
 *   npx tsx scripts/build-dupoin-ig-chrome.ts
 */
import fs from 'node:fs';
import sharp from 'sharp';
import {
  DUPOIN_IG_CHROME_HEIGHT,
  DUPOIN_IG_CHROME_PNG_PATH,
  DUPOIN_IG_CHROME_WIDTH,
  DUPOIN_IG_FOOTER_BAND_PX,
  DUPOIN_IG_FOOTER_LINE_1,
  DUPOIN_IG_FOOTER_LINE_2,
  DUPOIN_IG_HEADER_BAND_PX,
  DUPOIN_IG_LOCKUP_HEIGHT,
  DUPOIN_IG_LOCKUP_LEFT,
  DUPOIN_IG_LOCKUP_PNG_PATH,
  DUPOIN_IG_LOCKUP_TOP,
} from '../src/lib/dupoin-ig-chrome';

function footerSvg(): Buffer {
  const width = DUPOIN_IG_CHROME_WIDTH;
  const height = DUPOIN_IG_FOOTER_BAND_PX;
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${width / 2}" y="34" text-anchor="middle" font-family="Inter" font-size="15.5" fill="#111111">${DUPOIN_IG_FOOTER_LINE_1}</text>
  <text x="${width / 2}" y="58" text-anchor="middle" font-family="Inter" font-size="13.5" fill="#111111">${DUPOIN_IG_FOOTER_LINE_2}</text>
</svg>`);
}

async function main() {
  if (DUPOIN_IG_LOCKUP_TOP + DUPOIN_IG_LOCKUP_HEIGHT > DUPOIN_IG_HEADER_BAND_PX) {
    throw new Error('Lockup extends below the header band.');
  }
  if (DUPOIN_IG_HEADER_BAND_PX + DUPOIN_IG_FOOTER_BAND_PX >= DUPOIN_IG_CHROME_HEIGHT) {
    throw new Error('Header and footer bands leave no transparent middle.');
  }
  if (!fs.existsSync(DUPOIN_IG_LOCKUP_PNG_PATH)) {
    throw new Error(`Missing official lockup at ${DUPOIN_IG_LOCKUP_PNG_PATH}`);
  }

  const lockup = await sharp(DUPOIN_IG_LOCKUP_PNG_PATH)
    .resize({ height: DUPOIN_IG_LOCKUP_HEIGHT })
    .png()
    .toBuffer();
  const footer = await sharp(footerSvg()).png().toBuffer();

  const chrome = await sharp({
    create: {
      width: DUPOIN_IG_CHROME_WIDTH,
      height: DUPOIN_IG_CHROME_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: lockup, left: DUPOIN_IG_LOCKUP_LEFT, top: DUPOIN_IG_LOCKUP_TOP },
      { input: footer, left: 0, top: DUPOIN_IG_CHROME_HEIGHT - DUPOIN_IG_FOOTER_BAND_PX },
    ])
    .png()
    .toBuffer();

  fs.writeFileSync(DUPOIN_IG_CHROME_PNG_PATH, chrome);
  console.log(`Wrote ${DUPOIN_IG_CHROME_PNG_PATH} (${chrome.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
