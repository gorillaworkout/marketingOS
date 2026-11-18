import { after, NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { evaluateAlertsAfterSync, googleAdsConfigStatus, runGoogleAdsSyncNow } from '@/lib/google-ads/service';
import { runningSync } from '@/lib/google-ads/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * "Sync now": incremental (last 14 days) for every account; an account that
 * never synced gets its 90-day backfill. Read-only on Google Ads and free.
 * The work runs after the response; the page polls /overview for status.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const config = googleAdsConfigStatus();
  if (!config.configured) {
    return NextResponse.json({ error: `Google Ads is not configured on the server. Missing or invalid: ${[...config.missing, ...config.invalid].join(', ')}.` }, { status: 400 });
  }
  if (await runningSync()) return NextResponse.json({ error: 'A Google Ads sync is already running.' }, { status: 409 });
  after(async () => {
    try {
      const result = await runGoogleAdsSyncNow({ mode: 'incremental', trigger: 'manual', triggeredBy: auth.id });
      console.log(`Google Ads sync (manual): ${result.status}${'rowsUpserted' in result ? `, ${result.rowsUpserted} rows` : ''}.`);
      const alerts = await evaluateAlertsAfterSync(result);
      if (alerts.error) console.error('Google Ads alerts failed', alerts.error);
    } catch (error) {
      console.error('Google Ads sync failed', error instanceof Error ? error.message : error);
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
