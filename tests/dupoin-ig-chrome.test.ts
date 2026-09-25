import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  DUPOIN_IG_CHROME_HEIGHT,
  DUPOIN_IG_CHROME_WIDTH,
  DUPOIN_IG_FOOTER_BAND_PX,
  DUPOIN_IG_FOOTER_LINE_1,
  DUPOIN_IG_FOOTER_LINE_2,
  DUPOIN_IG_HEADER_BAND_PX,
  DUPOIN_IG_LOCKUP_HEIGHT,
  DUPOIN_IG_LOCKUP_LEFT,
  DUPOIN_IG_LOCKUP_TOP,
  DUPOIN_IG_LOCKUP_WIDTH,
  DUPOIN_IG_SWIPE_BUTTON_HEIGHT,
  DUPOIN_IG_SWIPE_BUTTON_WIDTH,
  DUPOIN_IG_SWIPE_GAP_ABOVE_FOOTER_PX,
  DUPOIN_SOCIAL_FOOTER_PNG_PATH,
  DUPOIN_SOCIAL_HEADER_PNG_PATH,
  DUPOIN_SOCIAL_SWIPE_LEFT_PNG_PATH,
  chromePlacement,
  compositeDupoinInstagramChrome,
  swipeButtonPlacement,
  firstContentRow,
  knockOutBlackBackground,
  lastContentRow,
  measureOfficialChromeBands,
  type RgbaImage,
} from '../src/lib/dupoin-ig-chrome';

const isTeal = (r: number, g: number, b: number) =>
  Math.abs(r - 46) < 40 && Math.abs(g - 181) < 50 && Math.abs(b - 196) < 50 && g > r + 40 && b > r + 40;

async function raw(input: Buffer | string) {
  return sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function solid(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { data, width, height };
}

function setPixel(image: RgbaImage, x: number, y: number, rgba: [number, number, number, number]) {
  const i = (y * image.width + x) * 4;
  image.data[i] = rgba[0];
  image.data[i + 1] = rgba[1];
  image.data[i + 2] = rgba[2];
  image.data[i + 3] = rgba[3];
}

test('black plate background becomes transparent and footer type does not', () => {
  const headerSrc = solid(24, 20, [0, 0, 0, 255]);
  for (let x = 3; x < 11; x++) setPixel(headerSrc, x, 2, [46, 181, 196, 255]);
  const header = knockOutBlackBackground(headerSrc, false);
  const headerImage = { data: header, width: 24, height: 20 };
  assert.equal(header[(2 * 24 + 3) * 4 + 3], 255, 'teal lockup pixel stays');
  assert.equal(header[(10 * 24 + 12) * 4 + 3], 0, 'header black field is transparent');
  assert.equal(lastContentRow(headerImage), 2);

  const footerSrc = solid(24, 20, [0, 0, 0, 255]);
  for (let y = 15; y < 20; y++) {
    for (let x = 0; x < 24; x++) setPixel(footerSrc, x, y, [255, 255, 255, 255]);
  }
  setPixel(footerSrc, 8, 17, [10, 10, 10, 255]);
  const footer = knockOutBlackBackground(footerSrc, true);
  const footerImage = { data: footer, width: 24, height: 20 };
  assert.equal(footer[(10 * 24 + 4) * 4 + 3], 0, 'footer black field above the bar is transparent');
  assert.equal(footer[(17 * 24 + 8) * 4 + 3], 255, 'black regulatory type on the white bar stays');
  assert.equal(footer[(17 * 24 + 8) * 4], 10);
  assert.equal(footer[(18 * 24 + 1) * 4], 255, 'white bar stays white');
  assert.equal(firstContentRow(footerImage), 15);
});

test('official header and footer plates ship with the repo', async () => {
  assert.ok(fs.existsSync(DUPOIN_SOCIAL_HEADER_PNG_PATH), 'header plate must be committed, not fetched at runtime');
  assert.ok(fs.existsSync(DUPOIN_SOCIAL_FOOTER_PNG_PATH), 'footer plate must be committed, not fetched at runtime');
  assert.equal(path.basename(DUPOIN_SOCIAL_HEADER_PNG_PATH), 'dupoin-social-header.png');
  assert.equal(path.basename(DUPOIN_SOCIAL_FOOTER_PNG_PATH), 'dupoin-social-footer.png');
  assert.ok(DUPOIN_SOCIAL_HEADER_PNG_PATH.includes(path.join('public', 'brand')));

  for (const filePath of [DUPOIN_SOCIAL_HEADER_PNG_PATH, DUPOIN_SOCIAL_FOOTER_PNG_PATH]) {
    const meta = await sharp(filePath).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.width, DUPOIN_IG_CHROME_WIDTH);
    assert.equal(meta.height, DUPOIN_IG_CHROME_HEIGHT);
  }
});

