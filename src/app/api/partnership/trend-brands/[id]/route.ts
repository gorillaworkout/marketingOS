import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { parseTrendBrandInput } from '@/lib/partnership/trends';
import { DuplicateTrendBrandError, deleteTrendBrand, getTrendBrand, updateTrendBrand } from '@/lib/partnership/trends-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!(await getTrendBrand(id))) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 });
  const parsed = parseTrendBrandInput(await request.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    await updateTrendBrand(id, parsed.value, auth.id);
  } catch (error) {
    if (error instanceof DuplicateTrendBrandError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'admin') return NextResponse.json({ error: 'Only an admin can delete a brand. Turn it off instead.' }, { status: 403 });
  const { id } = await context.params;
  if (!(await getTrendBrand(id))) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 });
  await deleteTrendBrand(id);
  return NextResponse.json({ success: true });
}
