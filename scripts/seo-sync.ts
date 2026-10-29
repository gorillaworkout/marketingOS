import 'dotenv/config';
import { closeDb } from '../src/lib/database';
import { runSeoSyncForSite, syncableSiteIds } from '../src/lib/seo/sync-service';

// SEO OS: Search Console -> PostgreSQL sync.
//
//   npm run seo:sync                     re-pull the last 5 days for every active site with a GSC property
//   npm run seo:sync -- --backfill       pull 16 months, day by day (first run; takes a while)
//   npm run seo:sync -- --site=<site id> limit to one site (any site, active or not)
//
// Daily VPS cron, 08:30 WIB (01:30 UTC). Not installed automatically; see docs/seo-os/setup.md:
// 30 1 * * * cd /home/ubuntu/apps/marketingos && GSC_SA_KEY_PATH=/home/ubuntu/secrets/gsc-sa.json npm run seo:sync >> /home/ubuntu/logs/seo-sync.log 2>&1
//
// Requires DATABASE_URL and GSC_SA_KEY_PATH. The key file is never printed.

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<number> {
  const backfill = process.argv.includes('--backfill');
  const site = argValue('site');
  const siteIds = site ? [site] : await syncableSiteIds();
  if (!siteIds.length) {
    console.log('SEO sync: no active site has a GSC property yet. Set one in SEO OS settings.');
    return 0;
  }
  let failed = 0;
  for (const siteId of siteIds) {
    const result = await runSeoSyncForSite({
      siteId,
      mode: backfill ? 'backfill' : 'incremental',
      pauseMs: backfill ? 250 : 0,
      onDay: backfill ? (date, rows) => console.log(`  ${siteId} ${date}: ${rows} rows`) : undefined,
    });
    if (result.status === 'succeeded') {
      console.log(`SEO sync ${siteId}: ${result.daysSynced} days (${result.rangeStart} to ${result.rangeEnd}), ${result.rowsUpserted} rows.`);
    } else {
      failed += 1;
      console.error(`SEO sync ${siteId} ${result.status}: ${result.error}`);
    }
  }
  return failed ? 1 : 0;
}

main()
  .then(async code => { await closeDb(); process.exitCode = code; })
  .catch(async error => { console.error(error instanceof Error ? error.message : error); await closeDb(); process.exitCode = 1; });
