import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  IMAGE_ASPECT_RATIOS,
  MIN_OUTPUT_LONG_SIDE,
  gatewayImageSize,
  getImageGenerationSpec,
  legacyGatewayImageSize,
} from '../src/lib/image-aspect-ratio';
import { ensureMinLongSide, upscaleTarget } from '../src/lib/image-upscale';
import { isSizeRefusal } from '../src/lib/image-generation-fallback';
import { openRouterImageResolution } from '../src/lib/llm-provider';
import { nextSopVersion } from '../src/lib/generated-images';
import { compositeDupoinInstagramChrome } from '../src/lib/dupoin-ig-chrome';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const dims = (size: string) => size.split('x').map(Number) as [number, number];

test('2K sizes: long side 2048, exact ratio, GPT Image 2 size rules', () => {
  assert.equal(MIN_OUTPUT_LONG_SIDE, 2048);
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const [w, h] = dims(gatewayImageSize('cx/gpt-image-2', ratio));
    const [rw, rh] = ratio.split(':').map(Number);
    assert.equal(Math.max(w, h), 2048, ratio);
    assert.equal(w * rh, h * rw, `${ratio} must be exact`);
    assert.equal(w % 16, 0);
    assert.equal(h % 16, 0);
    assert.ok(Math.max(w, h) / Math.min(w, h) <= 3);
    assert.ok(w * h >= 655_360 && w * h <= 8_294_400);
    assert.equal(getImageGenerationSpec(ratio).size, `${w}x${h}`);
  }
  assert.deepEqual(IMAGE_ASPECT_RATIOS.map(ratio => gatewayImageSize('cx/gpt-image-2', ratio)), ['2048x1152', '2048x1536', '2048x2048', '1536x2048', '1152x2048']);
});

test('gpt-image-1.5 keeps the classic sizes; every other gateway id gets 2K', () => {
  assert.deepEqual(IMAGE_ASPECT_RATIOS.map(ratio => gatewayImageSize('cx/gpt-image-1.5', ratio)), ['1536x1024', '1536x1024', '1024x1024', '1024x1536', '1024x1536']);
  assert.deepEqual(IMAGE_ASPECT_RATIOS.map(legacyGatewayImageSize), ['1536x1024', '1536x1024', '1024x1024', '1024x1536', '1024x1536']);
  for (const model of ['cx/gpt-image-2', 'cx/gpt-image-2.5', 'cx/gpt-image-2.5-flare', 'cx/gpt-6-sol-image', 'ag/gemini-3.1-flash-image']) {
    assert.equal(gatewayImageSize(model, '9:16'), '1152x2048', model);
  }
});

test('size refusal detection only matches a 400 that names the size', () => {
  assert.equal(isSizeRefusal(new Error('Image API error 400: {"error":{"message":"Invalid size 2048x1152"}}')), true);
  assert.equal(isSizeRefusal(new Error('Image API error 400: unsupported resolution')), true);
  assert.equal(isSizeRefusal(new Error('Image API error 400: prompt rejected by safety system')), false);
  assert.equal(isSizeRefusal(new Error('Image API error 429: size of queue exceeded')), false);
  assert.equal(isSizeRefusal(new Error('Image API error 403: TOS_VIOLATION')), false);
});

test('paid OpenRouter: Gemini 3 / Nano Banana 2 render 2K natively, Gemini 2.5 stays 1K', () => {
  assert.equal(openRouterImageResolution('google/gemini-3.1-flash-image'), '2K');
  assert.equal(openRouterImageResolution('google/gemini-3-pro-image'), '2K');
  assert.equal(openRouterImageResolution('google/gemini-3.1-flash-lite-image'), '2K');
  assert.equal(openRouterImageResolution('google/gemini-nano-banana-2.1'), '2K');
  assert.equal(openRouterImageResolution('google/gemini-2.5-flash-image'), '1K');
  const provider = read('src/lib/llm-provider.ts');
  assert.match(provider, /isOpenAi \? \{ quality: 'medium' \} : \{ resolution: openRouterImageResolution\(input\.model\) \}/);
});

test('upscaleTarget keeps the aspect ratio and only enlarges below 2048', () => {
  assert.deepEqual(upscaleTarget(1086, 1448), { width: 1536, height: 2048 });
  assert.deepEqual(upscaleTarget(1672, 941), { width: 2048, height: 1153 });
  assert.deepEqual(upscaleTarget(1024, 1024), { width: 2048, height: 2048 });
  assert.equal(upscaleTarget(2048, 1152), null);
  assert.equal(upscaleTarget(3000, 1000), null);
  assert.equal(upscaleTarget(0, 10), null);
});

test('ensureMinLongSide upscales small output with lanczos and leaves 2K output untouched', async () => {
  const small = await sharp({ create: { width: 848, height: 1264, channels: 3, background: '#123456' } }).png().toBuffer();
  const up = await ensureMinLongSide(small);
  const meta = await sharp(up.bytes).metadata();
  assert.equal(meta.height, 2048);
  assert.equal(meta.width, Math.round(848 * 2048 / 1264));
  assert.equal(up.upscaledFrom, '848x1264');
  assert.equal(up.width, meta.width);

  const big = await sharp({ create: { width: 2048, height: 1152, channels: 3, background: '#000000' } }).png().toBuffer();
  const same = await ensureMinLongSide(big);
  assert.equal(same.bytes, big);
  assert.equal(same.upscaledFrom, null);
  await assert.rejects(() => ensureMinLongSide(Buffer.from('not an image')));
});

test('chrome composited after the upscale lands on the final 2K canvas', async () => {
  const small = await sharp({ create: { width: 1086, height: 1448, channels: 3, background: '#203040' } }).png().toBuffer();
  const up = await ensureMinLongSide(small);
  const stamped = await compositeDupoinInstagramChrome(up.bytes, { logo: 'dupoin', footer: true });
  const meta = await sharp(stamped).metadata();
  assert.deepEqual([meta.width, meta.height], [1536, 2048]);
});

test('route upscales before compositing the chrome and records the size', () => {
  const route = read('src/app/api/generate-image/route.ts');
  const upscale = route.indexOf('await ensureMinLongSide(imageBytes)');
  const chrome = route.indexOf('await compositeDupoinInstagramChrome(imageBytes');
  assert.ok(upscale > 0 && chrome > upscale, 'upscale must run before the chrome');
  assert.match(route, /width: sized\.width,\s*height: sized\.height/);
  assert.match(route, /if \(generationSpec\.size === legacy \|\| !isSizeRefusal\(error\)\) throw error;/);
});

test('nextSopVersion uses the highest version + 1 so a delete cannot cause an overwrite', () => {
  const base = 'DUPOIN_Promo_GenImage';
  assert.equal(nextSopVersion([], base), 1);
  assert.equal(nextSopVersion([`${base}_V1_20261126.png`, `${base}_V3_20261126.png`], base), 4);
  assert.equal(nextSopVersion([`${base}_V2_20261126.png`, 'DUPOIN_Promo_GenImageX_V9_20261126.png', `${base}_Vx_1.png`], base), 3);
});
