import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  AssetError,
  assetFilePath,
  assetOwnerDir,
  canManageAsset,
  canViewAsset,
  cleanAssetName,
  imageAssetsRoot,
  isAssetId,
  quotaAllows,
  toAssetItem,
  validateAssetImage,
} from '../src/lib/image-assets';
import { IMAGE_ASSET_MAX_BYTES, IMAGE_ASSET_QUOTA_BYTES, formatBytes } from '../src/lib/image-assets-shared';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: '#2EB5C4' } }).png().toBuffer();

test('quotas are 8 MB per file and 500 MB per user', () => {
  assert.equal(IMAGE_ASSET_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(IMAGE_ASSET_QUOTA_BYTES, 500 * 1024 * 1024);
  assert.equal(quotaAllows(IMAGE_ASSET_QUOTA_BYTES - 10, 10), true);
  assert.equal(quotaAllows(IMAGE_ASSET_QUOTA_BYTES - 10, 11), false);
  assert.equal(formatBytes(1536), '2 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('validateAssetImage trusts the decoded format, not the claimed type', async () => {
  const ok = await validateAssetImage(await png(40, 30));
  assert.deepEqual(ok, { mime: 'image/png', ext: 'png', width: 40, height: 30 });
  const jpeg = await sharp({ create: { width: 10, height: 20, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  assert.deepEqual(await validateAssetImage(jpeg), { mime: 'image/jpeg', ext: 'jpg', width: 10, height: 20 });
  const webp = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#000' } }).webp().toBuffer();
  assert.equal((await validateAssetImage(webp)).mime, 'image/webp');

  const fake = Buffer.from('<?php echo "hi"; ?> definitely not a png');
  await assert.rejects(() => validateAssetImage(fake), (error: unknown) => error instanceof AssetError && error.status === 400);
  const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).gif().toBuffer();
  await assert.rejects(() => validateAssetImage(gif), /PNG, JPEG, or WebP/);
  await assert.rejects(() => validateAssetImage(Buffer.alloc(0)), /empty/);
  await assert.rejects(() => validateAssetImage(Buffer.alloc(IMAGE_ASSET_MAX_BYTES + 1)), (error: unknown) => error instanceof AssetError && error.status === 413);
  const huge = await sharp({ create: { width: 8001, height: 2, channels: 3, background: '#000' } }).png().toBuffer();
  await assert.rejects(() => validateAssetImage(huge), /8000 px/);
});

test('asset paths stay inside data/image-assets/<owner>/ (not public/)', () => {
  const cwd = '/srv/mos';
  assert.equal(imageAssetsRoot(cwd), path.join(cwd, 'data', 'image-assets'));
  assert.equal(assetFilePath('user-1', 'abc-123.png', cwd), path.join(cwd, 'data', 'image-assets', 'user-1', 'abc-123.png'));
  for (const [owner, key] of [['..', 'a.png'], ['user-1', '../a.png'], ['user/1', 'a.png'], ['user-1', 'a.svg'], ['user-1', '.png'], ['', 'a.png'], ['user-1', 'a.png/..']]) {
    assert.equal(assetFilePath(owner, key, cwd), null, `${owner} ${key}`);
  }
  assert.equal(assetOwnerDir('../x', cwd), null);
  assert.equal(assetOwnerDir('user-1', cwd), path.join(cwd, 'data', 'image-assets', 'user-1'));
  assert.doesNotMatch(imageAssetsRoot(cwd), /public/);
  assert.equal(isAssetId('2f0c6f0e-1111-4c4c-8888-123456789abc'), true);
  assert.equal(isAssetId('../etc'), false);
});

test('personal by default: owner, shared, admin visibility; owner or admin manage', () => {
  const owner = { id: 'u1', role: 'member' };
  const other = { id: 'u2', role: 'member' };
  const admin = { id: 'a', role: 'admin' };
  const personal = { owner_id: 'u1', shared: false };
  const shared = { owner_id: 'u1', shared: true };
  assert.equal(canViewAsset(owner, personal), true);
  assert.equal(canViewAsset(other, personal), false);
  assert.equal(canViewAsset(other, shared), true);
  assert.equal(canViewAsset(admin, personal), true);
  assert.equal(canManageAsset(owner, shared), true);
  assert.equal(canManageAsset(other, shared), false);
  assert.equal(canManageAsset(admin, personal), true);
  const item = toAssetItem(other, { id: 'x1', owner_id: 'u1', owner_name: 'Ayu', original_name: 'logo.png', mime_type: 'image/png', file_size: 10, width: 1, height: 2, shared: true, storage_key: 'x1.png', created_at: new Date('2026-11-26T10:00:00Z') });
  assert.deepEqual({ mine: item.mine, canManage: item.canManage, url: item.url, ownerName: item.ownerName }, { mine: false, canManage: false, url: '/api/image-assets/x1/file', ownerName: 'Ayu' });
});

test('cleanAssetName strips paths and control characters', () => {
  assert.equal(cleanAssetName('C:\\Users\\me\\product.png', 'png'), 'product.png');
  assert.equal(cleanAssetName('../../evil\u0000.png', 'png'), 'evil.png');
  assert.equal(cleanAssetName('', 'jpg'), 'asset.jpg');
  assert.equal(cleanAssetName('a'.repeat(300), 'png').length, 120);
});

test('migration 072 is idempotent, has no ? placeholders, and has a rollback', () => {
  const up = read('db/migrations/072_image_assets.sql');
  const executable = up.replace(/--.*$/gm, '');
  assert.match(up, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(executable, /CREATE TABLE IF NOT EXISTS image_assets/);
  assert.match(executable, /owner_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(executable, /shared BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(executable, /file_size <= 8388608/);
  assert.match(executable, /CREATE INDEX IF NOT EXISTS idx_image_assets_owner/);
  assert.doesNotMatch(executable, /\?/);
  assert.doesNotMatch(executable, /\bDROP\b|DELETE FROM|TRUNCATE|ALTER TABLE assets/i);
  const down = read('db/rollbacks/072_image_assets_down.sql');
  assert.match(down, /DROP TABLE IF EXISTS image_assets;/);
  assert.match(down, /DELETE FROM schema_migrations WHERE name = '072_image_assets\.sql';/);
  assert.doesNotMatch(down.replace(/--.*$/gm, ''), /\?/);
  assert.match(read('.gitignore'), /^data\/image-assets\/$/m);
});

test('routes authenticate, check access on the server and never serve from public/', () => {
  const list = read('src/app/api/image-assets/route.ts');
  assert.match(list, /getAuthorizedUser\(request\)/);
  assert.match(list, /hasGenerationFeature\(actor\)/);
  assert.match(list, /validateAssetImage\(bytes\)/);
  const one = read('src/app/api/image-assets/[id]/route.ts');
  assert.match(one, /canManageAsset\(actor, row\)/g);
  assert.equal((one.match(/canManageAsset\(actor, row\)/g) || []).length, 2, 'PATCH and DELETE both check the owner');
  const file = read('src/app/api/image-assets/[id]/file/route.ts');
  assert.match(file, /!row \|\| !canViewAsset\(actor, row\)/);
  assert.match(file, /'X-Content-Type-Options': 'nosniff'/);
  assert.match(file, /'Cache-Control': 'private, max-age=3600'/);
  const store = read('src/lib/image-assets-store.ts');
  assert.match(store, /WHERE \(SELECT COALESCE\(SUM\(file_size\), 0\) FROM image_assets WHERE owner_id = \?\) \+ \? <= \?/);
  const users = read('src/app/api/admin/users/route.ts');
  assert.match(users, /assetOwnerDir\(id\)/);
});

test('Generate Image offers Pick from library and Save to library for both upload lists', () => {
  const page = read('src/app/dashboard/generate-image/page.tsx');
  assert.match(page, /data-testid="generate-image-pick-reference"/);
  assert.match(page, /data-testid="generate-image-pick-asset"/);
  assert.match(page, /<ImageAssetPicker/);
  assert.match(page, /saveToLibrary\(item, 'reference'\)/);
  assert.match(page, /saveToLibrary\(item, 'asset'\)/);
  const picker = read('src/components/image-asset-picker.tsx');
  for (const label of ['My assets', 'Shared with team', 'Generated images']) assert.match(picker, new RegExp(`label: '${label}'`));
  assert.match(picker, /prepareUploadFromUrl\(item\.url, item\.name\)/);
  assert.match(picker, /title="Delete this asset permanently\?"/);
});
