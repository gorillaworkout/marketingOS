import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { parseTrendBrandInput } from '@/lib/partnership/trends';
import { DuplicateTrendBrandError, createTrendBrand, listTrendBrands } from '@/lib/partnership/trends-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ brands: await listTrendBrands(), canDelete: auth.role === 'admin' });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = parseTrendBrandInput(await request.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    return NextResponse.json({ id: await createTrendBrand(parsed.value, auth.id) }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateTrendBrandError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
