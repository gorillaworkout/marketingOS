import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getGap } from '@/lib/seo/keyword-gap-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const gap = await getGap(id);
  if (!gap) return NextResponse.json({ error: 'Keyword gap not found' }, { status: 404 });
  return NextResponse.json({ gap });
}
