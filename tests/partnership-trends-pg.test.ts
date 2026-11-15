import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 059 applies twice on top of 057, stores digests and the watchlist, and rolls back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `trends_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('admin-1', 'admin', 'Admin', 'hash', 'admin');
    `);
    await client.query(readFileSync('db/migrations/057_partnership_competitor_intel.sql', 'utf8'));
    await client.query(`INSERT INTO partnership_reports (id, competitor_id, status) VALUES ('c1', '00000000-0000-0000-0000-000000000701', 'succeeded')`);
    const up = readFileSync('db/migrations/059_partnership_global_trends.sql', 'utf8');
    await client.query(up);
    await client.query(up);

    const brands = await client.query(`SELECT name, website, newsroom_url, search_terms FROM partnership_trend_brands ORDER BY sort_order`);
    assert.deepEqual(brands.rows.map(row => row.name), ['Exness', 'XTB', 'Valetax', 'IG', 'IC Markets', 'Pepperstone', 'eToro', 'Plus500', 'OANDA', 'FxPro', 'Deriv', 'FBS', 'CMC Markets']);
    assert.ok(brands.rows.every(row => row.website?.startsWith('https://')));
    assert.deepEqual(brands.rows[3].search_terms, ['IG Group']);
    await assert.rejects(client.query(`INSERT INTO partnership_trend_brands (id, name) VALUES ('dup', 'exness')`));
    await assert.rejects(client.query(`INSERT INTO partnership_reports (id, kind, status) VALUES ('bad', 'other', 'queued')`));
    // Competitor reports from 057 keep working.
    await client.query(`INSERT INTO partnership_reports (id, competitor_id, status) VALUES ('c2', '00000000-0000-0000-0000-000000000701', 'running')`);

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const store = await import('../src/lib/partnership/trends-store');
    const { runTrendsDigest, runDueTrendsDigest } = await import('../src/lib/partnership/trends-run');
    const { closeDb } = await import('../src/lib/database');
    try {
      const all = await store.listTrendBrands();
      assert.equal(all.length, 13);
      assert.deepEqual(all.find(brand => brand.name === 'IG')?.searchTerms, ['IG Group']);
      const vantage = await store.createTrendBrand({ name: 'Vantage', website: null, newsroomUrl: null, searchTerms: ['Vantage Markets'], notes: null, active: true }, 'admin-1');
      await assert.rejects(store.createTrendBrand({ name: 'VANTAGE', website: null, newsroomUrl: null, searchTerms: [], notes: null, active: true }, 'admin-1'), store.DuplicateTrendBrandError);
      await store.updateTrendBrand(vantage, { name: 'Vantage', website: null, newsroomUrl: null, searchTerms: ['Vantage Markets'], notes: 'off for now', active: false }, 'admin-1');
      assert.equal((await store.listTrendBrands({ activeOnly: true })).length, 13);
      await store.deleteTrendBrand(vantage);

      const id = await store.createTrendsReport(90, 'manual', 'admin-1');
      await assert.rejects(store.createTrendsReport(30, 'manual', 'admin-1'), store.TrendsInProgressError);
      const queued = await store.getTrendsReport(id);
      assert.equal(queued?.windowDays, 90);
      assert.equal(queued?.result, null);

      const seen: string[] = [];
      await runTrendsDigest(id, (_user, days) => ({
        now: () => new Date('2026-11-15T08:00:00Z'),
        fetchNews: async query => {
          seen.push(query);
          assert.equal(days, 90);
          return query.includes('"XTB"') ? [{ title: 'XTB launches new app feature', url: 'https://news.example/xtb', publishedAt: '2026-10-20', publisher: 'FM' }] : [];
        },
        crawlPages: async () => ({ pages: [], timedOut: false }),
        searchNews: async () => null,
        complete: async () => ({
          model: 'stub/model',
          content: JSON.stringify({ summary: 'XTB shipped app features.', items: [{ id: 'I1', theme: 'product', brand: 'XTB', title: 'New app feature', summary: 's', sourceIds: ['S1'] }], topTrends: [{ title: 'Apps', detail: 'd', itemIds: ['I1'] }], ideas: [{ title: 'Explain app tools', detail: 'Education series.', itemIds: ['I1'] }] }),
        }),
      }));
      assert.ok(seen.every(query => query.endsWith('when:90d')));
      const done = await store.getTrendsReport(id);
      assert.equal(done?.status, 'succeeded');
      assert.equal(done?.model, 'stub/model');
      assert.equal(done?.windowStart, '2026-08-17');
      assert.deepEqual(done?.result?.items.map(item => [item.id, item.brand, item.title]), [['T1', 'XTB', 'New app feature']]);
      assert.equal((await store.latestSucceededTrendsReport())?.id, id);
      const history = await store.listTrendsReports();
      assert.deepEqual(history.map(run => [run.id, run.status, run.windowDays, run.result]), [[id, 'succeeded', 90, null]]);

      const skipped = await runDueTrendsDigest(new Date());
      assert.equal(skipped.status, 'skipped');
    } finally {
      await closeDb();
    }

    await client.query(`INSERT INTO schema_migrations (name) VALUES ('059_partnership_global_trends.sql')`);
    await client.query(readFileSync('db/rollbacks/059_partnership_global_trends_down.sql', 'utf8'));
    const gone = await client.query(`SELECT to_regclass('partnership_trend_brands') AS brands`);
    assert.equal(gone.rows[0].brands, null);
    const reports = await client.query(`SELECT id, kind FROM partnership_reports ORDER BY id`);
    assert.deepEqual(reports.rows, [{ id: 'c1', kind: 'competitor-activity' }, { id: 'c2', kind: 'competitor-activity' }]);
    await assert.rejects(client.query(`INSERT INTO partnership_reports (id, kind, status) VALUES ('g', 'global-trends', 'queued')`));
    assert.equal((await client.query(`SELECT 1 FROM schema_migrations WHERE name = '059_partnership_global_trends.sql'`)).rowCount, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
