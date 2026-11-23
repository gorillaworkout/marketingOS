// tests/dpm-invitation-image.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.DPM_INVITATION_IMAGE_DIR = mkdtempSync(path.join(tmpdir(), 'dpm-inv-'));
const load = () => import('../src/lib/dpm-invitation/image');

const make = (width: number, height: number, format: 'jpeg' | 'png' | 'gif' = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 30, b: 40 } } }).toFormat(format).toBuffer();

test('portrait JPEG is re-encoded to WebP, metadata removed, size kept', async () => {
  const img = await load();
  const withExif = await sharp(await make(1024, 1536)).withExif({ IFD0: { Copyright: 'stand-in for GPS data' } }).jpeg().toBuffer();
  assert.ok((await sharp(withExif).metadata()).exif, 'fixture has EXIF');
  const out = await img.processInvitationImage(withExif);
  const meta = await sharp(out.data).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined);
  assert.deepEqual([out.width, out.height], [1024, 1536]);
});

test('large image is scaled so the longest side is 2400', async () => {
  const img = await load();
  const out = await img.processInvitationImage(await make(3000, 4500, 'png'));
  assert.deepEqual([out.width, out.height], [1600, 2400]);
});

test('rejects small, unsupported, oversized and non-image input', async () => {
  const img = await load();
  await assert.rejects(img.processInvitationImage(await make(300, 300)), { message: 'Image is too small (minimum 600 px on the short side).' });
  await assert.rejects(img.processInvitationImage(await make(800, 800, 'gif')), { message: 'Use a JPG, PNG or WebP image.' });
  await assert.rejects(img.processInvitationImage(Buffer.from('not an image')), { message: 'Could not read this image.' });
  await assert.rejects(img.processInvitationImage(Buffer.alloc(img.IMAGE_MAX_BYTES + 1)), { message: 'Image must be 8 MB or smaller.' });
});

test('save, read and remove by safe key only', async () => {
  const img = await load();
  const saved = await img.saveInvitationImage(await make(800, 1200));
  assert.match(saved.key, /^[0-9a-f-]{36}\.webp$/);
  assert.ok(existsSync(path.join(process.env.DPM_INVITATION_IMAGE_DIR!, saved.key)));
  assert.ok((await img.readInvitationImage(saved.key))!.length > 0);
  assert.equal(await img.readInvitationImage('../etc/passwd'), null);
  assert.equal(img.isSafeImageKey('../x.webp'), false);
  await img.removeInvitationImage(saved.key);
  assert.equal(await img.readInvitationImage(saved.key), null);
});
