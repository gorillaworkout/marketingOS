import './load-env';
import { closeDb, executeTransaction, queryAll, queryOne } from '../src/lib/database';
import {
  DEFAULT_RETENTION_MONTHS, RetentionError, applyRetention, parseCutoff, planRetention, retentionCutoff, type RetentionPlan,
} from '../src/lib/seo/gsc-retention';

// SEO OS: Search Console data retention. Keeps query+page rows (seo_gsc_daily)
// and page rows (seo_gsc_page_daily) daily only from a month-aligned cutoff on;
// older rows are summed per month into seo_gsc_monthly / seo_gsc_page_monthly
// and the daily rows are deleted. Site totals (seo_gsc_site_daily) are kept.
//
//   npm run seo:gsc-retention                         dry run: last 6 full months + current month stay daily
//   npm run seo:gsc-retention -- --months=6           same, explicit
//   npm run seo:gsc-retention -- --cutoff=2026-05-01  dry run with an explicit cutoff (must be YYYY-MM-01)
//   npm run seo:gsc-retention -- --site=<site id>     one site (default: every site)
//   npm run seo:gsc-retention -- --apply              execute: one transaction per site
//   npm run seo:gsc-retention -- --apply --per-month  execute: one transaction per site and month (shorter locks, less WAL at once)
//
// Dry run is the default and only reads. Take a csv.gz backup of the slice
// before --apply (docs/seo-os/setup.md). This script never runs VACUUM; disk
// space returns only after a separate, manual VACUUM FULL.
// Requires DATABASE_URL (.env.local or .env).

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function formatPlan(plan: RetentionPlan): string {
  const lines = [`Site ${plan.siteId}: ${plan.queryRows} query+page rows and ${plan.pageRows} page rows before ${plan.cutoff} (${plan.clicks} clicks, ${plan.impressions} impressions) in ${plan.months.length} months.`];
  for (const month of plan.months) {
    lines.push(`  ${month.month.slice(0, 7)}: ${month.firstDate}..${month.lastDate}, ${month.days} days, ${month.queryRows} query+page rows, ${month.pageRows} page rows`);
  }
  return lines.join('\n');
}

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const perMonth = process.argv.includes('--per-month');
  const cutoffArg = argValue('cutoff');
  const monthsArg = argValue('months');
  if (cutoffArg && monthsArg) throw new RetentionError('Pass either --cutoff or --months, not both.');
  const latestAllowed = retentionCutoff(new Date(), 1);
  const cutoff = cutoffArg ? parseCutoff(cutoffArg) : retentionCutoff(new Date(), monthsArg === undefined ? DEFAULT_RETENTION_MONTHS : Number(monthsArg));
  if (cutoff > latestAllowed) throw new RetentionError(`--cutoff ${cutoff} is too recent: the previous full month must stay daily (latest allowed: ${latestAllowed}).`);

  const ready = await queryOne<{ monthly: string | null; months: string | null }>(`SELECT to_regclass('seo_gsc_monthly')::TEXT AS monthly, to_regclass('seo_gsc_rollup_months')::TEXT AS months`);
  if (!ready?.monthly || !ready.months) throw new RetentionError('Monthly tables are missing. Run npm run db:migrate (migration 060) first.');

  const site = argValue('site');
  const siteIds = site ? [site] : (await queryAll<{ id: string }>('SELECT id FROM seo_sites ORDER BY created_at, id')).map(row => row.id);
  if (site && !(await queryOne('SELECT id FROM seo_sites WHERE id = ?', [site]))) throw new RetentionError(`SEO site not found: ${site}`);

  console.log(`Search Console retention ${apply ? 'APPLY' : 'dry run'}: daily rows before ${cutoff} move to monthly.${apply ? '' : ' Nothing is changed; pass --apply to execute.'}`);
  let failed = 0;
  for (const siteId of siteIds) {
    try {
      const plan = await executeTransaction(db => planRetention(db, siteId, cutoff));
      console.log(formatPlan(plan));
      if (!apply || !plan.months.length) continue;
      const batches = perMonth ? plan.months.map(month => ({ from: month.month, before: nextMonth(month.month) })) : [{ from: undefined, before: cutoff }];
      let queryDeleted = 0;
      let pageDeleted = 0;
      let monthlyQuery = 0;
      let monthlyPage = 0;
      for (const batch of batches) {
        const result = await executeTransaction(db => applyRetention(db, siteId, batch.before, { from: batch.from }));
        queryDeleted += result.queryRowsDeleted;
        pageDeleted += result.pageRowsDeleted;
        monthlyQuery += result.monthlyQueryRowsUpserted;
        monthlyPage += result.monthlyPageRowsUpserted;
        if (perMonth) console.log(`  committed ${batch.from?.slice(0, 7)}: ${result.queryRowsDeleted} query+page and ${result.pageRowsDeleted} page rows rolled up`);
      }
      console.log(`Site ${siteId}: upserted ${monthlyQuery} monthly query+page rows and ${monthlyPage} monthly page rows; deleted ${queryDeleted} daily query+page rows and ${pageDeleted} daily page rows.`);
    } catch (error) {
      failed += 1;
      console.error(`Site ${siteId} failed (nothing from the failed transaction was kept): ${error instanceof Error ? error.message : error}`);
    }
  }
  if (apply) console.log('Done. Disk space is not returned until a manual VACUUM FULL (see docs/seo-os/setup.md).');
  return failed ? 1 : 0;
}

function nextMonth(month: string): string {
  const date = new Date(`${month}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

main()
  .then(async code => { await closeDb(); process.exitCode = code; })
  .catch(async error => { console.error(error instanceof Error ? error.message : error); await closeDb(); process.exitCode = 1; });
