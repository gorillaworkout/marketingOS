import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { AVAILABLE_IMAGE_MODELS } from '../src/lib/image-models';
import { DEFAULT_EDIT_IMAGE_MODEL, EDIT_IMAGE_MODELS, resolveEditImageModel } from '../src/lib/image-edit-shared';
import {
  buildEditPrompt,
  generatedImageOriginalPath,
  hasGeneratedImageOriginal,
  loadEditSource,
  nearestAspectRatio,
  saveGeneratedImageOriginal,
} from '../src/lib/image-edit';
import { generatedImageOriginalsDir, generatedImagesDir } from '../src/lib/generated-image-delete';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const FILE = 'DUPOIN_Promo_GenImage_V1_20261126.png';
const solid = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

test('edit models are the free cx GPT Image tools; anything else falls back to GPT Image 2', () => {
  const catalog = new Set(AVAILABLE_IMAGE_MODELS.map(model => model.id));
  for (const id of EDIT_IMAGE_MODELS) {
    assert.ok(catalog.has(id), id);
    assert.match(id, /^cx\/gpt-image-/);
  }
  assert.equal(DEFAULT_EDIT_IMAGE_MODEL, 'cx/gpt-image-2');
  assert.equal(resolveEditImageModel('cx/gpt-image-2.5'), 'cx/gpt-image-2.5');
  for (const other of ['ag/gemini-3.1-flash-image', 'cx/gpt-6-sol-image', 'openai/gpt-image-2', '', null]) {
    assert.equal(resolveEditImageModel(other), 'cx/gpt-image-2');
  }
});

test('nearestAspectRatio keeps the source frame', () => {
  assert.equal(nearestAspectRatio(1536, 2048), '3:4');
  assert.equal(nearestAspectRatio(1152, 2048), '9:16');
  assert.equal(nearestAspectRatio(2048, 2048), '1:1');
  assert.equal(nearestAspectRatio(2048, 1152), '16:9');
  assert.equal(nearestAspectRatio(2048, 1536), '4:3');
  assert.equal(nearestAspectRatio(848, 1264), '3:4');
  assert.equal(nearestAspectRatio(1536, 1024), '4:3');
});

test('edit prompt keeps everything else; legacy images repaint the baked chrome', () => {
  const clean = buildEditPrompt('Make the sky orange', true);
  assert.match(clean, /Apply only this change:\nMake the sky orange/);
  assert.match(clean, /Keep everything else the same/);
  assert.doesNotMatch(clean, /regulatory footer/);
  assert.match(buildEditPrompt('x', false), /Repaint those areas as clean background/);
});

test('pre-chrome original is saved as <file>.jpg outside public/ and preferred for edits', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mos-edit-'));
  fs.mkdirSync(generatedImagesDir(cwd), { recursive: true });
  fs.writeFileSync(path.join(generatedImagesDir(cwd), FILE), await solid(1536, 2048, '#ffffff'));

  const legacy = await loadEditSource(FILE, cwd);
  assert.ok(legacy);
  assert.equal(legacy.clean, false);
  assert.deepEqual([legacy.width, legacy.height], [1536, 2048]);
  assert.match(legacy.dataUrl, /^data:image\/jpeg;base64,/);

  assert.equal(hasGeneratedImageOriginal(FILE, cwd), false);
  await saveGeneratedImageOriginal(FILE, await solid(1536, 2048, '#ff0000'), cwd);
  const originalFile = generatedImageOriginalPath(FILE, cwd)!;
  assert.equal(originalFile, path.join(generatedImageOriginalsDir(cwd), `${FILE}.jpg`));
  assert.doesNotMatch(originalFile, /public/);
  assert.equal((await sharp(originalFile).metadata()).format, 'jpeg');
  assert.equal(hasGeneratedImageOriginal(FILE, cwd), true);

  const clean = await loadEditSource(FILE, cwd);
  assert.ok(clean);
  assert.equal(clean.clean, true);
  const bytes = Buffer.from(clean.dataUrl.split(',')[1], 'base64');
  const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 200 && data[1] < 60, 'the red original was used, not the white composited file');
});

test('edit input is capped at 2048 px; unsafe or missing names give null', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mos-edit-'));
  fs.mkdirSync(generatedImagesDir(cwd), { recursive: true });
  fs.writeFileSync(path.join(generatedImagesDir(cwd), FILE), await solid(3000, 1500, '#123456'));
  const source = await loadEditSource(FILE, cwd);
  const meta = await sharp(Buffer.from(source!.dataUrl.split(',')[1], 'base64')).metadata();
  assert.deepEqual([meta.width, meta.height], [2048, 1024]);
  assert.equal(await loadEditSource('../.env', cwd), null);
  assert.equal(await loadEditSource('DUPOIN_Missing_GenImage_V1_20261126.png', cwd), null);
  assert.equal(generatedImageOriginalPath('../x.png', cwd), null);
});

test('route: edit validates the source, uses only edit models, saves originals before the chrome', () => {
  const route = read('src/app/api/generate-image/route.ts');
  assert.match(route, /if \(editOf !== null && !isDeletableImageFilename\(editOf\)\) return jsonError\('Invalid image to edit', 400\);/);
  assert.match(route, /resolveEditImageModel\(body\.model\)/);
  assert.match(route, /aspectRatio = nearestAspectRatio\(source\.width, source\.height\);/);
  assert.match(route, /uploads = editOf !== null \? \{ references: \[\], assets: \[\] \} : readInputImageLists\(body\);/);
  assert.match(route, /buildEditPrompt\(edit\.instruction, edit\.clean\)/);
  assert.match(route, /\(safeModel !== DEFAULT_IMAGE_MODEL \? DEFAULT_IMAGE_MODEL : null\)/);
  const preChrome = route.indexOf('const preChrome = sized.bytes;');
  const chrome = route.indexOf('await compositeDupoinInstagramChrome(imageBytes');
  assert.ok(preChrome > 0 && preChrome < chrome, 'original is captured before the chrome');
  assert.match(route, /await saveGeneratedImageOriginal\(fileName, preChrome, cwd\);/);
  assert.match(route, /parentFileName: edit\.parentFileName, editInstruction: edit\.instruction/);
  assert.match(read('src/lib/image-edit.ts'), /TODO\(later phase\): mask \/ inpaint/);
});

test('gallery: Edit opens a dialog with the legacy note; the list says which images have an original', () => {
  const page = read('src/app/dashboard/images/page.tsx');
  assert.match(page, /data-testid="gallery-edit"/);
  assert.match(page, /data-testid="gallery-card-edit"/);
  assert.match(page, /<ImageEditDialog/);
  const dialog = read('src/components/image-edit-dialog.tsx');
  assert.match(dialog, /editOf: image\.filename/);
  assert.match(dialog, /\{!image\.hasOriginal && \(/);
  assert.match(dialog, /EDIT_IMAGE_MODELS\.map/);
  assert.match(read('src/app/api/images/route.ts'), /hasOriginal: hasGeneratedImageOriginal\(img\.filename\)/);
  assert.match(read('src/lib/generated-image-delete.ts'), /`\$\{filename\}\.jpg`/);
});
