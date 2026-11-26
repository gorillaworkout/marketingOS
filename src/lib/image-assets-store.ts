import fs from 'fs';
import path from 'path';
import { execute, queryAll, queryOne } from '@/lib/database';
import { IMAGE_ASSET_QUOTA_BYTES, type ImageAssetMime } from '@/lib/image-assets-shared';
import { AssetError, assetFilePath, type AssetRow } from '@/lib/image-assets';

/** Server-only SQL for image_assets (072). Placeholders are `?` (converted by database.ts). */

const SELECT = `SELECT a.id, a.owner_id, u.name AS owner_name, a.original_name, a.mime_type, a.file_size,
  a.width, a.height, a.shared, a.storage_key, a.created_at
  FROM image_assets a LEFT JOIN users u ON u.id = a.owner_id`;

export async function listOwnAssets(ownerId: string): Promise<AssetRow[]> {
  return queryAll<AssetRow & Record<string, unknown>>(`${SELECT} WHERE a.owner_id = ? ORDER BY a.created_at DESC LIMIT 500`, [ownerId]);
}

export async function listSharedAssets(exceptOwnerId: string): Promise<AssetRow[]> {
  return queryAll<AssetRow & Record<string, unknown>>(`${SELECT} WHERE a.shared = TRUE AND a.owner_id <> ? ORDER BY a.created_at DESC LIMIT 500`, [exceptOwnerId]);
}

export async function getAsset(id: string): Promise<AssetRow | undefined> {
  return queryOne<AssetRow & Record<string, unknown>>(`${SELECT} WHERE a.id = ?`, [id]);
}

export async function usedBytes(ownerId: string): Promise<number> {
  const row = await queryOne<{ total: string | number | null }>('SELECT COALESCE(SUM(file_size), 0) AS total FROM image_assets WHERE owner_id = ?', [ownerId]);
  return Number(row?.total ?? 0);
}

/**
 * Write the file, then insert the row only while the owner stays within the
 * quota (checked in the same statement). On refusal the file is removed.
 */
export async function createAsset(input: {
  id: string;
  ownerId: string;
  name: string;
  mime: ImageAssetMime;
  bytes: Buffer;
  width: number;
  height: number;
  shared: boolean;
  storageKey: string;
}): Promise<void> {
  const file = assetFilePath(input.ownerId, input.storageKey);
  if (!file) throw new AssetError(400, 'Invalid asset path.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, input.bytes, { flag: 'wx' });
  try {
    const inserted = await execute(
      `INSERT INTO image_assets (id, owner_id, original_name, mime_type, file_size, width, height, shared, storage_key)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COALESCE(SUM(file_size), 0) FROM image_assets WHERE owner_id = ?) + ? <= ?`,
      [input.id, input.ownerId, input.name, input.mime, input.bytes.length, input.width, input.height, input.shared, input.storageKey,
        input.ownerId, input.bytes.length, IMAGE_ASSET_QUOTA_BYTES],
    );
    if (inserted !== 1) throw new AssetError(413, 'Your asset library is full (500 MB). Delete some assets first.');
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
}

export async function setAssetShared(id: string, shared: boolean): Promise<void> {
  await execute('UPDATE image_assets SET shared = ?, updated_at = NOW() WHERE id = ?', [shared, id]);
}

export async function deleteAsset(row: AssetRow): Promise<void> {
  await execute('DELETE FROM image_assets WHERE id = ?', [row.id]);
  const file = assetFilePath(row.owner_id, row.storage_key);
  if (file) fs.rmSync(file, { force: true });
}
