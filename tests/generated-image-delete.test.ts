import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canDeleteGeneratedImage,
  deleteGeneratedImage,
  generatedImageOriginalsDir,
  generatedImagesDir,
  isDeletableImageFilename,
  pruneImageFromTaskOutput,
  resolveInside,
  type GeneratedImageDeleteStore,
  type TaskImageRow,
} from '../src/lib/generated-image-delete';
import { generatedImageMetaDir } from '../src/lib/generated-image-meta';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const FILE = 'DUPOIN_Promo_GenImage_V1_20261126.png';

function sandbox() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mos-del-'));
  for (const dir of [generatedImagesDir(cwd), generatedImageMetaDir(cwd), generatedImageOriginalsDir(cwd)]) fs.mkdirSync(dir, { recursive: true });
  return cwd;
}

function fakeStore(rows: TaskImageRow[]) {
  const updates: Array<{ id: string; json: string }> = [];
  const store: GeneratedImageDeleteStore = {
    async tasksReferencing() { return rows; },
    async updateTaskOutput(id, json) { updates.push({ id, json }); },
  };
  return { store, updates };
}

test('filename guard rejects traversal, hidden and non-image names', () => {
  assert.equal(isDeletableImageFilename(FILE), true);
  for (const bad of ['../.env', '..png', '.hidden.png', 'a/b.png', 'a\\b.png', 'x.svg', 'x.png/..', '', 'a..b.png', `${'a'.repeat(200)}.png`]) {
    assert.equal(isDeletableImageFilename(bad), false, bad);
  }
  assert.equal(resolveInside('/srv/x', 'a.png'), path.resolve('/srv/x/a.png'));
  assert.equal(resolveInside('/srv/x', '../a.png'), null);
  assert.equal(resolveInside('/srv/x', 'sub/a.png'), null);
});

test('owner or admin may delete; ownerless images are admin-only', () => {
  assert.equal(canDeleteGeneratedImage({ id: 'u1', role: 'member' }, ['u1']), true);
  assert.equal(canDeleteGeneratedImage({ id: 'u1', role: 'member' }, ['u2']), false);
  assert.equal(canDeleteGeneratedImage({ id: 'u1', role: 'member' }, ['u1', 'u2']), false);
  assert.equal(canDeleteGeneratedImage({ id: 'u1', role: 'member' }, []), false);
  assert.equal(canDeleteGeneratedImage({ id: 'a', role: 'admin' }, []), true);
  assert.equal(canDeleteGeneratedImage({ id: 'a', role: 'admin' }, ['u2']), true);
});

test('pruneImageFromTaskOutput removes every reference and moves imageUrl', () => {
  const other = '/api/generated-images/DUPOIN_Other_SocialPost_V1_20261126.png';
  const output = {
    caption: 'x',
    images: [
      { imageUrl: other, prompt: 'a' },
      { imageUrl: `/api/generated-images/${FILE}`, prompt: 'b' },
      `/outputs/images/${FILE}`,
      { fileName: FILE },
    ],
    imageUrl: `/api/generated-images/${FILE}`,
  };
  const pruned = pruneImageFromTaskOutput(output, FILE);
  assert.equal(pruned.changed, true);
  assert.deepEqual(pruned.output, { caption: 'x', images: [{ imageUrl: other, prompt: 'a' }], imageUrl: other });

  const only = pruneImageFromTaskOutput({ images: [{ imageUrl: `/api/generated-images/${FILE}` }], imageUrl: `/api/generated-images/${FILE}` }, FILE);
  assert.deepEqual(only.output, { images: [] });
  assert.equal(pruneImageFromTaskOutput({ images: [{ imageUrl: other }], imageUrl: other }, FILE).changed, false);
  assert.equal(pruneImageFromTaskOutput(null, FILE).changed, false);
});

