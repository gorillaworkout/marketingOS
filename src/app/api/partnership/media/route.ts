import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { buildMediaDashboard, parseDateRange } from '@/lib/partnership/media';
import { alertFeedsSummary, listAlertFeeds } from '@/lib/partnership/google-alerts-store';
import { expireStaleMediaRuns, getMediaSettings, latestMediaInsights, listMediaRuns, listMentionsInRange } from '@/lib/partnership/media-store';

export const dynamic = 'force-dynamic';

/** Dashboard for ?from=YYYY-MM-DD&to=YYYY-MM-DD (default last 30 days), settings, runs and mentions. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const range = parseDateRange(params.get('from'), params.get('to'));
  await expireStaleMediaRuns();
  const [settings, mentions, runs, insights, feeds] = await Promise.all([getMediaSettings(), listMentionsInRange(range), listMediaRuns(15), latestMediaInsights(range), listAlertFeeds()]);
  const dashboard = buildMediaDashboard(mentions, range, settings.adValue);
  const running = runs.find(run => run.status === 'queued' || run.status === 'running') ?? null;
  return NextResponse.json({
    range, settings, dashboard, insights, runs, running,
    mentions: mentions.slice(0, 300),
    sources: { youtubeConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()), googleAlerts: alertFeedsSummary(feeds) },
  });
}
