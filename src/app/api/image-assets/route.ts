import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedUser } from '@/lib/auth';
import { hasGenerationFeature } from '@/lib/authorization';
import { rateLimit } from '@/lib/rate-limit';
import { AssetError, cleanAssetName, newStorageKey, toAssetItem, validateAssetImage } from '@/lib/image-assets';
import { IMAGE_ASSET_MAX_BYTES, IMAGE_ASSET_QUOTA_BYTES, type ImageAssetListResponse } from '@/lib/image-assets-shared';
import { createAsset, getAsset, listOwnAssets, listSharedAssets, usedBytes } from '@/lib/image-assets-store';

/** Asset library: the viewer's own assets plus assets teammates shared. */
export async function GET(request: NextRequest) {
  const actor = await getAuthorizedUser(request);
  if ('error' in actor) return NextResponse.json({ error: actor.error }, { status: actor.status });
  if (!hasGenerationFeature(actor)) return NextResponse.json({ error: 'Forbidden: no generation feature enabled for your department' }, { status: 403 });
  const [mine, shared, used] = await Promise.all([listOwnAssets(actor.id), listSharedAssets(actor.id), usedBytes(actor.id)]);
  const body: ImageAssetListResponse = {
    mine: mine.map(row => toAssetItem(actor, row)),
    shared: shared.map(row => toAssetItem(actor, row)),
    usage: { bytes: used, limit: IMAGE_ASSET_QUOTA_BYTES },
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

/** Upload one image to the library (multipart: file, optional shared=true). */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return limited;
  const actor = await getAuthorizedUser(request);
  if ('error' in actor) return NextResponse.json({ error: actor.error }, { status: actor.status });
  if (!hasGenerationFeature(actor)) return NextResponse.json({ error: 'Forbidden: no generation feature enabled for your department' }, { status: 403 });
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > IMAGE_ASSET_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: 'Each asset must be 8 MB or smaller.' }, { status: 413 });
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose one PNG, JPEG, or WebP image.' }, { status: 400 });
    if (file.size > IMAGE_ASSET_MAX_BYTES) return NextResponse.json({ error: 'Each asset must be 8 MB or smaller.' }, { status: 413 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const image = await validateAssetImage(bytes);
    const { id, storageKey } = newStorageKey(image.ext);
    await createAsset({
      id,
      ownerId: actor.id,
      name: cleanAssetName(file.name, image.ext),
      mime: image.mime,
      bytes,
      width: image.width,
      height: image.height,
      shared: form.get('shared') === 'true',
      storageKey,
    });
    const row = await getAsset(id);
    return NextResponse.json({ asset: row ? toAssetItem(actor, row) : null }, { status: 201 });
  } catch (error) {
    if (error instanceof AssetError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[image-assets] upload failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The asset could not be saved.' }, { status: 500 });
  }
}
