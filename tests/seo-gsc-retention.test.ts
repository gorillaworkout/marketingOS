import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gscRowsSql, prorateFactor, sourceKindForTable } from '../src/lib/seo/gsc-source';
import { monthsBetween, parseCutoff, retentionCutoff, RetentionError, UPSERT_MONTHLY_PAGE_SQL, UPSERT_MONTHLY_QUERY_SQL } from '../src/lib/seo/gsc-retention';
import { runSeoSync, skipRolledUpDates, type SeoSyncStore } from '../src/lib/seo/gsc-sync';
import type { GscClient } from '../src/lib/seo/gsc-client';

test('retention cutoff is the first of the month N months back, on the Pacific date', () => {
  assert.equal(retentionCutoff(new Date('2026-11-16T06:00:00Z'), 6), '2026-05-01');
  assert.equal(retentionCutoff(new Date('2026-11-16T06:00:00Z')), '2026-05-01');
  // 05:00 UTC on Dec 1 is still Nov 30 in Search Console's Pacific time.
  assert.equal(retentionCutoff(new Date('2026-12-01T05:00:00Z'), 6), '2026-05-01');
  assert.equal(retentionCutoff(new Date('2026-12-01T12:00:00Z'), 6), '2026-06-01');
  assert.equal(retentionCutoff(new Date('2026-03-10T00:00:00Z'), 12), '2025-03-01');
  assert.throws(() => retentionCutoff(new Date(), 0), RetentionError);
  assert.throws(() => retentionCutoff(new Date(), 16), RetentionError);
});

test('explicit cutoffs must be a real first-of-month date', () => {
  assert.equal(parseCutoff('2026-05-01'), '2026-05-01');
  for (const bad of ['2026-05-16', '2026-13-01', '2026-5-01', '2026-05-01T00:00:00Z', '', 'yesterday']) {
    assert.throws(() => parseCutoff(bad), RetentionError, bad);
  }
  assert.deepEqual(monthsBetween('2025-11-15', '2026-02-01'), ['2025-11-01', '2025-12-01', '2026-01-01']);
});

test('monthly upserts sum metrics, weight position by impressions and add onto an existing month', () => {
  for (const sql of [UPSERT_MONTHLY_QUERY_SQL, UPSERT_MONTHLY_PAGE_SQL]) {
    assert.match(sql, /date_trunc\('month', date\)::DATE/);
    assert.match(sql, /SUM\(clicks\), SUM\(impressions\)/);
    assert.match(sql, /SUM\(position \* impressions\) \/ NULLIF\(SUM\(impressions\), 0\), AVG\(position\)/);
    assert.match(sql, /date >= \?::DATE AND date < \?::DATE/);
    assert.match(sql, /clicks = seo_gsc_\w*monthly\.clicks \+ EXCLUDED\.clicks/);
    assert.match(sql, /days_present = seo_gsc_\w*monthly\.days_present \+ EXCLUDED\.days_present/);
    assert.doesNotMatch(sql, /VACUUM/i);
  }
  assert.match(UPSERT_MONTHLY_QUERY_SQL, /ON CONFLICT \(site_id, month, query, page\)/);
  assert.match(UPSERT_MONTHLY_PAGE_SQL, /ON CONFLICT \(site_id, month, page\)/);
});

test('a rolled-up month is prorated by the share of its covered dates inside the range', () => {
  const april = { firstDate: '2026-04-01', lastDate: '2026-04-30' };
  assert.equal(prorateFactor(april, { start: '2026-03-01', end: '2026-05-31' }), 1);
  assert.equal(prorateFactor(april, { start: '2026-04-01', end: '2026-04-30' }), 1);
  assert.equal(prorateFactor(april, { start: '2026-04-16', end: '2026-06-30' }), 15 / 30);
  assert.equal(prorateFactor(april, { start: '2026-05-01', end: '2026-05-31' }), 0);
  // Data that starts mid-month (first sync) covers only those dates.
  assert.equal(prorateFactor({ firstDate: '2025-07-15', lastDate: '2025-07-31' }, { start: '2025-07-01', end: '2025-07-31' }), 1);
});

