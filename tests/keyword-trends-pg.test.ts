import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { Client } from 'pg';
import { monthlyTrendRows, type KeywordIdea } from '../src/lib/keyword-trends/metrics';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

function idea(keyword: string, avg: number, searches: number[], bids: [number | null, number | null] = [2_000_000_000, 5_000_000_000]): KeywordIdea {
  return {
    keyword, avgMonthlySearches: avg, competition: 'HIGH', competitionIndex: 80, lowTopOfPageBidMicros: bids[0], highTopOfPageBidMicros: bids[1],
    monthlyVolumes: searches.map((value, index) => ({ year: 2026, month: index + 1, searches: value })), concepts: ['Non-Brands'], discoverySources: ['keyword', 'site'],
  };
}

test('migration 068 + Keyword Trends store on PostgreSQL: lock, snapshot rows, export, rollback', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `ktrends_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('u1', 'bayu', 'Bayu', 'hash', 'admin');
    `);
    const up = readFileSync('db/migrations/068_keyword_trends.sql', 'utf8');
    await client.query(up);
    await client.query(up);

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const store = await import('../src/lib/keyword-trends/store');
    const service = await import('../src/lib/keyword-trends/service');
    const { KEYWORD_TRENDS_CONFIG } = await import('../src/lib/keyword-trends/config');
    const { closeDb } = await import('../src/lib/database');
    try {
      const start = (id: string) => store.postgresKeywordTrendsStore.startSnapshot({ id, trigger: 'manual', triggeredBy: 'u1', reportDate: '2026-11-03', config: KEYWORD_TRENDS_CONFIG });
      assert.equal(await start('s1'), true);
      assert.equal(await start('s2'), false, 'one running fetch at a time');
      assert.equal((await store.runningSnapshot())?.id, 's1');
      assert.equal(await service.exportKeywordTrends(null), null, 'nothing to export before a snapshot succeeds');

      const rows = monthlyTrendRows([
        idea('forex', 1000, [800, 900, 1000, 1100, 1200, 900, 1000, 1000, 1100, 1300, 1000, 700]),
        idea("trading o'clock", 50, [0, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 150], [null, null]),
      ], ['forex']);
      await store.postgresKeywordTrendsStore.completeSnapshot('s1', {
        account: { customerId: '4445556666', name: 'Dupoin-ID1', currencyCode: 'IDR', timeZone: 'Asia/Jakarta' }, ideasCount: 2, rows, firstMonth: '2026-01-01', lastMonth: '2026-12-01',
      });
      const latest = await store.latestSucceededSnapshot();
      assert.equal(latest?.id, 's1');
      assert.equal(latest?.status, 'succeeded');
      assert.equal(latest?.reportDate, '2026-11-03');
      assert.equal(latest?.rowsCount, 24);
      assert.equal(latest?.triggeredBy, 'Bayu');
      assert.equal(latest?.lastMonth, '2026-12-01');
      assert.equal(latest?.config.pageUrl, 'https://dupoin.com/');

      const stored = await store.snapshotRows('s1');
      assert.equal(stored.length, 24);
      const back = new Map(stored.map(row => [`${row.keyword}|${row.searchMonth}`, row]));
      for (const row of rows) assert.deepEqual(back.get(`${row.keyword}|${row.searchMonth}`), row, `${row.keyword} ${row.searchMonth} round-trips`);
      assert.deepEqual(await store.snapshotMonths('s1').then(list => list.slice(-3)), ['2026-10-01', '2026-11-01', '2026-12-01']);

      const data = await service.getKeywordTrendsData();
      assert.equal(data.keywords.length, 2);
      assert.equal(data.months.length, 12);
      assert.equal(data.keywords[0].keyword, 'forex');
      assert.equal(data.keywords[0].lastMonthSearches, 700);
      assert.equal(data.keywords[0].trendDirection, 'FALLING');
      assert.equal(data.keywords[0].lowTopOfPageBid, 2000);
      assert.equal(data.running, null);

      const exported = await service.exportKeywordTrends(null);
      assert.ok(exported);
      assert.equal(exported.filename, 'keyword-planner-monthly-trend-20261103.xlsx');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(exported.buffer as unknown as ArrayBuffer);
      assert.equal(workbook.getWorksheet('Detail')!.rowCount, 7, '2 keywords x 3 months + header');

      assert.equal(await start('s3'), true);
      await store.postgresKeywordTrendsStore.failSnapshot('s3', 'Google Ads API 403 authorizationError.DEVELOPER_TOKEN_NOT_APPROVED');
      const runs = await store.recentSnapshots();
      assert.equal(runs[0].status, 'failed');
      assert.match(runs[0].error ?? '', /DEVELOPER_TOKEN_NOT_APPROVED/);
      assert.equal((await store.latestSucceededSnapshot())?.id, 's1', 'a failed fetch keeps the previous snapshot on the page');

      // Stale running snapshot is released.
      await client.query(`INSERT INTO keyword_trend_snapshots (id, status, report_date, started_at) VALUES ('old', 'running', '2026-11-01', CURRENT_TIMESTAMP - INTERVAL '2 hours')`);
      assert.equal(await start('s4'), true);
      assert.equal((await client.query(`SELECT status FROM keyword_trend_snapshots WHERE id = 'old'`)).rows[0].status, 'failed');
    } finally {
      await closeDb();
    }

    await client.query(readFileSync('db/rollbacks/068_keyword_trends_down.sql', 'utf8'));
    const left = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'keyword_trend%'`, [schema]);
    assert.equal(left.rowCount, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
