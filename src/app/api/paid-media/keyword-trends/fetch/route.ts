import { after, NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { googleAdsConfigStatus } from '@/lib/google-ads/service';
import { runKeywordTrendsFetchNow } from '@/lib/keyword-trends/service';
import { runningSnapshot } from '@/lib/keyword-trends/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * "Fetch now": one Keyword Planner pull (forex + dupoin.com, Indonesia) stored
 * as a new snapshot. Read-only on Google Ads and free. Runs after the
 * response; the page polls GET /api/paid-media/keyword-trends for status.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const config = googleAdsConfigStatus();
  if (!config.configured) {
    return NextResponse.json({ error: `Google Ads is not configured on the server. Missing or invalid: ${[...config.missing, ...config.invalid].join(', ')}.` }, { status: 400 });
  }
  if (await runningSnapshot()) return NextResponse.json({ error: 'A Keyword Trends fetch is already running.' }, { status: 409 });
  after(async () => {
    try {
      const result = await runKeywordTrendsFetchNow('manual', auth.id);
      console.log(`Keyword Trends fetch (manual): ${result.status}${result.status === 'succeeded' ? `, ${result.ideasCount} keywords, ${result.rowsCount} rows` : `: ${result.error}`}`);
    } catch (error) {
      console.error('Keyword Trends fetch failed', error instanceof Error ? error.message : error);
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
