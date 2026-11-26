/** Client-safe constants and types for the Generate Image asset library. */
export const IMAGE_ASSET_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_ASSET_QUOTA_BYTES = 500 * 1024 * 1024;
export const IMAGE_ASSET_MAX_SIDE = 8000;
export const IMAGE_ASSET_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageAssetMime = (typeof IMAGE_ASSET_MIME_TYPES)[number];

export interface ImageAssetItem {
  id: string;
  name: string;
  mimeType: ImageAssetMime;
  fileSize: number;
  width: number;
  height: number;
  shared: boolean;
  ownerId: string;
  ownerName: string | null;
  mine: boolean;
  /** Owner or admin: may toggle sharing and delete. */
  canManage: boolean;
  url: string;
  createdAt: string;
}

export interface ImageAssetListResponse {
  mine: ImageAssetItem[];
  shared: ImageAssetItem[];
  usage: { bytes: number; limit: number };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
