import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ABORT_CHUNKS_SQL, EXPIRE_OPEN_SQL, LOCK_DAYS_SQL, LOCK_WRITER_SQL, MAX_SESSION_DEALS, MAX_STAGED_DEALS, REBUILD_INSERT_SQL, stageChunkSql, stagingRejection, upsertFromStagingSql,
} from '../src/lib/settlement/deals-store';

const migration = readFileSync('db/migrations/047_settlement_deals_history.sql', 'utf8');
const route = readFileSync('src/app/api/settlement-report/deals-history/route.ts', 'utf8');
const store = readFileSync('src/lib/settlement/deals-store.ts', 'utf8');

test('migration 047 creates deal facts without name or comment and documents rollback', () => {
  for (const table of ['settlement_dh_sessions', 'settlement_dh_chunks', 'settlement_dh_staging', 'settlement_mt5_deal_facts', 'settlement_dh_coverage', 'settlement_dh_daily']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, new RegExp(`DROP TABLE IF EXISTS ${table}`));
  }
  assert.doesNotMatch(migration, /\bname TEXT|\bcomment TEXT/);
  assert.match(migration, /settlement_dh_stg_/);
  assert.match(migration, /pg_total_relation_size/);
  assert.doesNotMatch(migration.replace(/--.*$/gm, ''), /DELETE FROM settlement_mt5_deal_facts/);
});

test('commit SQL upserts from staging and does not load the deal rows into the process', () => {
  const upsert = upsertFromStagingSql('session-1');
  assert.match(upsert, /INSERT INTO settlement_mt5_deal_facts/);
  assert.match(upsert, /FROM settlement_dh_stg_session_1/);
  assert.match(upsert, /ON CONFLICT \(deal\) DO UPDATE/);
  assert.match(upsert, /IS DISTINCT FROM/);
  assert.match(upsert, /COUNT\(\*\) FILTER/);
  assert.doesNotMatch(store, /staged\.map\(toFact\)/);
  assert.doesNotMatch(store, /for \(const deal of merged\.upserts\)/);
  assert.match(REBUILD_INSERT_SQL, /FROM settlement_mt5_deal_facts/);
  assert.match(REBUILD_INSERT_SQL, /entry = 'in'/);
  assert.match(stageChunkSql('session-1'), /settlement_dh_stg_session_1\.seq <= EXCLUDED\.seq/);
  assert.match(store, /DROP TABLE IF EXISTS/);
  assert.doesNotMatch(store, /TRUNCATE settlement_dh_staging/);
  assert.doesNotMatch(`${ABORT_CHUNKS_SQL}\n${store}`, /DELETE FROM settlement_mt5_deal_facts/);
  assert.match(LOCK_WRITER_SQL, /pg_advisory_xact_lock\(hashtext\('settlement-dh-writer'\)::bigint\)/);
  assert.equal(LOCK_WRITER_SQL.includes('unnest'), false);
  assert.match(LOCK_DAYS_SQL, /pg_advisory_xact_lock\(hashtext\('dh-day:' \|\| day\)::bigint\)/);
  assert.match(LOCK_DAYS_SQL, /ORDER BY 1/);
  assert.match(migration, /eof_confirmed/);
  assert.match(migration, /CHECK \(status IN \('attested', 'partial'\)\)/);
  assert.doesNotMatch(migration, /'full'/);
  assert.match(EXPIRE_OPEN_SQL, /24 hours/);
  assert.equal(stagingRejection(MAX_SESSION_DEALS - 1, 0, 2), 'This upload is larger than one month of deals');
  assert.equal(stagingRejection(0, MAX_STAGED_DEALS - 1, 2), 'Staged Deals History rows are at the limit');
  assert.equal(stagingRejection(10, 10, 1), null);
  assert.match(migration, /idx_settlement_dh_staging_seq/);
  assert.match(route, /eofConfirmed/);
  assert.match(route, /dealCount/);
  assert.match(route, /requireSettlementReport/);
  assert.match(route, /readUploadBody/);
  assert.match(route, /withSessionLock/);
  assert.doesNotMatch(route, /cron|node-cron/);
});
