import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  DUPOIN_LOGO_PNG_PATH,
  logoPlacement,
  compositeDupoinLogo,
} from '../src/lib/dupoin-logo-composite';

test('the official wordmark asset ships with the repo and is a clean teal wordmark', async () => {
  assert.ok(fs.existsSync(DUPOIN_LOGO_PNG_PATH), 'logo asset must be committed, not fetched at runtime');

  const image = sharp(DUPOIN_LOGO_PNG_PATH);
  const meta = await image.metadata();
  assert.equal(meta.format, 'png');
  assert.ok(meta.hasAlpha, 'logo must have transparency so it composites onto any background');
  assert.ok((meta.width ?? 0) > 200 && (meta.height ?? 0) > 80, 'logo must be high enough resolution to downscale cleanly');

  // Every opaque pixel must be the official Dupoin Blue. This is what stops a
  // stray award-laurel lockup or a white background box slipping back in.
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  let opaque = 0;
  let offBrand = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    opaque += 1;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (Math.abs(r - 46) > 24 || Math.abs(g - 181) > 24 || Math.abs(b - 196) > 24) offBrand += 1;
  }
  assert.ok(opaque > 5_000, 'logo must actually contain pixels');
  assert.equal(offBrand, 0, `every opaque pixel must be Dupoin Blue, found ${offBrand} off-brand`);
});

test('placement keeps the logo inside the 80px safe zone and scales with the canvas', () => {
  const square = logoPlacement(1080, 1080, 543, 227);
  assert.ok(square.width <= 1080 * 0.2, 'logo stays a small mark, not a banner');
  assert.ok(square.left + square.width <= 1080 - 80, 'right edge respects the 80px safe zone');
  assert.ok(square.top + square.height <= 1080 - 80, 'bottom edge respects the 80px safe zone');
  assert.ok(square.left >= 80 && square.top >= 80, 'logo never lands in the margin');

  // Aspect ratio of the source must be preserved — a stretched logo is a wrong logo.
  const ratioIn = 543 / 227;
  const ratioOut = square.width / square.height;
  assert.ok(Math.abs(ratioIn - ratioOut) < 0.02, `aspect must be preserved, got ${ratioOut} vs ${ratioIn}`);

  // A wide canvas scales off the smaller dimension so the mark never dominates.
  const wide = logoPlacement(1920, 1080, 543, 227);
  assert.ok(wide.left + wide.width <= 1920 - 80);
  assert.ok(wide.top + wide.height <= 1080 - 80);
});

test('compositing stamps the real wordmark onto a generated image', async () => {
  const canvas = await sharp({
    create: { width: 1080, height: 1350, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
  }).png().toBuffer();

  const stamped = await compositeDupoinLogo(canvas);
  assert.ok(stamped.length > 0);

  const meta = await sharp(stamped).metadata();
  assert.equal(meta.width, 1080, 'compositing must not resize the generated image');
  assert.equal(meta.height, 1350);

  // The lower-right region must now contain Dupoin Blue that was not there before.
  const region = { left: 1080 - 400, top: 1350 - 300, width: 380, height: 280 };
  const before = await sharp(canvas).extract(region).raw().toBuffer();
  const after = await sharp(stamped).extract(region).raw().toBuffer();

  const countBrand = (buf: Buffer, channels: number) => {
    let n = 0;
    for (let i = 0; i < buf.length; i += channels) {
      if (Math.abs(buf[i] - 46) < 30 && Math.abs(buf[i + 1] - 181) < 30 && Math.abs(buf[i + 2] - 196) < 30) n += 1;
    }
    return n;
  };
  const chBefore = (await sharp(canvas).extract(region).raw().toBuffer({ resolveWithObject: true })).info.channels;
  const chAfter = (await sharp(stamped).extract(region).raw().toBuffer({ resolveWithObject: true })).info.channels;

  assert.equal(countBrand(before, chBefore), 0, 'control: blank canvas has no brand pixels');
  assert.ok(countBrand(after, chAfter) > 500, 'composited image must carry the real teal wordmark');
});

test('compositing fails loudly rather than silently returning an unbranded image', async () => {
  await assert.rejects(
    () => compositeDupoinLogo(Buffer.from('not an image')),
    /composite|logo|input/i,
    'a broken composite must surface, not pass through unbranded',
  );
});

test('the committed asset is the file the compositor actually reads', () => {
  assert.equal(path.basename(DUPOIN_LOGO_PNG_PATH), 'dupoin-logo.png');
  assert.ok(DUPOIN_LOGO_PNG_PATH.includes(path.join('public', 'brand')));
});
