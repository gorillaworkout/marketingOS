import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { readScreenshot, screenshotMime } from '@/lib/partnership/evidence';
import { getEvidence } from '@/lib/partnership/store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const evidence = await getEvidence(id);
  const bytes = evidence?.screenshotKey ? await readScreenshot(evidence.screenshotKey) : null;
  if (!evidence?.screenshotKey || !bytes) return NextResponse.json({ error: 'Screenshot not found.' }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'content-type': screenshotMime(evidence.screenshotKey), 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' },
  });
}
