/**
 * Real PostgreSQL path for Deals History. Skipped unless SETTLEMENT_TEST_DATABASE_URL
 * points at a local disposable database. In-memory tests do not replace this file.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { DealFact } from '../src/lib/settlement/deals-engine';
import { MAX_CHUNK_DEALS } from '../src/lib/settlement/deals-parse';
import { LOCK_DAYS_SQL, LOCK_WRITER_SQL } from '../src/lib/settlement/deals-store';

const testUrl = process.env.SETTLEMENT_TEST_DATABASE_URL ?? '';
const local = /^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)(?::\d+)?\//.test(testUrl);
const OWNER = 'dh-pg-owner';

function deal(id: string, serverDate: string, commission: number): DealFact {
  return {
    deal: id, login: '2000001', serverTime: `${serverDate} 12:00:00`, serverDate, entry: 'in',
    volume: 1, commission, fee: 0, swap: 0, profit: 0, currency: 'USD', rate: 10000,
  };
}

type Database = typeof import('../src/lib/database');
type Store = typeof import('../src/lib/settlement/deals-store');

describe('deals history on disposable postgres', { skip: local ? false : 'SETTLEMENT_TEST_DATABASE_URL is not a local disposable database' }, () => {
  let db: Database;
  let store: Store;
  const evidence: Record<string, unknown> = {};

  before(async () => {
    process.env.DATABASE_URL = testUrl;
    db = await import('../src/lib/database');
    store = await import('../src/lib/settlement/deals-store');
    const { migrate } = await import('../scripts/migrate');
    await db.execute(`DROP TABLE IF EXISTS settlement_dh_daily, settlement_dh_coverage, settlement_mt5_deal_facts, settlement_dh_staging, settlement_dh_chunks, settlement_dh_sessions`);
    await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await db.execute(`DELETE FROM schema_migrations WHERE name = '047_settlement_deals_history.sql'`);
    await migrate(false);
    await db.execute(
      `INSERT INTO users (id, username, name, password_hash, role) VALUES (?, 'dh-pg-owner', 'DH PG Owner', 'not-a-login', 'admin')
       ON CONFLICT (id) DO NOTHING`,
      [OWNER],
    );
    const version = await db.queryOne<{ version: string }>('SELECT version() AS version');
    const signatures = await db.queryAll<{ args: string }>(
      `SELECT pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'pg_catalog' AND p.proname = 'pg_advisory_xact_lock' ORDER BY 1`,
    );
    const hashType = await db.queryOne<{ hash_type: string }>(`SELECT pg_typeof(hashtext('dh-deal:1'))::text AS hash_type`);
    const applied = await db.queryOne<{ name: string }>(`SELECT name FROM schema_migrations WHERE name = '047_settlement_deals_history.sql'`);
    evidence.version = version?.version;
    evidence.advisorySignatures = signatures.map(row => row.args);
    evidence.hashtextType = hashType?.hash_type;
    evidence.migration = applied?.name;
    assert.equal(applied?.name, '047_settlement_deals_history.sql');
    assert.deepEqual(signatures.map(row => row.args), ['bigint', 'integer, integer']);
    assert.equal(hashType?.hash_type, 'integer');
  });

  after(async () => {
    console.log(`PG_DEALS_EVIDENCE ${JSON.stringify(evidence)}`);
    await db?.closeDb();
  });

  async function reset() {
    await db.execute(`TRUNCATE settlement_dh_daily, settlement_dh_coverage, settlement_mt5_deal_facts, settlement_dh_staging, settlement_dh_chunks, settlement_dh_sessions`);
  }

  async function openAndStage(id: string, title: { filter: string; from: string; to: string }, deals: DealFact[], footer = footerOf(deals)) {
    await store.openOwnedSession({
      id, ownerId: OWNER, fileName: `${id}.csv`, titleFilter: title.filter, from: title.from, to: title.to,
      footerCommission: footer.commission, footerSwap: footer.swap,
    });
    await store.stageOwnedChunk({ sessionId: id, actorId: OWNER, seq: 1, hash: `${id}:${deals.length}:${deals[0]?.deal ?? 'empty'}`, deals });
  }

  function footerOf(deals: DealFact[]) {
    const money = (field: 'commission' | 'swap') => Math.round(deals.reduce((sum, row) => sum + row[field], 0) * 100) / 100;
    return { commission: money('commission'), swap: money('swap') };
  }

  async function commitFile(id: string, deals: DealFact[], confirmation?: { eof?: boolean; declaredCount?: number }) {
    return store.commitOwnedSession(id, OWNER, footerOf(deals), {
      eof: confirmation?.eof ?? true,
      declaredCount: confirmation?.declaredCount ?? deals.length,
    });
  }

  it('applies 047, rejects a full status, and runs the cast advisory-lock overload', async () => {
    const columns = await db.queryAll<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'settlement_dh_sessions' AND column_name IN ('eof_confirmed', 'deal_count') ORDER BY 1`,
    );
    assert.deepEqual(columns.map(row => row.column_name), ['deal_count', 'eof_confirmed']);
    await assert.rejects(
      () => db.execute(`INSERT INTO settlement_dh_coverage (server_date, status) VALUES ('2026-01-01', 'full')`),
      /check|violates/i,
    );
    const explain = await db.queryAll<Record<string, string>>(
      `EXPLAIN (VERBOSE, COSTS OFF) ${LOCK_WRITER_SQL}`,
    );
    const plan = explain.map(row => Object.values(row).join(' ')).join('\n');
    evidence.explain = plan;
    assert.match(plan, /pg_advisory_xact_lock/);
    assert.match(plan, /bigint/);
    assert.match(LOCK_WRITER_SQL, /::bigint/);
    assert.match(LOCK_DAYS_SQL, /::bigint/);
    await db.executeTransaction(async tx => {
      await tx.execute(LOCK_WRITER_SQL);
      await tx.execute(LOCK_DAYS_SQL, [['2026-10-02', '2026-10-01']]);
      throw new Error('rollback-lock-probe');
    }).catch(error => {
      assert.equal(error instanceof Error ? error.message : '', 'rollback-lock-probe');
    });
  });

  it('commits, overlaps, moves a deal, aborts, expires, and rolls back on the database', async () => {
    await reset();
    const monthTitle = { filter: '*', from: '2026-10-01', to: '2026-10-31' };
    await openAndStage('month', monthTitle, [deal('m1', '2026-10-01', -10), deal('m2', '2026-10-02', -20)]);
    const month = await commitFile('month', [deal('m1', '2026-10-01', -10), deal('m2', '2026-10-02', -20)]);
    assert.equal(month.aborted, false);
    if (month.aborted) return;
    assert.equal(month.inserted, 2);

    await openAndStage('week', { filter: '*', from: '2026-10-02', to: '2026-10-08' }, [deal('m2', '2026-10-02', -20)]);
    const week = await commitFile('week', [deal('m2', '2026-10-02', -20)]);
    assert.equal(week.aborted, false);
    if (!week.aborted) assert.equal(week.unchanged, 1);
    const kept = await db.queryOne<{ commission: string }>(`SELECT commission::text FROM settlement_mt5_deal_facts WHERE deal = 'm1'`);
    assert.equal(Number(kept?.commission), -10);
    const october = await db.queryAll<{ server_date: string; commission_in: string; deals: number }>(
      `SELECT to_char(server_date, 'YYYY-MM-DD') AS server_date, commission_in::text, deals FROM settlement_dh_daily ORDER BY 1`,
    );
    assert.deepEqual(october.map(row => [row.server_date, Number(row.commission_in), row.deals]), [
      ['2026-10-01', -10, 1],
      ['2026-10-02', -20, 1],
    ]);

    await openAndStage('move', monthTitle, [deal('m1', '2026-10-05', -10)]);
    const moved = await commitFile('move', [deal('m1', '2026-10-05', -10)]);
    assert.equal(moved.aborted, false);
    const afterMove = await db.queryAll<{ server_date: string; commission_in: string; deals: number }>(
      `SELECT to_char(server_date, 'YYYY-MM-DD') AS server_date, commission_in::text, deals FROM settlement_dh_daily ORDER BY 1`,
    );
    assert.deepEqual(afterMove.map(row => [row.server_date, Number(row.commission_in), row.deals]), [
      ['2026-10-02', -20, 1],
      ['2026-10-05', -10, 1],
    ]);
    const days = await store.loadDealsHistoryDays('2026-10-01', '2026-10-05');
    assert.equal(days.find(day => day.date === '2026-10-01')?.status, 'attested');
    assert.equal(days.find(day => day.date === '2026-10-01')?.commission, null);
    assert.equal(days.find(day => day.date === '2026-10-05')?.status, 'observed');
    assert.equal(days.find(day => day.date === '2026-10-05')?.commission?.[10000], -10);
    const session = await db.queryOne<{ eof_confirmed: boolean; deal_count: number }>(
      `SELECT eof_confirmed, deal_count FROM settlement_dh_sessions WHERE id = 'move'`,
    );
    assert.equal(session?.eof_confirmed, true);
    assert.equal(session?.deal_count, 1);
    const stagedLeft = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_dh_staging`);
    assert.equal(stagedLeft?.count, '0');

    await openAndStage('bad', monthTitle, [deal('m3', '2026-10-03', -4)]);
    const aborted = await store.commitOwnedSession('bad', OWNER, { commission: -99, swap: 0 }, { eof: true, declaredCount: 1 });
    assert.equal(aborted.aborted, true);
    const badFact = await db.queryOne(`SELECT deal FROM settlement_mt5_deal_facts WHERE deal = 'm3'`);
    const badCoverage = await db.queryOne(`SELECT server_date FROM settlement_dh_coverage WHERE session_id = 'bad'`);
    const badStatus = await db.queryOne<{ status: string }>(`SELECT status FROM settlement_dh_sessions WHERE id = 'bad'`);
    assert.equal(badFact, undefined);
    assert.equal(badCoverage, undefined);
    assert.equal(badStatus?.status, 'aborted');

    await openAndStage('old', monthTitle, [deal('old1', '2026-10-09', -6)]);
    await db.execute(`UPDATE settlement_dh_sessions SET created_at = CURRENT_TIMESTAMP - INTERVAL '25 hours' WHERE id = 'old'`);
    await store.expireAbandonedSessions();
    const expired = await db.queryOne<{ status: string }>(`SELECT status FROM settlement_dh_sessions WHERE id = 'old'`);
    const expiredStaging = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_dh_staging WHERE session_id = 'old'`);
    const expiredFact = await db.queryOne(`SELECT deal FROM settlement_mt5_deal_facts WHERE deal = 'old1'`);
    assert.equal(expired?.status, 'aborted');
    assert.equal(expiredStaging?.count, '0');
    assert.equal(expiredFact, undefined);
    assert.equal(Number(kept?.commission), -10);

    const before = await db.queryOne<{ commission: string }>(`SELECT commission::text FROM settlement_mt5_deal_facts WHERE deal = 'm2'`);
    await openAndStage('boom', monthTitle, [deal('m2', '2026-10-02', -77)]);
    await assert.rejects(() => store.commitOwnedSession('boom', OWNER, footerOf([deal('m2', '2026-10-02', -77)]), { eof: true, declaredCount: 1 }, {
      beforeRebuild: async () => { throw new Error('rebuild failed'); },
    }), /rebuild failed/);
    const afterRollback = await db.queryOne<{ commission: string }>(`SELECT commission::text FROM settlement_mt5_deal_facts WHERE deal = 'm2'`);
    const boomStatus = await db.queryOne<{ status: string }>(`SELECT status FROM settlement_dh_sessions WHERE id = 'boom'`);
    const boomDaily = await db.queryOne<{ commission_in: string }>(`SELECT commission_in::text FROM settlement_dh_daily WHERE server_date = '2026-10-02'`);
    assert.equal(afterRollback?.commission, before?.commission);
    assert.equal(Number(boomDaily?.commission_in), -20);
    assert.equal(boomStatus?.status, 'open');
  });

  it('aborts a broad title whose last chunks never arrived and does not publish coverage', async () => {
    await reset();
    const title = { filter: '*', from: '2026-10-01', to: '2026-10-31' };
    const received = [deal('p1', '2026-10-01', -2.5), deal('p2', '2026-10-02', -1)];
    await openAndStage('partial', title, received);
    await store.stageOwnedChunk({ sessionId: 'partial', actorId: OWNER, seq: 2, hash: 'middle', deals: [deal('p3', '2026-10-15', -4)] });
    const refused = await store.commitOwnedSession('partial', OWNER, { commission: -7.5, swap: 0 }, { eof: false, declaredCount: 6 });
    assert.equal(refused.aborted, true);
    const facts = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_mt5_deal_facts`);
    const coverage = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_dh_coverage`);
    const staging = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_dh_staging`);
    const chunks = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_dh_chunks`);
    const status = await db.queryOne<{ status: string; eof_confirmed: boolean }>(`SELECT status, eof_confirmed FROM settlement_dh_sessions WHERE id = 'partial'`);
    assert.equal(facts?.count, '0');
    assert.equal(coverage?.count, '0');
    assert.equal(staging?.count, '0');
    assert.equal(chunks?.count, '0');
    assert.equal(status?.status, 'aborted');
    assert.equal(status?.eof_confirmed, false);
    const report = await store.loadDealsHistoryDays('2026-10-01', '2026-10-31');
    assert.equal(report.find(day => day.date === '2026-10-01')?.status, 'missing');
    assert.equal(report.find(day => day.date === '2026-10-15')?.commission, null);
    assert.equal(report.find(day => day.date === '2026-10-31')?.status, 'missing');
  });

  it('keeps both disjoint deals on one server day and one row for the same deal', async () => {
    await reset();
    const day = { filter: '*', from: '2026-11-01', to: '2026-11-01' };
    const amounts = [-1, -2, -4, -8, -16, -32, -64, -128];
    await Promise.all(amounts.map(async (amount, index) => {
      const id = `day-${index}`;
      const row = deal(`d${index}`, '2026-11-01', amount);
      await openAndStage(id, day, [row]);
      const result = await commitFile(id, [row]);
      assert.equal(result.aborted, false);
    }));
    const total = await db.queryOne<{ commission_in: string; deals: number }>(
      `SELECT commission_in::text, deals FROM settlement_dh_daily WHERE server_date = '2026-11-01'`,
    );
    const factCount = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_mt5_deal_facts`);
    assert.equal(Number(total?.commission_in), amounts.reduce((sum, amount) => sum + amount, 0));
    assert.equal(total?.deals, amounts.length);
    assert.equal(factCount?.count, String(amounts.length));
    evidence.sameDayDeals = total?.deals;
    evidence.sameDayCommission = Number(total?.commission_in);

    const sameDay = { filter: '*', from: '2026-11-02', to: '2026-11-02' };
    await openAndStage('same-a', sameDay, [deal('shared', '2026-11-02', -3)]);
    await openAndStage('same-b', sameDay, [deal('shared', '2026-11-02', -8)]);
    const [left, right] = await Promise.all([
      commitFile('same-a', [deal('shared', '2026-11-02', -3)]),
      commitFile('same-b', [deal('shared', '2026-11-02', -8)]),
    ]);
    assert.equal(left.aborted, false);
    assert.equal(right.aborted, false);
    const shared = await db.queryAll<{ commission: string; session_id: string }>(
      `SELECT commission::text, session_id FROM settlement_mt5_deal_facts WHERE deal = 'shared'`,
    );
    const sharedDaily = await db.queryOne<{ commission_in: string; deals: number }>(
      `SELECT commission_in::text, deals FROM settlement_dh_daily WHERE server_date = '2026-11-02'`,
    );
    assert.equal(shared.length, 1);
    assert.equal(sharedDaily?.deals, 1);
    assert.equal(Number(sharedDaily?.commission_in), Number(shared[0]?.commission));
    assert.ok(Number(shared[0]?.commission) === -3 || Number(shared[0]?.commission) === -8);
    evidence.sameDealCommission = Number(shared[0]?.commission);
    evidence.sameDealDaily = Number(sharedDaily?.commission_in);
  });

  it('ends a finalize and chunk race with no leftover staging', { timeout: 120_000 }, async () => {
    await reset();
    const title = { filter: '*', from: '2026-11-03', to: '2026-11-03' };
    for (let index = 0; index < 20; index += 1) {
      const id = `race-${index}`;
      const first = deal(`race-a-${index}`, '2026-11-03', -1);
      const second = deal(`race-b-${index}`, '2026-11-03', -5);
      await openAndStage(id, title, [first]);
      const [committed, extra] = await Promise.all([
        store.commitOwnedSession(id, OWNER, footerOf([first]), { eof: true, declaredCount: 1 }),
        store.stageOwnedChunk({ sessionId: id, actorId: OWNER, seq: 2, hash: `extra-${index}`, deals: [second] }).then(
          () => 'staged' as const,
          (error: unknown) => (error instanceof Error ? error.message : 'failed'),
        ),
      ]);
      evidence.raceCommitted = Number(evidence.raceCommitted ?? 0);
      evidence.raceAborted = Number(evidence.raceAborted ?? 0);
      const staging = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_dh_staging WHERE session_id = ?`, [id]);
      const status = await db.queryOne<{ status: string; eof_confirmed: boolean }>(`SELECT status, eof_confirmed FROM settlement_dh_sessions WHERE id = ?`, [id]);
      const facts = await db.queryAll<{ deal: string }>(`SELECT deal FROM settlement_mt5_deal_facts WHERE deal LIKE ? ORDER BY 1`, [`race-%-${index}`]);
      assert.equal(staging?.count, '0');
      if (!committed.aborted && status?.status === 'committed') {
        assert.equal(status.eof_confirmed, true);
        assert.deepEqual(facts.map(row => row.deal), [`race-a-${index}`]);
        assert.notEqual(extra, 'staged');
        evidence.raceCommitted = Number(evidence.raceCommitted) + 1;
      } else {
        assert.equal(committed.aborted, true);
        assert.equal(status?.status, 'aborted');
        assert.equal(status?.eof_confirmed, false);
        assert.deepEqual(facts, []);
        evidence.raceAborted = Number(evidence.raceAborted) + 1;
      }
    }
    const early = deal('race-early', '2026-11-03', -1);
    const late = deal('race-late', '2026-11-03', -5);
    await openAndStage('chunk-first', title, [early]);
    await store.stageOwnedChunk({ sessionId: 'chunk-first', actorId: OWNER, seq: 2, hash: 'late', deals: [late] });
    const interrupted = await store.commitOwnedSession('chunk-first', OWNER, footerOf([early]), { eof: true, declaredCount: 1 });
    assert.equal(interrupted.aborted, true);
    const interruptedFacts = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_mt5_deal_facts WHERE deal IN ('race-early', 'race-late')`);
    const interruptedCoverage = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_dh_coverage WHERE session_id = 'chunk-first'`);
    const interruptedStaging = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_dh_staging WHERE session_id = 'chunk-first'`);
    assert.equal(interruptedFacts?.count, '0');
    assert.equal(interruptedCoverage?.count, '0');
    assert.equal(interruptedStaging?.count, '0');
    evidence.chunkBeforeCommit = 'aborted';
    const coverage = await db.queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM settlement_dh_coverage c
       JOIN settlement_dh_sessions s ON s.id = c.session_id
       WHERE s.status <> 'committed' OR s.eof_confirmed = FALSE`,
    );
    assert.equal(coverage?.count, '0');
  });

  it('accepts a 2000-deal batch and rejects 2001 before insert', { timeout: 120_000 }, async () => {
    await reset();
    const rows = Array.from({ length: MAX_CHUNK_DEALS }, (_, index) => deal(`b${String(index).padStart(4, '0')}`, '2026-12-01', -1));
    await openAndStage('batch', { filter: '*', from: '2026-12-01', to: '2026-12-01' }, rows);
    const committed = await commitFile('batch', rows);
    assert.equal(committed.aborted, false);
    const count = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_mt5_deal_facts`);
    const daily = await db.queryOne<{ deals: number; commission_in: string }>(
      `SELECT deals, commission_in::text FROM settlement_dh_daily WHERE server_date = '2026-12-01'`,
    );
    assert.equal(count?.count, '2000');
    assert.equal(daily?.deals, 2000);
    assert.equal(Number(daily?.commission_in), -2000);
    evidence.batchDeals = daily?.deals;

    await store.openOwnedSession({
      id: 'too-many', ownerId: OWNER, fileName: 'too-many.csv', titleFilter: '*', from: '2026-12-02', to: '2026-12-02', footerCommission: 0, footerSwap: 0,
    });
    const tooMany = Array.from({ length: MAX_CHUNK_DEALS + 1 }, (_, index) => deal(`x${index}`, '2026-12-02', -1));
    await assert.rejects(
      () => store.stageOwnedChunk({ sessionId: 'too-many', actorId: OWNER, seq: 1, hash: 'too-many', deals: tooMany }),
      /2000/,
    );
    const leftover = await db.queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM settlement_dh_staging WHERE session_id = 'too-many'`);
    assert.equal(leftover?.count, '0');
  });
});
