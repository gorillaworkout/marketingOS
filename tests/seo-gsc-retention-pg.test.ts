import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';
const SITE = '00000000-0000-0000-0000-000000000101';
const CUTOFF = '2026-05-01';
const A = 'https://indonesiancheer.org/a';
const B = 'https://indonesiancheer.org/b';

// [date, query, page, clicks, impressions, position]
const QUERY_ROWS: Array<[string, string, string, number, number, number]> = [
  ['2026-03-15', 'uniform', A, 5, 50, 3],
  ['2026-04-10', 'cheer', A, 2, 10, 5],
  ['2026-04-20', 'cheer', A, 1, 30, 15],
  ['2026-04-10', 'cheer', B, 0, 0, 7], // zero impressions: monthly position falls back to the plain average
  ['2026-05-02', 'cheer', A, 4, 20, 10], // after the cutoff: stays daily
];
const PAGE_ROWS: Array<[string, string, number, number, number]> = [
  ['2026-03-15', A, 5, 50, 3],
  ['2026-04-10', A, 2, 10, 5],
  ['2026-04-20', A, 1, 30, 15],
  ['2026-05-02', A, 4, 20, 10],
];

test('migration 060 + retention: monthly roll-up keeps report, opportunity and keyword-gap numbers; sync cannot refill; rollback', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `gsc_retention_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE departments (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]);
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
    `);
    await client.query(readFileSync('db/migrations/035_seo_os.sql', 'utf8'));
    await client.query(readFileSync('db/migrations/036_seo_opportunities.sql', 'utf8'));
    const up = readFileSync('db/migrations/060_seo_gsc_monthly.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('060_seo_gsc_monthly.sql')`);
    await assert.rejects(client.query(`INSERT INTO seo_gsc_monthly (site_id, month, query, page) VALUES ('${SITE}', '2026-04-15', 'q', 'p')`), 'month must be the 1st');

    for (const [date, query, page, clicks, impressions, position] of QUERY_ROWS) {
      await client.query(`INSERT INTO seo_gsc_daily (site_id, date, query, page, clicks, impressions, ctr, position) VALUES ($1, $2, $3, $4, $5, $6, 0, $7)`, [SITE, date, query, page, clicks, impressions, position]);
    }
    for (const [date, page, clicks, impressions, position] of PAGE_ROWS) {
      await client.query(`INSERT INTO seo_gsc_page_daily (site_id, date, page, clicks, impressions, ctr, position) VALUES ($1, $2, $3, $4, $5, 0, $6)`, [SITE, date, page, clicks, impressions, position]);
      await client.query(`INSERT INTO seo_gsc_site_daily (site_id, date, clicks, impressions, ctr, position) VALUES ($1, $2, $3, $4, 0, $5)`, [SITE, date, clicks + 1, impressions + 5, position]);
    }
    await client.query(`INSERT INTO seo_keywords (id, site_id, keyword, keyword_normalized) VALUES ('k1', $1, 'uniform', 'uniform')`, [SITE]);

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const { closeDb, executeTransaction } = await import('../src/lib/database');
    const report = await import('../src/lib/seo/report');
    const { getOpportunities } = await import('../src/lib/seo/opportunities');
    const { loadStoredGscQueries, countStoredGscRows } = await import('../src/lib/seo/keyword-gap-gsc');
    const { planRetention, applyRetention, RetentionError } = await import('../src/lib/seo/gsc-retention');
    const { postgresSeoSyncStore, replaceDayInTransaction } = await import('../src/lib/seo/gsc-store');
    try {
      const full = { start: '2026-03-01', end: '2026-05-31' };
      const partial = { start: '2026-04-15', end: '2026-05-31' };
      const now = new Date('2026-06-15T00:00:00Z');
      const snapshot = async () => ({
        siteTotals: await report.getTotals(SITE, full, {}),
        queryTotals: await report.getTotals(SITE, full, { query: 'cheer' }),
        pageTotals: await report.getTotals(SITE, full, { page: '/a' }),
        topQueries: await report.getTopRows(SITE, full, {}, 'query'),
        topPages: await report.getTopRows(SITE, full, {}, 'page'),
        opportunities: await getOpportunities(SITE, full),
        keywordGap: await loadStoredGscQueries(SITE, now),
        siteTrend: await report.getTrend(SITE, full, {}),
      });
      const before = await snapshot();
      assert.deepEqual(before.queryTotals, { clicks: 7, impressions: 60, ctr: 7 / 60, position: 700 / 60 });
      assert.equal(before.opportunities.push[0]?.query, 'cheer');
      const partialBefore = await report.getTotals(SITE, partial, { query: 'cheer' });
      assert.equal(partialBefore.clicks, 5); // daily: Apr 20 (1) + May 2 (4)

      // Dry run reads only.
      const plan = await executeTransaction(db => planRetention(db, SITE, CUTOFF));
      assert.deepEqual(plan.months.map(month => [month.month, month.firstDate, month.lastDate, month.days, month.queryRows, month.pageRows]), [
        ['2026-03-01', '2026-03-15', '2026-03-15', 1, 1, 1],
        ['2026-04-01', '2026-04-10', '2026-04-20', 2, 3, 2],
      ]);
      assert.equal(plan.clicks, 8);
      assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM seo_gsc_daily`)).rows[0].n, 5);

      // A running sync blocks the roll-up.
      await client.query(`INSERT INTO seo_sync_runs (id, site_id, mode, status) VALUES ('run-1', $1, 'backfill', 'running')`, [SITE]);
      await assert.rejects(executeTransaction(db => applyRetention(db, SITE, CUTOFF)), RetentionError);
      await client.query(`UPDATE seo_sync_runs SET status = 'succeeded' WHERE id = 'run-1'`);

      const result = await executeTransaction(db => applyRetention(db, SITE, CUTOFF, { now }));
      assert.equal(result.queryRowsDeleted, 4);
      assert.equal(result.pageRowsDeleted, 3);
      assert.equal(result.monthlyQueryRowsUpserted, 3);
      assert.equal(result.monthlyPageRowsUpserted, 2);
      assert.deepEqual((await client.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM seo_gsc_daily`)).rows, [{ d: '2026-05-02' }]);
      assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM seo_gsc_site_daily`)).rows[0].n, 4, 'site totals are never touched');
      const monthly = await client.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month, query, page, clicks::int, impressions::int, ctr, position, days_present FROM seo_gsc_monthly ORDER BY month, query, page`);
      assert.deepEqual(monthly.rows, [
        { month: '2026-03-01', query: 'uniform', page: A, clicks: 5, impressions: 50, ctr: 0.1, position: 3, days_present: 1 },
        { month: '2026-04-01', query: 'cheer', page: A, clicks: 3, impressions: 40, ctr: 3 / 40, position: 12.5, days_present: 2 },
        { month: '2026-04-01', query: 'cheer', page: B, clicks: 0, impressions: 0, ctr: 0, position: 7, days_present: 1 },
      ]);

      // Same numbers after the roll-up for a range made of whole months.
      const after = await snapshot();
      assert.deepEqual(after.siteTotals, before.siteTotals);
      assert.deepEqual(after.queryTotals, before.queryTotals);
      assert.deepEqual(after.pageTotals, before.pageTotals);
      assert.deepEqual(after.topQueries, before.topQueries);
      assert.deepEqual(after.topPages, before.topPages);
      assert.deepEqual(after.opportunities, before.opportunities);
      assert.deepEqual(after.keywordGap, before.keywordGap);
      assert.deepEqual(after.siteTrend, before.siteTrend, 'unfiltered trend uses site totals and stays daily');
      assert.ok(await countStoredGscRows(SITE) > 0);

      // A range that starts mid-month prorates that month by covered dates: April covers Apr 10-20 (11 days), 6 of them in range.
      const partialAfter = await report.getTotals(SITE, partial, { query: 'cheer' });
      assert.equal(partialAfter.clicks, Math.round(3 * 6 / 11 + 4));
      assert.equal(partialAfter.impressions, Math.round(40 * 6 / 11 + 20));

      // Filtered trend: one point per rolled-up month at daily scale, daily points after the cutoff.
      const trend = await report.getTrend(SITE, full, { page: '/a' });
      assert.deepEqual(trend.map(point => [point.date, point.granularity, point.days]), [
        ['2026-03-15', 'month', 1], ['2026-04-10', 'month', 11], ['2026-05-02', 'day', 1],
      ]);
      assert.equal(trend[1].clicks, 3 / 11);
      assert.equal(trend[1].position, 12.5);
      assert.equal(trend[2].clicks, 4);

      // Previous-period comparison across the cutoff still works.
      const range = report.resolveReportRange({ start: '2026-05-01', end: '2026-05-31' }, '2026-05-31');
      assert.deepEqual(range.previous, { start: '2026-03-31', end: '2026-04-30' });
      assert.equal((await report.getTotals(SITE, range.previous, { query: 'cheer' })).clicks, 3);

      // Untargeted keywords see rolled-up months too.
      assert.equal((await getOpportunities(SITE, { start: '2026-03-01', end: '2026-03-31' })).untargetedKeywords.length, 0);
      assert.deepEqual((await getOpportunities(SITE, { start: '2026-05-01', end: '2026-05-31' })).untargetedKeywords.map(row => row.keyword), ['uniform']);

      // Idempotent: a second run changes nothing.
      const again = await executeTransaction(db => applyRetention(db, SITE, CUTOFF, { now }));
      assert.equal(again.months.length, 0);
      assert.equal(again.queryRowsDeleted, 0);
      assert.deepEqual((await client.query(`SELECT clicks::int FROM seo_gsc_monthly ORDER BY month, query, page`)).rows.map(row => row.clicks), [5, 3, 0]);

      // The sync never writes daily rows into a rolled-up month.
      assert.deepEqual(await postgresSeoSyncStore.rolledUpMonths?.(SITE), ['2026-03-01', '2026-04-01']);
      const day = { site: [{ date: '2026-04-25', clicks: 9, impressions: 9, ctr: 1, position: 1 }], pages: [], queryPages: [{ date: '2026-04-25', query: 'cheer', page: A, clicks: 9, impressions: 9, ctr: 1, position: 1 }] };
      assert.equal(await executeTransaction(db => replaceDayInTransaction(db, SITE, '2026-04-25', day, now)), 0);
      assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM seo_gsc_daily WHERE date = '2026-04-25'`)).rows[0].n, 0);

      // Rows that do reappear in a rolled-up month are added on, and the coverage widens.
      await client.query(`INSERT INTO seo_gsc_daily (site_id, date, query, page, clicks, impressions, ctr, position) VALUES ($1, '2026-04-25', 'cheer', $2, 1, 10, 0.1, 2)`, [SITE, A]);
      await executeTransaction(db => applyRetention(db, SITE, CUTOFF, { now }));
      const merged = await client.query(`SELECT clicks::int, impressions::int, position, days_present FROM seo_gsc_monthly WHERE month = '2026-04-01' AND query = 'cheer' AND page = $1`, [A]);
      assert.deepEqual(merged.rows[0], { clicks: 4, impressions: 50, position: (12.5 * 40 + 2 * 10) / 50, days_present: 3 });
      const coverage = await client.query(`SELECT to_char(first_date, 'YYYY-MM-DD') AS f, to_char(last_date, 'YYYY-MM-DD') AS l, days FROM seo_gsc_rollup_months WHERE month = '2026-04-01'`);
      assert.deepEqual(coverage.rows[0], { f: '2026-04-10', l: '2026-04-25', days: 3 });

      // Cutoffs must be month-aligned.
      await assert.rejects(executeTransaction(db => applyRetention(db, SITE, '2026-05-16')), RetentionError);
    } finally {
      await closeDb();
    }

    await client.query(readFileSync('db/rollbacks/060_seo_gsc_monthly_down.sql', 'utf8'));
    for (const table of ['seo_gsc_monthly', 'seo_gsc_page_monthly', 'seo_gsc_rollup_months']) {
      assert.equal((await client.query(`SELECT to_regclass($1) AS name`, [table])).rows[0].name, null);
    }
    assert.equal((await client.query(`SELECT name FROM schema_migrations WHERE name = '060_seo_gsc_monthly.sql'`)).rowCount, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