test('the regulatory footer copy is the template wording, including resiko', () => {
  assert.match(DUPOIN_IG_FOOTER_LINE_1, /BAPPEBTI, OJK, dan BI/);
  assert.match(DUPOIN_IG_FOOTER_LINE_1, /JFX, KBI, dan ASPEBTINDO/);
  assert.equal(DUPOIN_IG_FOOTER_LINE_2, '*Trading derivatif mengandung resiko kerugian tinggi.');
});

test('source plates are black-backed, and knockout clears the field without erasing the artwork', async () => {
  const headerRaw = await raw(DUPOIN_SOCIAL_HEADER_PNG_PATH);
  const footerRaw = await raw(DUPOIN_SOCIAL_FOOTER_PNG_PATH);
  const countNearBlack = (data: Buffer) => {
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.max(data[i], data[i + 1], data[i + 2]) <= 12) n += 1;
    }
    return n;
  };
  const pixels = DUPOIN_IG_CHROME_WIDTH * DUPOIN_IG_CHROME_HEIGHT;
  assert.ok(countNearBlack(headerRaw.data) > pixels * 0.9, 'header plate background is solid black');
  assert.ok(countNearBlack(footerRaw.data) > pixels * 0.9, 'footer plate background is solid black');

  const headerKeyed = knockOutBlackBackground(
    { data: headerRaw.data, width: headerRaw.info.width, height: headerRaw.info.height },
    false,
  );
  const footerKeyed = knockOutBlackBackground(
    { data: footerRaw.data, width: footerRaw.info.width, height: footerRaw.info.height },
    true,
  );

  let headerTeal = 0;
  let headerWhite = 0;
  let headerMiddleOpaque = 0;
  const midY0 = 400;
  const midY1 = 1000;
  for (let y = 0; y < headerRaw.info.height; y++) {
    for (let x = 0; x < headerRaw.info.width; x++) {
      const i = (y * headerRaw.info.width + x) * 4;
      const r = headerKeyed[i];
      const g = headerKeyed[i + 1];
      const b = headerKeyed[i + 2];
      const a = headerKeyed[i + 3];
      if (a > 200 && isTeal(r, g, b)) headerTeal += 1;
      if (a > 200 && r > 230 && g > 230 && b > 230) headerWhite += 1;
      if (y >= midY0 && y < midY1 && a > 8) headerMiddleOpaque += 1;
    }
  }
  assert.ok(headerTeal > 1500, 'header keeps the teal Dupoin wordmark');
  assert.ok(headerWhite > 800, 'header keeps the white CNN laurel');
  assert.equal(headerMiddleOpaque, 0, 'header black field must not survive into the middle of the plate');

  let footerWhite = 0;
  let footerDark = 0;
  let footerMiddleOpaque = 0;
  let footerMinX = footerRaw.info.width;
  let footerMaxX = 0;
  for (let y = 0; y < footerRaw.info.height; y++) {
    for (let x = 0; x < footerRaw.info.width; x++) {
      const i = (y * footerRaw.info.width + x) * 4;
      const r = footerKeyed[i];
      const g = footerKeyed[i + 1];
      const b = footerKeyed[i + 2];
      const a = footerKeyed[i + 3];
      if (y >= midY0 && y < midY1 && a > 8) footerMiddleOpaque += 1;
      if (a > 200 && r > 245 && g > 245 && b > 245) footerWhite += 1;
      if (a > 200 && (r + g + b) / 3 < 80) {
        footerDark += 1;
        if (x < footerMinX) footerMinX = x;
        if (x > footerMaxX) footerMaxX = x;
      }
    }
  }
  assert.equal(footerMiddleOpaque, 0, 'footer black field must not cover the middle');
  assert.ok(footerWhite > DUPOIN_IG_CHROME_WIDTH * 40, 'footer keeps an opaque white regulatory bar');
  assert.ok(footerDark > 400, 'footer keeps the black regulatory type');
  const leftMargin = footerMinX;
  const rightMargin = footerRaw.info.width - 1 - footerMaxX;
  assert.ok(Math.abs(leftMargin - rightMargin) <= 8, `footer type must be centered, margins ${leftMargin} vs ${rightMargin}`);
});

