import './load-env';
import { closeDb } from '../src/lib/database';
import { runDueMediaRefresh } from '../src/lib/partnership/media-run';

// Partnership > Media Monitoring, FREE SOURCES ONLY (Google Alerts RSS, Google News RSS,
// GDELT, YouTube Data API when YOUTUBE_API_KEY is set). Never calls treg.
// Suggested VPS cron, daily 06:00 WIB:
// 0 23 * * * cd /path/to/marketingOS && npm run media:refresh >> /var/log/media-refresh.log 2>&1
// Skips when a refresh succeeded in the last 12 hours. Also runs from npm run partnership:refresh.

async function main() {
  const summary = await runDueMediaRefresh();
  console.log(`Media Monitoring: ${summary.status}${summary.reason ? ` (${summary.reason})` : ''}.`);
  if (summary.status === 'failed') process.exitCode = 1;
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
