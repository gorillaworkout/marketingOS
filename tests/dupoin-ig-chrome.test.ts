import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  chromePlacement,
  compositeDupoinInstagramChrome,
} from '../src/lib/dupoin-ig-chrome';

const isTeal = (r: number, g: number, b: number) =>
  Math.abs(r - 46) < 36 && Math.abs(g - 181) < 36 && Math.abs(b - 196) < 36 && g > r;

async function raw(input: Buffer | string) {
  return sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

test('the Instagram chrome and official lockup ship with the repo', async () => {
  assert.ok(fs.existsSync(DUPOIN_IG_CHROME_PNG_PATH), 'chrome asset must be committed, not fetched at runtime');
  assert.ok(fs.existsSync(DUPOIN_IG_LOCKUP_PNG_PATH), 'header lockup must be the official raster, not redrawn at runtime');
  assert.equal(path.basename(DUPOIN_IG_CHROME_PNG_PATH), 'dupoin-ig-chrome.png');
  assert.ok(DUPOIN_IG_CHROME_PNG_PATH.includes(path.join('public', 'brand')));

  const chrome = await sharp(DUPOIN_IG_CHROME_PNG_PATH).metadata();
  assert.equal(chrome.format, 'png');
  assert.equal(chrome.width, DUPOIN_IG_CHROME_WIDTH);
  assert.equal(chrome.height, DUPOIN_IG_CHROME_HEIGHT);
  assert.equal(chrome.hasAlpha, true);

  const lockup = await sharp(DUPOIN_IG_LOCKUP_PNG_PATH).metadata();
  assert.equal(lockup.format, 'png');
  assert.equal(lockup.hasAlpha, true);
  assert.ok((lockup.width ?? 0) > 1000 && (lockup.height ?? 0) > 150);
});

test('the regulatory footer copy is the template wording, including resiko', () => {
  assert.match(DUPOIN_IG_FOOTER_LINE_1, /BAPPEBTI, OJK, dan BI/);
  assert.match(DUPOIN_IG_FOOTER_LINE_1, /JFX, KBI, dan ASPEBTINDO/);
  assert.equal(DUPOIN_IG_FOOTER_LINE_2, '*Trading derivatif mengandung resiko kerugian tinggi.');
});

test('chrome bands are transparent in the middle, branded on top, and white on the bottom', async () => {
  const { data, info } = await raw(DUPOIN_IG_CHROME_PNG_PATH);
  assert.equal(info.width, DUPOIN_IG_CHROME_WIDTH);
  assert.equal(info.height, DUPOIN_IG_CHROME_HEIGHT);
  assert.equal(info.channels, 4);

  let headerTeal = 0;
  let headerWhite = 0;
  let middleOpaque = 0;
  let footerWhite = 0;
  let footerDark = 0;
  let footerMinX = info.width;
  let footerMaxX = 0;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (y < DUPOIN_IG_HEADER_BAND_PX) {
        if (a > 200 && isTeal(r, g, b)) headerTeal += 1;
        if (a > 200 && r > 240 && g > 240 && b > 240) headerWhite += 1;
      } else if (y < info.height - DUPOIN_IG_FOOTER_BAND_PX) {
        if (a > 8) middleOpaque += 1;
      } else {
        if (a > 200 && r > 245 && g > 245 && b > 245) footerWhite += 1;
        if (a > 200 && (r + g + b) / 3 < 80) {
          footerDark += 1;
          if (x < footerMinX) footerMinX = x;
          if (x > footerMaxX) footerMaxX = x;
        }
      }
    }
  }

  assert.ok(headerTeal > 2_000, 'header must carry the teal Dupoin wordmark');
  assert.ok(headerWhite > 1_000, 'header must carry the white CNN badge, not a redrawn dark mark');
  assert.equal(middleOpaque, 0, 'the middle of the chrome must be transparent so the scene shows through');
  const footerPixels = info.width * DUPOIN_IG_FOOTER_BAND_PX;
  assert.ok(footerWhite > footerPixels * 0.9, `footer must be an opaque white band, white pixels were ${footerWhite}/${footerPixels}`);
  assert.ok(footerDark > 500, 'footer must contain the regulatory type');
  const leftMargin = footerMinX;
  const rightMargin = info.width - 1 - footerMaxX;
  assert.ok(Math.abs(leftMargin - rightMargin) <= 4, `footer type must be centered, margins ${leftMargin} vs ${rightMargin}`);
  assert.ok(leftMargin > 40, 'footer type must not collide with the frame edge');
});

