import './load-env';
import { closeDb } from '../src/lib/database';
import { createGoogleAdsClient } from '../src/lib/google-ads/client';
import { maskCustomerId, normalizeCustomerId, requireGoogleAdsConfig, sanitizeGoogleAdsError, secretValues } from '../src/lib/google-ads/config';
import { dateChunks, dateInTimeZone, discoverAccounts, fetchRangeSnapshot, syncRange, DEFAULT_TIME_ZONE } from '../src/lib/google-ads/sync';

// Paid Media / Google Ads: Google Ads API -> PostgreSQL sync. Read-only on Google, free.
//
//   npm run google-ads:sync                       last 14 days for every account (90 days for an account never synced)
//   npm run google-ads:sync -- --backfill         90 days for every account
//   npm run google-ads:sync -- --days=30          custom window (max 400)
//   npm run google-ads:sync -- --customer=1234567890   one account only
//   npm run google-ads:sync -- --dry-run          fetch and map only; no database writes; prints row counts
//   npm run google-ads:sync -- --alerts-only      recompute alerts from stored data (no Google Ads calls)
//
// After every sync that stores data, alerts are recomputed (see src/lib/google-ads/alerts.ts).
//
// Daily VPS cron, 09:00 WIB (02:00 UTC). Not installed automatically; see docs/paid-media-google-ads.md:
// 0 2 * * * cd /home/ubuntu/apps/marketingos && npm run google-ads:sync -- --scheduled >> /home/ubuntu/logs/google-ads-sync.log 2>&1
//
// Requires DATABASE_URL (except --dry-run) and the GOOGLE_ADS_* keys in .env.local. Values are never printed.

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

async function dryRun(days: number | undefined, backfill: boolean, only: string | null): Promise<number> {
  const config = requireGoogleAdsConfig();
  const secrets = secretValues(config);
  const client = createGoogleAdsClient(config);
  const accounts = await discoverAccounts(client, config.loginCustomerId, config.customerIds, secrets);
  console.log(`Dry run: ${accounts.length} client account(s) found (manager accounts skipped). Nothing is written.`);
  let failed = 0;
  for (const account of accounts) {
    if (only && account.customerId !== only) continue;
    const label = `${account.descriptiveName || '(unknown)'} ${maskCustomerId(account.customerId)} [${account.currencyCode || '?'}, ${account.timeZone || '?'}, source ${account.source}${account.testAccount ? ', TEST' : ''}]`;
    if (account.error) { failed += 1; console.log(`  ${label}: ERROR - ${account.error}`); continue; }
    if (account.skipReason) { console.log(`  ${label}: SKIPPED - ${account.skipReason}`); continue; }
    const range = syncRange(backfill ? 'backfill' : 'incremental', dateInTimeZone(new Date(), account.timeZone || DEFAULT_TIME_ZONE), { days, neverSynced: backfill });
    const counts = { campaigns: 0, adGroups: 0, keywords: 0, searchTerms: 0 };
    let costMicros = 0;
    try {
      for (const chunk of dateChunks(range.start, range.end)) {
        const snapshot = await fetchRangeSnapshot(client, account, chunk.start, chunk.end, () => new Promise(resolve => setTimeout(resolve, 150)));
        counts.campaigns += snapshot.campaigns.length; counts.adGroups += snapshot.adGroups.length;
        counts.keywords += snapshot.keywords.length; counts.searchTerms += snapshot.searchTerms.length;
        costMicros += snapshot.campaigns.reduce((sum, row) => sum + row.costMicros, 0);
      }
      console.log(`  ${label} ${range.start}..${range.end} (${range.days} days): campaign_daily ${counts.campaigns}, ad_group_daily ${counts.adGroups}, keyword_daily ${counts.keywords}, search_term_daily ${counts.searchTerms}; cost ${Math.round(costMicros / 1e6).toLocaleString('en-US')} ${account.currencyCode}`);
    } catch (error) {
      failed += 1;
      console.log(`  ${label}: FAILED - ${sanitizeGoogleAdsError(error, secrets)}`);
    }
  }
  return failed ? 1 : 0;
}

async function main(): Promise<number> {
  const backfill = process.argv.includes('--backfill');
  const daysArg = argValue('days');
  const days = daysArg ? Number(daysArg) : undefined;
  if (daysArg && (!Number.isFinite(days) || (days as number) < 1)) throw new Error('--days must be a positive number.');
  const customerArg = argValue('customer');
  const only = customerArg ? normalizeCustomerId(customerArg) : null;
  if (customerArg && !only) throw new Error('--customer must be a 10-digit customer id.');
  if (process.argv.includes('--dry-run')) return dryRun(days, backfill, only);
  if (process.argv.includes('--alerts-only')) {
    const { evaluateGoogleAdsAlerts } = await import('../src/lib/google-ads/alerts');
    const asOf = argValue('as-of');
    if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) { console.error('--as-of must be YYYY-MM-DD'); return 1; }
    const a = await evaluateGoogleAdsAlerts(asOf);
    console.log(`Google Ads alerts as of ${a.asOf}: ${a.detected} detected, ${a.opened} new, ${a.refreshed} still open, ${a.snoozed} snoozed, ${a.resolved} resolved.`);
    return 0;
  }

  const { evaluateAlertsAfterSync, runGoogleAdsSyncNow } = await import('../src/lib/google-ads/service');
  const result = await runGoogleAdsSyncNow({
    mode: backfill ? 'backfill' : 'incremental',
    trigger: process.argv.includes('--scheduled') ? 'scheduled' : 'cli',
    days,
    customerIds: only ? [only] : undefined,
    pauseMs: 200,
    onProgress: message => console.log(message),
  });
  if (result.status === 'busy') { console.error(`Google Ads sync: ${result.error}`); return 1; }
  for (const detail of result.details) {
    const rows = `campaigns ${detail.rows.campaigns}, ad groups ${detail.rows.adGroups}, keywords ${detail.rows.keywords}, search terms ${detail.rows.searchTerms}`;
    console.log(`  ${detail.name} ${maskCustomerId(detail.customerId)}: ${detail.status}${detail.rangeStart ? ` ${detail.rangeStart}..${detail.rangeEnd}` : ''}; ${rows}${detail.error ? `; ${detail.error}` : ''}`);
  }
  console.log(`Google Ads sync ${result.status}: ${result.accountsSynced} synced, ${result.accountsFailed} failed, ${result.rowsUpserted} rows.${result.error ? ` ${result.error}` : ''}`);
  // Daily alerts (in-app only) from the synced data: last 7 days vs the 28 before.
  const alerts = await evaluateAlertsAfterSync(result);
  if (alerts.evaluation) {
    const a = alerts.evaluation;
    console.log(`Google Ads alerts as of ${a.asOf}: ${a.detected} detected, ${a.opened} new, ${a.refreshed} still open, ${a.snoozed} snoozed, ${a.resolved} resolved.`);
  } else if (alerts.error) console.error(`Google Ads alerts failed: ${sanitizeGoogleAdsError(alerts.error)}`);
  return result.status === 'succeeded' ? 0 : 1;
}

main()
  .then(async code => { await closeDb(); process.exitCode = code; })
  .catch(async error => { console.error(sanitizeGoogleAdsError(error)); await closeDb(); process.exitCode = 1; });
