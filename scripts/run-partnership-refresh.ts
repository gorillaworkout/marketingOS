import './load-env';
import { closeDb } from '../src/lib/database';
import { runDueCompetitorRefreshes } from '../src/lib/partnership/run';
import { runDueMediaRefresh } from '../src/lib/partnership/media-run';
import { runDueTrendsDigest } from '../src/lib/partnership/trends-run';

// Weekly VPS cron (Monday 07:30 WIB):
// 30 0 * * 1 cd /path/to/marketingOS && npm run partnership:refresh >> /var/log/partnership-refresh.log 2>&1
// Refreshes every active competitor whose last successful refresh is 7+ days old,
// then builds one 30-day Global Industry Trends digest when the last one is 7+ days old,
// then a free-only Media Monitoring refresh (no paid providers).
// Alternative HTTP cron: POST /api/partnership/cron/refresh
// with header x-partnership-cron-secret: $PARTNERSHIP_CRON_SECRET

async function main() {
  let failed = false;
  try {
    const summary = await runDueCompetitorRefreshes();
    console.log(`Partnership refresh: checked ${summary.checked}, refreshed ${summary.refreshed}, failed ${summary.failed}, skipped ${summary.skipped}.`);
  } catch (error) {
    console.error('Competitor refresh failed', error);
    failed = true;
  }
  // Runs even when the competitor refresh failed.
  const trends = await runDueTrendsDigest();
  console.log(`Global Industry Trends: ${trends.status}${trends.reason ? ` (${trends.reason})` : ''}.`);
  let media: Awaited<ReturnType<typeof runDueMediaRefresh>> = { status: 'failed' };
  try {
    media = await runDueMediaRefresh();
    console.log(`Media Monitoring: ${media.status}${media.reason ? ` (${media.reason})` : ''}.`);
  } catch (error) {
    console.error('Media Monitoring refresh failed', error);
  }
  if (failed || trends.status === 'failed' || media.status === 'failed') process.exitCode = 1;
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async error => {
    console.error(error);
    await closeDb();
    process.exitCode = 1;
  });
