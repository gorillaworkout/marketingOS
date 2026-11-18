import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 066 + Google Ads store/report on PostgreSQL: idempotent upserts, stale rows dropped, report totals, rollback', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `gads_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT departments_permitted_features_valid CHECK (permitted_features <@ ARRAY['social-post','seo','partnership']::TEXT[])
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('admin-1', 'admin', 'Admin', 'hash', 'admin');
      INSERT INTO departments (id, name, permitted_features) VALUES ('d1', 'Marketing', ARRAY['social-post']);
    `);
    const up = readFileSync('db/migrations/066_paid_media_google_ads.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    const department = await client.query(`SELECT permitted_features FROM departments WHERE name = 'Paid Media'`);
    assert.deepEqual(department.rows[0].permitted_features, ['google-ads']);
    await client.query(`UPDATE departments SET permitted_features = ARRAY['social-post', 'google-ads'] WHERE id = 'd1'`);
    await assert.rejects(client.query(`INSERT INTO google_ads_accounts (customer_id) VALUES ('123')`), 'customer_id must be 10 digits');

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const { postgresGoogleAdsSyncStore: store } = await import('../src/lib/google-ads/store');
    const report = await import('../src/lib/google-ads/report');
    const { closeDb } = await import('../src/lib/database');
    try {
      const account = { customerId: '4445556666', descriptiveName: 'Dupoin-ID1', currencyCode: 'IDR', timeZone: 'Asia/Jakarta', status: 'ENABLED', testAccount: false, manager: false, level: 1, source: 'mcc' as const, error: null, loginCustomerId: '1112223333' };
      await store.upsertAccounts([account, { ...account, customerId: '5556667777', descriptiveName: 'Dupoin-ID2', error: 'Google Ads API 403: denied' }], new Date());
      assert.equal(await store.startRun({ id: 'r1', mode: 'backfill', trigger: 'cli', rangeStart: '2026-11-01', rangeEnd: '2026-11-07', triggeredBy: 'admin-1' }), true);
      assert.equal(await store.startRun({ id: 'r2', mode: 'incremental', trigger: 'manual', rangeStart: null, rangeEnd: null, triggeredBy: null }), false, 'one running sync at a time');

      const metrics = (cost: number) => ({ impressions: 1000, clicks: 50, costMicros: cost, conversions: 5, conversionsValue: 0 });
      const snapshot = {
        campaigns: [
          { date: '2026-11-01', campaignId: '10', campaignName: 'Brand', campaignStatus: 'ENABLED', channelType: 'SEARCH', ...metrics(100_000_000_000) },
          { date: '2026-11-02', campaignId: '10', campaignName: 'Brand v2', campaignStatus: 'ENABLED', channelType: 'SEARCH', ...metrics(150_000_000_000) },
          { date: '2026-11-02', campaignId: '11', campaignName: 'Old', campaignStatus: 'PAUSED', channelType: 'DISPLAY', ...metrics(1_000_000) },
        ],
        adGroups: [{ date: '2026-11-02', adGroupId: '20', campaignId: '10', adGroupName: 'AG Brand', adGroupStatus: 'ENABLED', ...metrics(1) }],
        keywords: [{ date: '2026-11-02', adGroupId: '20', criterionId: '30', campaignId: '10', keywordText: 'dupoin', matchType: 'EXACT', criterionStatus: 'ENABLED', ...metrics(9_000_000) }],
        searchTerms: [{ date: '2026-11-02', adGroupId: '20', searchTerm: 'dupoin login', matchType: 'EXACT', campaignId: '10', termStatus: 'NONE', ...metrics(4_000_000) }],
      };
      const firstCounts = await store.replaceRange('4445556666', '2026-11-01', '2026-11-07', snapshot, new Date('2026-11-18T00:00:00Z'));
      assert.deepEqual(firstCounts, { campaigns: 3, adGroups: 1, keywords: 1, searchTerms: 1 });
      // Re-run with the same data: same row counts in the table (upsert, not insert).
      await store.replaceRange('4445556666', '2026-11-01', '2026-11-07', snapshot, new Date('2026-11-18T01:00:00Z'));
      // Third run: campaign 11 no longer returned -> its row in the range is removed.
      await store.replaceRange('4445556666', '2026-11-01', '2026-11-07', { ...snapshot, campaigns: snapshot.campaigns.slice(0, 2) }, new Date('2026-11-18T02:00:00Z'));
      const counts = await client.query(`SELECT (SELECT COUNT(*) FROM google_ads_campaign_daily)::int AS c, (SELECT COUNT(*) FROM google_ads_keyword_daily)::int AS k, (SELECT COUNT(*) FROM google_ads_search_term_daily)::int AS s`);
      assert.deepEqual(counts.rows[0], { c: 2, k: 1, s: 1 });
      await store.markAccountSynced('4445556666', { at: new Date(), error: null, firstSyncedDate: '2026-11-01' });
      await store.markAccountSynced('4445556666', { at: new Date(), error: null, firstSyncedDate: '2026-11-05' });
      assert.deepEqual(await store.accountStates().then(states => states.find(state => state.customerId === '4445556666')), { customerId: '4445556666', firstSyncedDate: '2026-11-01', active: true });
      await store.finishRun('r1', { status: 'partial', accountsSynced: 1, accountsFailed: 1, rowsUpserted: 6, details: [{ customerId: '5556667777', name: 'Dupoin-ID2', status: 'failed', rangeStart: null, rangeEnd: null, rows: { campaigns: 0, adGroups: 0, keywords: 0, searchTerms: 0 }, error: 'Google Ads API 403: denied' }], error: '1 account(s) failed.' });

      const result = await report.getGoogleAdsReport({ start: '2026-11-01', end: '2026-11-07', account: 'all' });
      assert.equal(result.totals.current.cost, 250_000);
      assert.equal(result.totals.current.impressions, 2000);
      assert.equal(result.totals.current.ctr, 0.05);
      assert.equal(result.totals.current.avgCpc, 2500);
      assert.equal(result.totals.current.costPerConversion, 25_000);
      assert.deepEqual(result.trend.map(point => point.date), ['2026-11-01', '2026-11-02']);
      assert.equal(result.campaigns.length, 1);
      assert.equal(result.campaigns[0].campaignName, 'Brand v2', 'latest name wins');
      assert.equal(result.keywords[0].adGroupName, 'AG Brand');
      assert.equal(result.searchTerms[0].campaignName, 'Brand v2');
      assert.deepEqual(result.currencies, ['IDR']);
      const one = await report.getGoogleAdsReport({ start: '2026-11-01', end: '2026-11-07', account: '5556667777' });
      assert.equal(one.totals.current.cost, 0);
      const accounts = await report.listAccounts();
      assert.equal(accounts.find(item => item.customerId === '5556667777')!.lastError, 'Google Ads API 403: denied');
      assert.deepEqual([accounts[0].dataFrom, accounts[0].dataThrough], ['2026-11-01', '2026-11-02']);
      const runs = await report.recentRuns();
      assert.equal(runs[0].status, 'partial');
      assert.equal(runs[0].details[0].customerId, '5556667777');
      const csv = await report.exportCsv('campaigns', { start: '2026-11-01', end: '2026-11-07', account: 'all' });
      assert.match(csv.csv, /^Account,Customer ID,Campaign/);
      assert.match(csv.csv, /Dupoin-ID1,4445556666,Brand v2,10,ENABLED,SEARCH,2000,100,0\.05,250000,2500,10,0,25000/);
    } finally {
      await closeDb();
    }

    await client.query(`INSERT INTO schema_migrations (name) VALUES ('066_paid_media_google_ads.sql')`);
    await client.query(readFileSync('db/rollbacks/066_paid_media_google_ads_down.sql', 'utf8'));
    const gone = await client.query(`SELECT to_regclass('google_ads_accounts') AS a, to_regclass('google_ads_campaign_daily') AS b, to_regclass('google_ads_sync_runs') AS c`);
    assert.deepEqual(gone.rows[0], { a: null, b: null, c: null });
    const features = await client.query(`SELECT name, permitted_features FROM departments ORDER BY name`);
    assert.deepEqual(features.rows.map(row => [row.name, row.permitted_features]), [['Marketing', ['social-post']], ['Paid Media', []]]);
    assert.equal((await client.query(`SELECT 1 FROM schema_migrations WHERE name = '066_paid_media_google_ads.sql'`)).rowCount, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  }
});
