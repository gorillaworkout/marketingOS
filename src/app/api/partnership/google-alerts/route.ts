import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { listAlertArticles, listAlertFeeds } from '@/lib/partnership/google-alerts-store';

export const dynamic = 'force-dynamic';

/** Feeds (with last fetch status) and the latest articles. ?feed=<id> filters to one alert. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const feedId = request.nextUrl.searchParams.get('feed') || null;
  const [feeds, articles] = await Promise.all([listAlertFeeds(), listAlertArticles({ feedId, limit: 200 })]);
  return NextResponse.json({ feeds, articles, feedId });
}
