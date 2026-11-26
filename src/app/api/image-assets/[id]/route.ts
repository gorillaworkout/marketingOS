import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedUser } from '@/lib/auth';
import { canManageAsset, isAssetId, toAssetItem } from '@/lib/image-assets';
import { deleteAsset, getAsset, setAssetShared } from '@/lib/image-assets-store';
import { rateLimit } from '@/lib/rate-limit';

type RouteContext = { params: Promise<{ id: string }> };

/** Owner or admin: toggle "Shared with team". Body: { shared: boolean }. */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const actor = await getAuthorizedUser(request);
  if ('error' in actor) return NextResponse.json({ error: actor.error }, { status: actor.status });
  const { id } = await params;
  if (!isAssetId(id)) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
  const body = await request.json().catch(() => null) as { shared?: unknown } | null;
  if (typeof body?.shared !== 'boolean') return NextResponse.json({ error: 'shared must be true or false.' }, { status: 400 });
  const row = await getAsset(id);
  if (!row) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
  if (!canManageAsset(actor, row)) return NextResponse.json({ error: 'Only the owner or an admin can change this asset.' }, { status: 403 });
  await setAssetShared(id, body.shared);
  return NextResponse.json({ asset: toAssetItem(actor, { ...row, shared: body.shared }) });
}

/** Owner or admin: permanent delete of the row and the file. */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const limited = rateLimit(request);
  if (limited) return limited;
  const actor = await getAuthorizedUser(request);
  if ('error' in actor) return NextResponse.json({ error: actor.error }, { status: actor.status });
  const { id } = await params;
  if (!isAssetId(id)) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
  const row = await getAsset(id);
  if (!row) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
  if (!canManageAsset(actor, row)) return NextResponse.json({ error: 'Only the owner or an admin can delete this asset.' }, { status: 403 });
  await deleteAsset(row);
  return NextResponse.json({ ok: true });
}
