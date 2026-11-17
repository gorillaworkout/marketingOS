import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { readUserGeneratedImageMeta } from '@/lib/generated-image-meta';

/** The signed-in user's own Generate Image results, newest first. */
export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limit = Number.parseInt(request.nextUrl.searchParams.get('limit') || '30', 10);
  const images = readUserGeneratedImageMeta(auth.userId, Number.isFinite(limit) ? limit : 30);
  return NextResponse.json({ images }, { headers: { 'Cache-Control': 'no-store' } });
}
