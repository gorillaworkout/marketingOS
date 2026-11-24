import './load-env';
import { writeFile } from 'node:fs/promises';
import { closeDb } from '../src/lib/database';
import { createGoogleAdsClient } from '../src/lib/google-ads/client';
import { maskCustomerId, requireGoogleAdsConfig, sanitizeGoogleAdsError, secretValues } from '../src/lib/google-ads/config';
import { collectKeywordTrends, jakartaDate } from '../src/lib/keyword-trends/collector';
import { KEYWORD_TRENDS_CONFIG } from '../src/lib/keyword-trends/config';
import { buildKeywordTrendsWorkbook } from '../src/lib/keyword-trends/export';
import { runKeywordTrendsFetchNow } from '../src/lib/keyword-trends/service';

// Paid Media / Keyword Trends: Google Ads Keyword Planner -> PostgreSQL snapshot. Read-only on Google, free.
//
//   npm run keyword-trends:fetch                    fetch once and store a snapshot (trigger "cli")
//   npm run keyword-trends:fetch -- --scheduled     same, recorded as the monthly scheduled run
//   npm run keyword-trends:fetch -- --dry-run       fetch and compute only; no database writes; prints counts
//   npm run keyword-trends:fetch -- --dry-run --xlsx=/tmp/kt.xlsx   also write the 3-month Excel export
//
// Monthly VPS cron, the 3rd at 06:00 WIB (23:00 UTC on the 2nd). Not installed automatically; see docs/paid-media-keyword-trends.md:
// 0 23 2 * * cd /home/ubuntu/apps/marketingos && npm run keyword-trends:fetch -- --scheduled >> /home/ubuntu/logs/keyword-trends.log 2>&1
//
// Requires DATABASE_URL (except --dry-run) and the GOOGLE_ADS_* keys in .env.local. Values are never printed.

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

async function dryRun(): Promise<number> {
  const config = requireGoogleAdsConfig();
  const secrets = secretValues(config);
  try {
    const collected = await collectKeywordTrends(createGoogleAdsClient(config), config.loginCustomerId);
    console.log(`Dry run on ${collected.account.name || '(unnamed)'} ${maskCustomerId(collected.account.customerId)} [${collected.account.currencyCode}]: ${collected.ideasCount} keywords, ${collected.rows.length} monthly rows, ${collected.firstMonth} to ${collected.lastMonth}. Nothing is written to the database.`);
    const latest = collected.rows.filter(row => row.searchMonth === collected.lastMonth).sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches).slice(0, 5);
    for (const row of latest) console.log(`  ${row.keyword}: avg ${row.avgMonthlySearches}, ${row.searchMonth} ${row.monthlySearches} (${row.trendDirection}), ${row.competition ?? '-'}`);
    const xlsx = argValue('xlsx');
    if (xlsx) {
      const { buffer, months, rows } = await buildKeywordTrendsWorkbook(collected.rows, {
        reportDate: jakartaDate(), fetchedAt: new Date().toISOString(), accountName: collected.account.name, currencyCode: collected.account.currencyCode, config: KEYWORD_TRENDS_CONFIG,
      });
      await writeFile(xlsx, buffer);
      console.log(`Wrote ${xlsx}: ${rows} rows for ${months.join(', ')}.`);
    }
    return 0;
  } catch (error) {
    console.error(`Keyword Trends dry run failed: ${sanitizeGoogleAdsError(error, secrets)}`);
    return 1;
  }
}

async function main(): Promise<number> {
  if (process.argv.includes('--dry-run')) return dryRun();
  const result = await runKeywordTrendsFetchNow(process.argv.includes('--scheduled') ? 'scheduled' : 'cli');
  if (result.status === 'succeeded') {
    console.log(`Keyword Trends fetch succeeded: ${result.ideasCount} keywords, ${result.rowsCount} rows, ${result.firstMonth} to ${result.lastMonth} (snapshot ${result.snapshotId}).`);
    return 0;
  }
  console.error(`Keyword Trends fetch ${result.status}: ${result.error}`);
  return 1;
}

main()
  .then(async code => { await closeDb(); process.exitCode = code; })
  .catch(async error => { console.error(sanitizeGoogleAdsError(error)); await closeDb(); process.exitCode = 1; });
