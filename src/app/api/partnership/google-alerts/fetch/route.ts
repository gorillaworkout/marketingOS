import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { fetchGoogleAlertsNow } from '@/lib/partnership/google-alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** "Fetch now": reads the Google Alerts RSS feeds. Free (no treg, no model). Body: { feedId?: string } */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as { feedId?: unknown };
  const feedId = typeof body.feedId === 'string' && body.feedId ? body.feedId : null;
  const summary = await fetchGoogleAlertsNow({ feedId });
  if (!summary.feeds) return NextResponse.json({ error: feedId ? 'Feed not found.' : 'Add a Google Alerts RSS feed first.' }, { status: feedId ? 404 : 400 });
  return NextResponse.json(summary);
}