test('owner delete removes PNG, meta, pre-chrome original and task entries', async () => {
  const cwd = sandbox();
  fs.writeFileSync(path.join(generatedImagesDir(cwd), FILE), 'png');
  fs.writeFileSync(path.join(generatedImageOriginalsDir(cwd), `${FILE}.jpg`), 'raw');
  fs.writeFileSync(path.join(generatedImageMetaDir(cwd), `${FILE}.json`), JSON.stringify({ fileName: FILE, userId: 'u1', prompt: 'p' }));
  const keep = 'DUPOIN_Keep_GenImage_V1_20261126.png';
  fs.writeFileSync(path.join(generatedImagesDir(cwd), keep), 'png');
  const { store, updates } = fakeStore([
    { id: 't1', user_id: 'u1', output_data: JSON.stringify({ images: [{ imageUrl: `/api/generated-images/${FILE}` }], imageUrl: `/api/generated-images/${FILE}` }) },
    // LIKE superset: '_' matched something else; must be ignored, not edited.
    { id: 't2', user_id: 'u9', output_data: JSON.stringify({ images: [{ imageUrl: '/api/generated-images/DUPOIN_PromoXGenImage_V1_20261126.png' }] }) },
  ]);
  const outcome = await deleteGeneratedImage({ actor: { id: 'u1', role: 'member' }, filename: FILE, store, cwd });
  assert.deepEqual(outcome, { ok: true, removedFiles: 3, updatedTasks: 1 });
  assert.equal(fs.existsSync(path.join(generatedImagesDir(cwd), FILE)), false);
  assert.equal(fs.existsSync(path.join(generatedImageOriginalsDir(cwd), `${FILE}.jpg`)), false);
  assert.equal(fs.existsSync(path.join(generatedImageMetaDir(cwd), `${FILE}.json`)), false);
  assert.equal(fs.existsSync(path.join(generatedImagesDir(cwd), keep)), true);
  assert.deepEqual(updates.map(u => u.id), ['t1']);
  assert.deepEqual(JSON.parse(updates[0].json), { images: [] });
});

test('another member gets 403 and nothing is removed; admin can delete', async () => {
  const cwd = sandbox();
  fs.writeFileSync(path.join(generatedImagesDir(cwd), FILE), 'png');
  const { store, updates } = fakeStore([{ id: 't1', user_id: 'owner', output_data: { imageUrl: `/api/generated-images/${FILE}` } }]);
  const denied = await deleteGeneratedImage({ actor: { id: 'intruder', role: 'member' }, filename: FILE, store, cwd });
  assert.deepEqual(denied, { ok: false, status: 403, error: 'You can only delete your own images.' });
  assert.equal(fs.existsSync(path.join(generatedImagesDir(cwd), FILE)), true);
  assert.equal(updates.length, 0);
  const admin = await deleteGeneratedImage({ actor: { id: 'boss', role: 'admin' }, filename: FILE, store, cwd });
  assert.equal(admin.ok, true);
  assert.equal(fs.existsSync(path.join(generatedImagesDir(cwd), FILE)), false);
});

test('ownerless legacy file is admin-only; bad names 400; missing 404', async () => {
  const cwd = sandbox();
  fs.writeFileSync(path.join(generatedImagesDir(cwd), FILE), 'png');
  const { store } = fakeStore([]);
  const member = await deleteGeneratedImage({ actor: { id: 'u1', role: 'member' }, filename: FILE, store, cwd });
  assert.equal(member.ok, false);
  assert.equal(!member.ok && member.status, 403);
  const bad = await deleteGeneratedImage({ actor: { id: 'boss', role: 'admin' }, filename: '../.env', store, cwd });
  assert.equal(!bad.ok && bad.status, 400);
  const missing = await deleteGeneratedImage({ actor: { id: 'boss', role: 'admin' }, filename: 'DUPOIN_None_GenImage_V1_20261126.png', store, cwd });
  assert.equal(!missing.ok && missing.status, 404);
});

test('DELETE route authorizes on the server; gallery offers Mine/All and a confirm dialog', () => {
  const route = read('src/app/api/generated-images/[filename]/route.ts');
  assert.match(route, /export async function DELETE/);
  assert.match(route, /getAuthorizedUser\(request\)/);
  assert.match(route, /deleteGeneratedImage\(\{ actor, filename, store: deleteStore \}\)/);
  assert.match(route, /LIKE \? ESCAPE/);
  const images = read('src/app/api/images/route.ts');
  assert.match(images, /searchParams\.get\('scope'\) === 'mine'/);
  assert.match(images, /canDelete: isAdmin \|\| \(img\.userId !== null && img\.userId === userId\)/);
  const page = read('src/app/dashboard/images/page.tsx');
  assert.match(page, /scope=\$\{scope\}/);
  assert.match(page, /data-testid=\{`gallery-scope-\$\{option\.key\}`\}/);
  assert.match(page, /title="Delete this image permanently\?"/);
  assert.match(page, /method: 'DELETE'/);
  assert.match(page, /\{img\.canDelete && \(/);
});