test('header pixels are the official lockup, placed in the top-left band', async () => {
  const resized = await sharp(DUPOIN_IG_LOCKUP_PNG_PATH).resize({ height: DUPOIN_IG_LOCKUP_HEIGHT }).png().toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  assert.ok(resizedMeta.width && resizedMeta.height);
  assert.ok(DUPOIN_IG_LOCKUP_TOP + resizedMeta.height <= DUPOIN_IG_HEADER_BAND_PX);

  const fromChrome = await sharp(DUPOIN_IG_CHROME_PNG_PATH)
    .extract({
      left: DUPOIN_IG_LOCKUP_LEFT,
      top: DUPOIN_IG_LOCKUP_TOP,
      width: resizedMeta.width,
      height: resizedMeta.height,
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const fromLockup = await sharp(resized).ensureAlpha().raw().toBuffer();
  assert.equal(fromChrome.length, fromLockup.length);

  let compared = 0;
  let mismatched = 0;
  for (let i = 0; i < fromLockup.length; i += 4) {
    if (fromLockup[i + 3] < 16 && fromChrome[i + 3] < 16) continue;
    compared += 1;
    const drift = Math.abs(fromLockup[i] - fromChrome[i])
      + Math.abs(fromLockup[i + 1] - fromChrome[i + 1])
      + Math.abs(fromLockup[i + 2] - fromChrome[i + 2])
      + Math.abs(fromLockup[i + 3] - fromChrome[i + 3]);
    if (drift > 8) mismatched += 1;
  }
  assert.ok(compared > 5_000, 'lockup must contain opaque pixels to compare');
  assert.ok(mismatched / compared < 0.01, `chrome header drifted from the official lockup (${mismatched}/${compared})`);
});

test('compositing pins chrome to the edges and leaves the middle scene alone', async () => {
  const width = 1080;
  const height = 1350;
  const canvas = await sharp({
    create: { width, height, channels: 4, background: { r: 180, g: 20, b: 20, alpha: 1 } },
  }).png().toBuffer();

  const stamped = await compositeDupoinInstagramChrome(canvas);
  const meta = await sharp(stamped).metadata();
  assert.equal(meta.width, width, 'compositing must not resize the generated image');
  assert.equal(meta.height, height);

  const { data, info } = await raw(stamped);
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  const center = at(540, 675);
  assert.deepEqual(center.slice(0, 3), [180, 20, 20], 'middle scene must show through the transparent chrome');

  const lowerRight = at(1000, 1200);
  assert.deepEqual(lowerRight.slice(0, 3), [180, 20, 20], 'social chrome must not stamp a lower-right wordmark');

  let topTeal = 0;
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 700; x++) {
      const [r, g, b] = at(x, y);
      if (isTeal(r, g, b)) topTeal += 1;
    }
  }
  assert.ok(topTeal > 500, 'top-left must carry the composited wordmark');

  const bottom = at(10, height - 4);
  assert.ok(bottom[0] > 245 && bottom[1] > 245 && bottom[2] > 245, 'bottom edge must be the white footer');

  const place = chromePlacement(width, height);
  const justAboveFooter = at(540, height - place.footerHeight - 8);
  assert.deepEqual(justAboveFooter.slice(0, 3), [180, 20, 20], 'scene just above the footer must remain');
});

test('compositing scales the same chrome onto a square feed canvas', async () => {
  const width = 1024;
  const height = 1024;
  const canvas = await sharp({
    create: { width, height, channels: 4, background: { r: 8, g: 16, b: 32, alpha: 1 } },
  }).png().toBuffer();
  const stamped = await compositeDupoinInstagramChrome(canvas);
  const meta = await sharp(stamped).metadata();
  assert.equal(meta.width, width, 'square dropdown size is preserved');
  assert.equal(meta.height, height);

  const { data, info } = await raw(stamped);
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const place = chromePlacement(width, height);
  assert.ok(place.headerHeight + place.footerHeight < height);
  assert.deepEqual(at(Math.round(width / 2), Math.round(height / 2)), [8, 16, 32], 'square middle stays the generated scene');
  const bottom = at(12, height - 3);
  assert.ok(bottom[0] > 245 && bottom[1] > 245 && bottom[2] > 245, 'square canvas still gets the white footer');
  let topTeal = 0;
  for (let y = 0; y < place.headerHeight; y += 2) {
    for (let x = 0; x < 700; x += 2) {
      const [r, g, b] = at(x, y);
      if (isTeal(r, g, b)) topTeal += 1;
    }
  }
  assert.ok(topTeal > 150, 'square canvas still gets the upper-left lockup');
});

test('compositing scales the same chrome onto a landscape canvas', async () => {
  const width = 1536;
  const height = 1024;
  const canvas = await sharp({
    create: { width, height, channels: 4, background: { r: 12, g: 80, b: 40, alpha: 1 } },
  }).png().toBuffer();
  const stamped = await compositeDupoinInstagramChrome(canvas);
  const meta = await sharp(stamped).metadata();
  assert.equal(meta.width, width);
  assert.equal(meta.height, height);

  const { data, info } = await raw(stamped);
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const place = chromePlacement(width, height);
  assert.ok(place.headerHeight + place.footerHeight < height);
  assert.deepEqual(at(width / 2, Math.round(height / 2)), [12, 80, 40]);
  const bottom = at(8, height - 2);
  assert.ok(bottom[0] > 245 && bottom[1] > 245 && bottom[2] > 245);

  let topTeal = 0;
  for (let y = 0; y < place.headerHeight; y += 2) {
    for (let x = 0; x < Math.min(900, width); x += 2) {
      const [r, g, b] = at(x, y);
      if (isTeal(r, g, b)) topTeal += 1;
    }
  }
  assert.ok(topTeal > 200, 'landscape canvas still receives the header lockup');
});

test('compositing fails loudly rather than silently returning an unbranded image', async () => {
  await assert.rejects(
    () => compositeDupoinInstagramChrome(Buffer.from('not an image')),
    /composite|chrome|input/i,
  );
});
