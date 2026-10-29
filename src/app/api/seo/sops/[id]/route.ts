import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireFeature } from '@/lib/auth';
import { deleteSop, getSop, updateSop } from '@/lib/seo/sop-store';
import { parseSopInput } from '@/lib/seo/sops';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const sop = await getSop(id);
  if (!sop) return NextResponse.json({ error: 'SOP not found' }, { status: 404 });
  return NextResponse.json({ sop });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const input = parseSopInput(await request.json().catch(() => null));
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!await updateSop(id, input, auth.id)) return NextResponse.json({ error: 'SOP not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Admin only. Articles that followed the SOP keep their content; their sop_id becomes null. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!await deleteSop(id)) return NextResponse.json({ error: 'SOP not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
