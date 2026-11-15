import 'dotenv/config';
import { closeDb } from '../src/lib/database';
import { runDueCompetitorRefreshes } from '../src/lib/partnership/run';

// Weekly VPS cron (Monday 07:30 WIB):
// 30 0 * * 1 cd /path/to/marketingOS && npm run partnership:refresh >> /var/log/partnership-refresh.log 2>&1
// Refreshes every active competitor whose last successful refresh is 7+ days old.
// Alternative HTTP cron: POST /api/partnership/cron/refresh
// with header x-partnership-cron-secret: $PARTNERSHIP_CRON_SECRET

runDueCompetitorRefreshes()
  .then(async summary => {
    console.log(`Partnership refresh: checked ${summary.checked}, refreshed ${summary.refreshed}, failed ${summary.failed}, skipped ${summary.skipped}.`);
    await closeDb();
  })
  .catch(async error => {
    console.error(error);
    await closeDb();
    process.exitCode = 1;
  });
