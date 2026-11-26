import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import {
  IMAGE_ASSET_MAX_BYTES,
  IMAGE_ASSET_MAX_SIDE,
  IMAGE_ASSET_QUOTA_BYTES,
  type ImageAssetItem,
  type ImageAssetMime,
} from '@/lib/image-assets-shared';

/**
 * Server-only. Asset library for Generate Image (migration 072).
 *
 * Bytes live on the VPS disk at data/image-assets/<ownerId>/<storageKey>,
 * outside public/, and are only served through /api/image-assets/<id>/file
 * after the same visibility check as the list (own, shared, or admin).
 */

const FORMAT_TO_MIME: Record<string, { mime: ImageAssetMime; ext: string }> = {
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}\.(png|jpg|webp)$/;

export interface ValidatedAssetImage {
  mime: ImageAssetMime;
  ext: string;
  width: number;
  height: number;
}

/** Decode with sharp: the real format decides the type, not the upload's claimed MIME or name. */
export async function validateAssetImage(bytes: Buffer): Promise<ValidatedAssetImage> {
  if (!bytes.length) throw new AssetError(400, 'The file is empty.');
  if (bytes.length > IMAGE_ASSET_MAX_BYTES) throw new AssetError(413, 'Each asset must be 8 MB or smaller.');
  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes, { failOn: 'error' }).metadata();
  } catch {
    throw new AssetError(400, 'The file is not a readable PNG, JPEG, or WebP image.');
  }
  const format = meta.format ? FORMAT_TO_MIME[meta.format] : undefined;
  if (!format) throw new AssetError(400, 'Use a PNG, JPEG, or WebP image.');
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new AssetError(400, 'The image has no readable size.');
  if (width > IMAGE_ASSET_MAX_SIDE || height > IMAGE_ASSET_MAX_SIDE) throw new AssetError(400, `Images must be at most ${IMAGE_ASSET_MAX_SIDE} px per side.`);
  return { ...format, width, height };
}

export class AssetError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 413, message: string) {
    super(message);
  }
}

export function imageAssetsRoot(cwd: string = process.cwd()): string {
  return path.join(cwd, 'data', 'image-assets');
}

/** Absolute file path for an owner + key, or null if either part is unsafe. */
export function assetFilePath(ownerId: string, storageKey: string, cwd: string = process.cwd()): string | null {
  if (!SAFE_SEGMENT.test(ownerId) || !SAFE_KEY.test(storageKey)) return null;
  const root = path.resolve(imageAssetsRoot(cwd));
  const target = path.resolve(root, ownerId, storageKey);
  return path.dirname(target) === path.join(root, ownerId) ? target : null;
}

/** One owner's asset folder, or null for an unsafe id. */
export function assetOwnerDir(ownerId: string, cwd: string = process.cwd()): string | null {
  if (!SAFE_SEGMENT.test(ownerId)) return null;
  return path.join(path.resolve(imageAssetsRoot(cwd)), ownerId);
}

export function newStorageKey(ext: string): { id: string; storageKey: string } {
  const id = randomUUID();
  return { id, storageKey: `${id}.${ext}` };
}

/** Display name: base name only, no control characters, at most 120 characters. */
export function cleanAssetName(name: unknown, fallbackExt: string): string {
  const raw = typeof name === 'string' ? name : '';
  const base = raw.split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return cleaned || `asset.${fallbackExt}`;
}

export interface AssetActor {
  id: string;
  role: string;
}

export interface AssetRow {
  id: string;
  owner_id: string;
  owner_name?: string | null;
  original_name: string;
  mime_type: ImageAssetMime;
  file_size: number;
  width: number;
  height: number;
  shared: boolean;
  storage_key: string;
  created_at: string | Date;
}

export function canViewAsset(actor: AssetActor, row: Pick<AssetRow, 'owner_id' | 'shared'>): boolean {
  return actor.role === 'admin' || row.owner_id === actor.id || row.shared === true;
}

export function canManageAsset(actor: AssetActor, row: Pick<AssetRow, 'owner_id'>): boolean {
  return actor.role === 'admin' || row.owner_id === actor.id;
}

export function quotaAllows(usedBytes: number, addBytes: number, limit: number = IMAGE_ASSET_QUOTA_BYTES): boolean {
  return usedBytes + addBytes <= limit;
}

export function toAssetItem(actor: AssetActor, row: AssetRow): ImageAssetItem {
  return {
    id: row.id,
    name: row.original_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    width: Number(row.width),
    height: Number(row.height),
    shared: row.shared === true,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? null,
    mine: row.owner_id === actor.id,
    canManage: canManageAsset(actor, row),
    url: `/api/image-assets/${encodeURIComponent(row.id)}/file`,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_SEGMENT.test(value);
}