test('the header lockup stays inside the sizing-reference box', async () => {
  const headerRaw = await raw(DUPOIN_SOCIAL_HEADER_PNG_PATH);
  const keyed = knockOutBlackBackground(
    { data: headerRaw.data, width: headerRaw.info.width, height: headerRaw.info.height },
    false,
  );
  let minX = headerRaw.info.width;
  let minY = headerRaw.info.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < headerRaw.info.height; y++) {
    for (let x = 0; x < headerRaw.info.width; x++) {
      const i = (y * headerRaw.info.width + x) * 4;
      if (keyed[i + 3] <= 20) continue;
      if (Math.max(keyed[i], keyed[i + 1], keyed[i + 2]) <= 12) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  assert.equal(minX, DUPOIN_IG_LOCKUP_LEFT);
  assert.equal(minY, DUPOIN_IG_LOCKUP_TOP);
  assert.equal(width, DUPOIN_IG_LOCKUP_WIDTH);
  assert.equal(height, DUPOIN_IG_LOCKUP_HEIGHT);
  assert.ok(width < 520, 'lockup must stay smaller than the previous oversized stamp');
  assert.ok(minX >= 72 && minY >= 56, 'lockup needs the reference top and left inset');
});

test('prompt bands match the artwork left after black knockout', async () => {
  const measured = await measureOfficialChromeBands();
  assert.equal(measured.headerPx, DUPOIN_IG_HEADER_BAND_PX, `header band constant should be ${measured.headerPx}`);
  assert.equal(measured.footerPx, DUPOIN_IG_FOOTER_BAND_PX, `footer band constant should be ${measured.footerPx}`);
  assert.ok(measured.headerPx < 400);
  assert.ok(measured.footerPx < 160);
  assert.ok(measured.headerPx + measured.footerPx < DUPOIN_IG_CHROME_HEIGHT / 2);
});

test('compositing uses the plate pixels and leaves the middle scene alone', async () => {
  const width = DUPOIN_IG_CHROME_WIDTH;
  const height = DUPOIN_IG_CHROME_HEIGHT;
  const canvas = await sharp({
    create: { width, height, channels: 4, background: { r: 180, g: 20, b: 20, alpha: 1 } },
  }).png().toBuffer();

  const stamped = await compositeDupoinInstagramChrome(canvas);
  const meta = await sharp(stamped).metadata();
  assert.equal(meta.width, width, 'compositing must not resize the generated image');
  assert.equal(meta.height, height);

  const headerRaw = await raw(DUPOIN_SOCIAL_HEADER_PNG_PATH);
  const keyed = knockOutBlackBackground(
    { data: headerRaw.data, width, height },
    false,
  );
  let sample: { x: number; y: number; rgba: number[] } | null = null;
  for (let y = 0; y < 220 && !sample; y++) {
    for (let x = 0; x < 800; x++) {
      const i = (y * width + x) * 4;
      if (keyed[i + 3] > 240 && isTeal(keyed[i], keyed[i + 1], keyed[i + 2])) {
        sample = { x, y, rgba: [keyed[i], keyed[i + 1], keyed[i + 2], keyed[i + 3]] };
        break;
      }
    }
  }
  assert.ok(sample, 'expected a teal lockup pixel to compare');

  const { data, info } = await raw(stamped);
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  assert.deepEqual(at(sample.x, sample.y), sample.rgba, 'header plate pixel must be copied, not redrawn');

  const center = at(540, 675);
  assert.deepEqual(center.slice(0, 3), [180, 20, 20], 'middle scene must show through the transparent black field');

  const lowerRight = at(1000, 1200);
  assert.deepEqual(lowerRight.slice(0, 3), [180, 20, 20], 'social chrome must not stamp a lower-right wordmark');

  const bottom = at(10, height - 4);
  assert.ok(bottom[0] > 245 && bottom[1] > 245 && bottom[2] > 245, 'bottom edge must be the official white footer');

  const place = chromePlacement(width, height);
  const justAboveFooter = at(540, height - place.footerHeight - 8);
  assert.deepEqual(justAboveFooter.slice(0, 3), [180, 20, 20], 'scene just above the footer must remain');
});

test('compositing scales the same plates onto a square feed canvas', async () => {
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
  assert.deepEqual(at(Math.round(width / 2), Math.round(height / 2)), [8, 16, 32], 'square middle stays the generated scene, not the plate black');
  const bottom = at(12, height - 3);
  assert.ok(bottom[0] > 245 && bottom[1] > 245 && bottom[2] > 245, 'square canvas still gets the white footer');
  let topTeal = 0;
  for (let y = 0; y < place.headerHeight; y += 2) {
    for (let x = 0; x < 700; x += 2) {
      const [r, g, b] = at(x, y);
      if (isTeal(r, g, b)) topTeal += 1;
    }
  }
  assert.ok(topTeal > 80, 'square canvas still gets the upper-left lockup');
});

test('compositing scales the same plates onto a landscape canvas', async () => {
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
  assert.deepEqual(at(Math.round(width / 2), Math.round(height / 2)), [12, 80, 40]);
  const bottom = at(8, height - 2);
  assert.ok(bottom[0] > 245 && bottom[1] > 245 && bottom[2] > 245);

  let topTeal = 0;
  for (let y = 0; y < place.headerHeight; y += 2) {
    for (let x = 0; x < Math.min(1100, width); x += 2) {
      const [r, g, b] = at(x, y);
      if (isTeal(r, g, b)) topTeal += 1;
    }
  }
  assert.ok(topTeal > 100, 'landscape canvas still receives the header lockup');
});

test('compositing fails loudly rather than silently returning an unbranded image', async () => {
  await assert.rejects(
    () => compositeDupoinInstagramChrome(Buffer.from('not an image')),
    /composite|chrome|input|header|footer/i,
  );
});

test('the swipe-left plate is a tight transparent capsule at the template size', async () => {
  assert.ok(fs.existsSync(DUPOIN_SOCIAL_SWIPE_LEFT_PNG_PATH));
  assert.equal(path.basename(DUPOIN_SOCIAL_SWIPE_LEFT_PNG_PATH), 'dupoin-social-swipe-left.png');
  assert.ok(DUPOIN_SOCIAL_SWIPE_LEFT_PNG_PATH.includes(path.join('public', 'brand')));
  const plate = await raw(DUPOIN_SOCIAL_SWIPE_LEFT_PNG_PATH);
  assert.equal(plate.info.width, DUPOIN_IG_SWIPE_BUTTON_WIDTH);
  assert.equal(plate.info.height, DUPOIN_IG_SWIPE_BUTTON_HEIGHT);
  const at = (x: number, y: number) => {
    const i = (y * plate.info.width + x) * 4;
    return [plate.data[i], plate.data[i + 1], plate.data[i + 2], plate.data[i + 3]];
  };
  assert.equal(at(0, 0)[3], 0, 'capsule corners stay transparent so the scene shows through');
  const interior = at(14, Math.floor(plate.info.height / 2));
  assert.deepEqual(interior, [0, 0, 0, 0], 'pill interior fill is transparent');
  const rim = at(Math.floor(plate.info.width / 2), 0);
  assert.ok(rim[0] > 200 && rim[1] > 200 && rim[2] > 200 && rim[3] > 200, 'top edge is the thin white border');

  let opaqueBlack = 0;
  let whiteLabel = 0;
  for (let y = 0; y < plate.info.height; y++) {
    for (let x = 0; x < plate.info.width; x++) {
      const [r, g, b, a] = at(x, y);
      if (a > 240 && r < 40 && g < 40 && b < 40) opaqueBlack += 1;
      if (a === 255 && r > 230 && g > 230 && b > 230) whiteLabel += 1;
    }
  }
  assert.equal(opaqueBlack, 0, 'ghost pill has no opaque black fill');
  assert.ok(whiteLabel > 40, 'white stroke and label stay on the plate');
});

test('swipe-left placement is centered and sits above the footer band', () => {
  const width = DUPOIN_IG_CHROME_WIDTH;
  const height = DUPOIN_IG_CHROME_HEIGHT;
  const place = chromePlacement(width, height);
  const swipe = swipeButtonPlacement(width, height, place.footerHeight, place.headerHeight);
  assert.equal(swipe.width, DUPOIN_IG_SWIPE_BUTTON_WIDTH);
  assert.equal(swipe.height, DUPOIN_IG_SWIPE_BUTTON_HEIGHT);
  assert.equal(swipe.gapAboveFooter, DUPOIN_IG_SWIPE_GAP_ABOVE_FOOTER_PX);
  assert.equal(swipe.left, Math.round((width - swipe.width) / 2));
  assert.equal(width - (swipe.left + swipe.width), swipe.left, 'left and right margins match');
  assert.equal(swipe.top + swipe.height + swipe.gapAboveFooter, height - place.footerHeight);
  assert.ok(swipe.top > place.headerHeight, 'pill stays below the header lockup on the template canvas');
});

test('compositing stamps the swipe pill only when requested', async () => {
  const width = DUPOIN_IG_CHROME_WIDTH;
  const height = DUPOIN_IG_CHROME_HEIGHT;
  const canvas = await sharp({
    create: { width, height, channels: 4, background: { r: 180, g: 20, b: 20, alpha: 1 } },
  }).png().toBuffer();

  const place = chromePlacement(width, height);
  const swipe = swipeButtonPlacement(width, height, place.footerHeight, place.headerHeight);
  const off = await compositeDupoinInstagramChrome(canvas);
  const on = await compositeDupoinInstagramChrome(canvas, { includeSwipeLeft: true });

  const offRaw = await raw(off);
  const onRaw = await raw(on);
  const read = (image: { data: Buffer; info: { width: number } }, x: number, y: number) => {
    const i = (y * image.info.width + x) * 4;
    return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
  };
  const plate = await raw(DUPOIN_SOCIAL_SWIPE_LEFT_PNG_PATH);
  const plateAt = (x: number, y: number) => {
    const i = (y * plate.info.width + x) * 4;
    return [plate.data[i], plate.data[i + 1], plate.data[i + 2], plate.data[i + 3]];
  };

  let sample: { x: number; y: number; rgba: number[] } | null = null;
  for (let y = 8; y < plate.info.height - 8 && !sample; y++) {
    for (let x = 16; x < plate.info.width - 16; x++) {
      const rgba = plateAt(x, y);
      if (rgba[3] === 255 && rgba[0] > 230 && rgba[1] > 230 && rgba[2] > 230) {
        sample = { x, y, rgba };
        break;
      }
    }
  }
  assert.ok(sample, 'expected a white label pixel on the swipe plate');

  const sceneX = swipe.left + sample.x;
  const sceneY = swipe.top + sample.y;
  assert.deepEqual(read(offRaw, sceneX, sceneY).slice(0, 3), [180, 20, 20], 'swipe off leaves the pill area as the generated scene');
  assert.deepEqual(read(onRaw, sceneX, sceneY), sample.rgba, 'swipe on copies the plate pixel, not a redraw');

  const above = read(onRaw, Math.round(width / 2), swipe.top - 6);
  assert.deepEqual(above.slice(0, 3), [180, 20, 20], 'scene immediately above the pill stays clear');
  const bottom = read(onRaw, 10, height - 4);
  assert.ok(bottom[0] > 245 && bottom[1] > 245 && bottom[2] > 245, 'footer stays the white regulatory bar');

  const fill = read(onRaw, swipe.left + 14, swipe.top + Math.floor(swipe.height / 2));
  assert.deepEqual(fill, [180, 20, 20, 255], 'scene shows through the transparent pill fill');
});

test('swipe-left compositing stays centered above the footer on a square canvas', async () => {
  const width = 1024;
  const height = 1024;
  const canvas = await sharp({
    create: { width, height, channels: 4, background: { r: 8, g: 16, b: 32, alpha: 1 } },
  }).png().toBuffer();
  const stamped = await compositeDupoinInstagramChrome(canvas, { includeSwipeLeft: true });
  const { data, info } = await raw(stamped);
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const place = chromePlacement(width, height);
  const swipe = swipeButtonPlacement(width, height, place.footerHeight, place.headerHeight);
  assert.equal(swipe.left, Math.round((width - swipe.width) / 2));
  assert.ok(swipe.top + swipe.height <= height - place.footerHeight, 'pill must not cover the footer');
  assert.deepEqual(at(Math.round(width / 2), Math.round(height / 2)), [8, 16, 32]);
  const fillX = swipe.left + Math.round((14 + 0.5) * (swipe.width / DUPOIN_IG_SWIPE_BUTTON_WIDTH) - 0.5);
  const fillY = swipe.top + Math.round((Math.floor(DUPOIN_IG_SWIPE_BUTTON_HEIGHT / 2) + 0.5) * (swipe.height / DUPOIN_IG_SWIPE_BUTTON_HEIGHT) - 0.5);
  assert.deepEqual(at(fillX, fillY), [8, 16, 32], 'scaled pill fill stays transparent over the scene');
  const bottom = at(12, height - 3);
  assert.ok(bottom[0] > 245 && bottom[1] > 245 && bottom[2] > 245);
});
