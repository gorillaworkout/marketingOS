import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ABORT_CHUNKS_SQL, ABORT_STAGING_SQL, REBUILD_INSERT_SQL, STAGE_SQL, UPSERT_FACT_SQL,
} from '../src/lib/settlement/deals-store';

const migration = readFileSync('db/migrations/047_settlement_deals_history.sql', 'utf8');
const route = readFileSync('src/app/api/settlement-report/deals-history/route.ts', 'utf8');
const abortSource = `${ABORT_STAGING_SQL}\n${ABORT_CHUNKS_SQL}`;

test('migration 047 creates deal facts without name or comment and documents rollback', () => {
  for (const table of ['settlement_dh_sessions', 'settlement_dh_chunks', 'settlement_dh_staging', 'settlement_mt5_deal_facts', 'settlement_dh_coverage', 'settlement_dh_daily']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, new RegExp(`DROP TABLE IF EXISTS ${table}`));
  }
  assert.doesNotMatch(migration, /\bname TEXT|\bcomment TEXT/);
  assert.match(migration, /pg_total_relation_size/);
  assert.doesNotMatch(migration.replace(/--.*$/gm, ''), /DELETE FROM settlement_mt5_deal_facts/);
});

test('commit SQL upserts on deal and rebuilds the cache from facts; abort does not delete facts', () => {
  assert.match(UPSERT_FACT_SQL, /ON CONFLICT \(deal\) DO UPDATE/);
  assert.match(UPSERT_FACT_SQL, /IS DISTINCT FROM/);
  assert.match(REBUILD_INSERT_SQL, /FROM settlement_mt5_deal_facts/);
  assert.match(REBUILD_INSERT_SQL, /entry = 'in'/);
  assert.match(STAGE_SQL, /settlement_dh_staging\.seq <= EXCLUDED\.seq/);
  assert.match(abortSource, /settlement_dh_staging/);
  assert.doesNotMatch(abortSource, /settlement_mt5_deal_facts/);
  assert.match(route, /requireSettlementReport/);
  assert.match(route, /readUploadBody/);
  assert.match(route, /withSessionLock/);
  assert.doesNotMatch(route, /cron|node-cron/);
});