test('report rows: site totals stay daily-only; query and page rows union daily with prorated months', () => {
  const range = { start: '2026-04-16', end: '2026-05-15' };
  const site = gscRowsSql('site', 's', range);
  assert.doesNotMatch(site.sql, /UNION|monthly/);
  assert.deepEqual(site.values, ['s', range.start, range.end]);
  for (const kind of ['query', 'page'] as const) {
    const rows = gscRowsSql(kind, 's', range);
    assert.match(rows.sql, /UNION ALL/);
    assert.match(rows.sql, kind === 'query' ? /FROM seo_gsc_monthly m/ : /FROM seo_gsc_page_monthly m/);
    assert.match(rows.sql, /seo_gsc_rollup_months/);
    assert.equal(rows.sql.match(/\?/g)?.length, rows.values.length);
  }
  assert.equal(sourceKindForTable('seo_gsc_daily'), 'query');
  assert.equal(sourceKindForTable('seo_gsc_page_daily'), 'page');
  assert.equal(sourceKindForTable('seo_gsc_site_daily'), 'site');
  assert.throws(() => sourceKindForTable('users'));
});

test('sync skips dates in rolled-up months, so a backfill cannot refill or double count them', async () => {
  assert.deepEqual(skipRolledUpDates(['2026-04-30', '2026-05-01', '2026-05-02'], ['2026-04-01']), ['2026-05-01', '2026-05-02']);
  assert.deepEqual(skipRolledUpDates(['2026-04-30'], []), ['2026-04-30']);

  const replaced: string[] = [];
  const store: SeoSyncStore = {
    getSite: async id => ({ id, name: 'Dupoin', site_url: 'https://dupoin.co.id/', gsc_property: 'sc-domain:dupoin.co.id', active: true }),
    startRun: async () => true,
    releaseStaleRuns: async () => {},
    replaceDay: async (_site, date) => { replaced.push(date); return 1; },
    finishRun: async () => {},
    markSiteSynced: async () => {},
    rolledUpMonths: async () => ['2026-03-01', '2026-04-01'],
  };
  const client: GscClient = { async query() { return []; } };
  const result = await runSeoSync({ siteId: 's', mode: 'backfill', dates: ['2026-03-31', '2026-04-15', '2026-05-01'] }, { store, createClient: async () => client, newId: () => 'r' });
  assert.equal(result.status, 'succeeded');
  assert.ok(result.status === 'succeeded' && result.skippedRolledUpDays === 2 && result.rangeStart === '2026-05-01');
  assert.deepEqual(replaced, ['2026-05-01']);
});

test('migration 060 is additive and idempotent, with a rollback; the CLI defaults to a dry run and loads .env.local', () => {
  const up = readFileSync('db/migrations/060_seo_gsc_monthly.sql', 'utf8');
  const executable = up.replace(/--.*$/gm, '');
  assert.match(up, /BEGIN;[\s\S]*COMMIT;/);
  for (const table of ['seo_gsc_monthly', 'seo_gsc_page_monthly', 'seo_gsc_rollup_months']) assert.match(up, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.doesNotMatch(executable, /DROP (TABLE|INDEX)|DELETE FROM|TRUNCATE|ALTER TABLE seo_gsc_daily|VACUUM/i);
  const down = readFileSync('db/rollbacks/060_seo_gsc_monthly_down.sql', 'utf8');
  assert.match(down, /DELETE FROM schema_migrations WHERE name = '060_seo_gsc_monthly.sql'/);

  const cli = readFileSync('scripts/seo-gsc-retention.ts', 'utf8');
  assert.match(cli, /^import '\.\/load-env';/);
  assert.match(cli, /const apply = process\.argv\.includes\('--apply'\)/);
  assert.doesNotMatch(cli, /(execute|query\w*)\([^)]*VACUUM/, 'the CLI never runs VACUUM');
  const env = readFileSync('scripts/load-env.ts', 'utf8');
  assert.ok(env.indexOf(`'.env.local'`) < env.indexOf(`'.env'`), '.env.local is loaded first so it wins over .env');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts['seo:gsc-retention'], 'tsx scripts/seo-gsc-retention.ts');
});
