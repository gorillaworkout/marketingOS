import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { createSop, listSops } from '@/lib/seo/sop-store';
import { parseSopInput } from '@/lib/seo/sops';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ sops: await listSops() });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const input = parseSopInput(await request.json().catch(() => null));
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  return NextResponse.json({ id: await createSop(input, auth.id) }, { status: 201 });
}
