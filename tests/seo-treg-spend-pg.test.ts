import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 061 + treg spend ledger: reserve, daily limit, settle, run history, rollback', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `treg_spend_${Date.now()}`;
  let closeDb: (() => Promise<void>) | null = null;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, name TEXT);
      CREATE TABLE seo_sites (id TEXT PRIMARY KEY, site_url TEXT, gsc_property TEXT, active BOOLEAN);
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name) VALUES ('admin-1', 'admin', 'Admin');
    `);
    await client.query(readFileSync('db/migrations/056_seo_keyword_gap.sql', 'utf8'));
    await assert.rejects(client.query(`INSERT INTO seo_keyword_gaps (id, our_domain, provider, status) VALUES ('before', 'https://dupoin.co.id/', 'treg', 'queued')`), 'treg is not a provider before 061');
    const up = readFileSync('db/migrations/061_seo_data_provider_spend.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('061_seo_data_provider_spend.sql')`);

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const database = await import('../src/lib/database');
    closeDb = database.closeDb;
    const spend = await import('../src/lib/seo/treg-spend');
    const store = await import('../src/lib/seo/keyword-gap-store');

    // Reserve within the limit, then a second run that would cross it is refused.
    const limitMicro = 100_000;
    const first = await spend.reserveTregSpend({ feature: 'keyword-gap', refId: null, userId: 'admin-1', estimateMicro: 60_000, calls: 3, limitMicro, balanceBeforeMicro: 5_000_000 });
    assert.equal(await spend.tregSpentTodayMicro(), 60_000, 'a reservation counts against today');
    await assert.rejects(
      spend.reserveTregSpend({ feature: 'keyword-gap', refId: null, userId: 'admin-1', estimateMicro: 60_000, calls: 3, limitMicro }),
      (error: unknown) => error instanceof spend.DailyLimitError && /Daily treg spend limit reached/.test(error.message),
    );

    // Concurrent reservations cannot both slip under the cap.
    const racers = await Promise.allSettled([
      spend.reserveTregSpend({ feature: 'keyword-gap', refId: null, userId: 'admin-1', estimateMicro: 30_000, calls: 1, limitMicro }),
      spend.reserveTregSpend({ feature: 'keyword-gap', refId: null, userId: 'admin-1', estimateMicro: 30_000, calls: 1, limitMicro }),
    ]);
    assert.equal(racers.filter(result => result.status === 'fulfilled').length, 1);
    const racer = racers.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<string>;
    await spend.settleTregSpend(racer.value, { status: 'failed', actualMicro: 0, costSource: 'reported', calls: 0, callIds: [], note: 'The run did not start.' });

    // A treg gap row is now allowed; settling replaces the estimate with the reported charge.
    const gapId = await store.createGap({ siteId: null, ourDomain: 'https://dupoin.co.id/', provider: 'treg', payload: { uploadedKeywords: null, competitors: ['https://a.com/'], language: 'id', market: 'Indonesia', treg: { spendId: first, keywordLimit: 100, estimateMicro: 60_000 } }, userId: 'admin-1' });
    await spend.attachSpendRef(first, gapId);
    await spend.settleTregSpend(first, { status: 'succeeded', actualMicro: 24_480, costSource: 'reported', calls: 2, callIds: ['c0', 'c1'], note: null, balanceAfterMicro: 4_975_520 });
    assert.equal(await spend.tregSpentTodayMicro(), 24_480);

    const listed = (await store.listGaps()).find(gap => gap.id === gapId);
    assert.deepEqual(listed?.cost, { estimatedMicro: 60_000, actualMicro: 24_480, source: 'reported', status: 'succeeded', balanceAfterMicro: 4_975_520 });
    const one = await store.getGap(gapId);
    assert.equal(one?.cost?.actualMicro, 24_480);
    assert.equal(one?.input?.treg?.spendId, first);

    const rows = await spend.listSpend({ start: null, end: null });
    const recorded = rows.find(row => row.id === first);
    assert.equal(recorded?.username, 'admin');
    assert.equal(recorded?.feature, 'keyword-gap');
    assert.equal(recorded?.ref_id, gapId);
    assert.equal(recorded?.balance_before_micro, 5_000_000);
    assert.equal(recorded?.balance_after_micro, 4_975_520);
    const callIds = await client.query(`SELECT call_ids FROM seo_data_provider_spend WHERE id = $1`, [first]);
    assert.deepEqual(callIds.rows[0].call_ids, ['c0', 'c1']);

    // A stale reservation (worker died) is closed with its estimate flagged as such.
    const stale = await spend.reserveTregSpend({ feature: 'keyword-gap', refId: null, userId: 'admin-1', estimateMicro: 10_000, calls: 1, limitMicro });
    await client.query(`UPDATE seo_data_provider_spend SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE id = $1`, [stale]);
    await spend.expireStaleReservations();
    const expired = await client.query(`SELECT status, actual_micro, cost_source FROM seo_data_provider_spend WHERE id = $1`, [stale]);
    assert.deepEqual(expired.rows[0], { status: 'failed', actual_micro: '10000', cost_source: 'estimate' });

    await client.query(readFileSync('db/rollbacks/061_seo_data_provider_spend_down.sql', 'utf8'));
    const table = await client.query(`SELECT to_regclass('seo_data_provider_spend') AS name`);
    assert.equal(table.rows[0].name, null);
    const relabelled = await client.query(`SELECT provider FROM seo_keyword_gaps WHERE id = $1`, [gapId]);
    assert.equal(relabelled.rows[0].provider, 'free');
    const migration = await client.query(`SELECT name FROM schema_migrations WHERE name = '061_seo_data_provider_spend.sql'`);
    assert.equal(migration.rowCount, 0);
    await client.query(up);
    const again = await client.query(`SELECT to_regclass('seo_data_provider_spend') AS name`);
    assert.ok(again.rows[0].name, 'reapplies after rollback');
  } finally {
    await closeDb?.();
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
