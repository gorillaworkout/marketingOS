import 'dotenv/config';
import { closeDb } from '../src/lib/database';
import { runDueResearchWatches } from '../src/lib/ai-research-watch-run';

// Daily VPS cron (07:15 WIB):
// 15 0 * * * cd /path/to/marketingOS && npm run research:watches >> /var/log/research-watches.log 2>&1
// Requires DATABASE_URL and, preferably, SERPER_API_KEY. Without Serper, the check
// falls back to Indonesian Google News RSS. Paused watches are skipped.
// Alternative HTTP cron: POST /api/ai-research/watches/run
// with header x-research-watch-secret: $AI_RESEARCH_WATCH_CRON_SECRET

runDueResearchWatches()
  .then(async result => {
    console.log(`Research watches: checked ${result.checked}, failed ${result.failed}.`);
    await closeDb();
  })
  .catch(async error => {
    console.error(error);
    await closeDb();
    process.exitCode = 1;
  });
