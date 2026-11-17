import { after, NextRequest, NextResponse } from 'next/server';
import { partnershipCronAuthorization } from '@/lib/partnership/cron';
import { runDueMediaRefresh } from '@/lib/partnership/media-run';
import { runDueCompetitorRefreshes } from '@/lib/partnership/run';
import { runDueTrendsDigest } from '@/lib/partnership/trends-run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Weekly Competitor Intelligence refresh plus the Global Industry Trends digest and a
 * free-only Media Monitoring refresh, for an HTTP cron. Scheduled work uses free sources only.
 * Header: x-partnership-cron-secret: $PARTNERSHIP_CRON_SECRET. The work runs after the response.
 * The VPS can run `npm run partnership:refresh` instead.
 */
export async function POST(request: NextRequest) {
  const auth = partnershipCronAuthorization(request.headers.get('x-partnership-cron-secret'));
  if (auth === 'missing') {
    return NextResponse.json({ error: 'PARTNERSHIP_CRON_SECRET is not set. Run npm run partnership:refresh on the VPS instead.' }, { status: 503 });
  }
  if (auth === 'rejected') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  after(async () => {
    try {
      const summary = await runDueCompetitorRefreshes();
      console.log(`Partnership refresh: checked ${summary.checked}, refreshed ${summary.refreshed}, failed ${summary.failed}, skipped ${summary.skipped}.`);
    } catch (error) {
      console.error('Partnership refresh failed', error);
    }
    try {
      const trends = await runDueTrendsDigest();
      console.log(`Global Industry Trends: ${trends.status}${trends.reason ? ` (${trends.reason})` : ''}.`);
    } catch (error) {
      console.error('Global Industry Trends digest failed', error);
    }
    try {
      const media = await runDueMediaRefresh();
      console.log(`Media Monitoring: ${media.status}${media.reason ? ` (${media.reason})` : ''}.`);
    } catch (error) {
      console.error('Media Monitoring refresh failed', error);
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
