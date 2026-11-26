import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedUser } from '@/lib/auth';
import { assetFilePath, canViewAsset, isAssetId } from '@/lib/image-assets';
import { getAsset } from '@/lib/image-assets-store';

type RouteContext = { params: Promise<{ id: string }> };

/** Authenticated bytes for one asset: own, shared with the team, or any for an admin. */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const actor = await getAuthorizedUser(request);
  if ('error' in actor) return NextResponse.json({ error: actor.error }, { status: actor.status });
  const { id } = await params;
  if (!isAssetId(id)) return new NextResponse('Not found', { status: 404 });
  const row = await getAsset(id);
  // Same 404 for "missing" and "not yours" so ids cannot be probed.
  if (!row || !canViewAsset(actor, row)) return new NextResponse('Not found', { status: 404 });
  const file = assetFilePath(row.owner_id, row.storage_key);
  if (!file || !fs.existsSync(file)) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(fs.readFileSync(file), {
    headers: {
      'Content-Type': row.mime_type,
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `inline; filename="${row.id}.${row.storage_key.split('.').pop()}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
