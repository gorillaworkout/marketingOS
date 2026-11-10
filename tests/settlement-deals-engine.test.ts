import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { abortDhSession, applyDhChunk, commitDhSession, emptyDhState, footerMatches, mergeIncoming, openDhSession, type DealFact, type DhState } from '../src/lib/settlement/deals-engine';
import { OFFICIAL_COMMISSION_BUCKETS, OFFICIAL_DH_OCT_1_5, PENDING_DEALS_HISTORY, composeSwap, dealsHistoryReport, officialBucketDeals } from '../src/lib/settlement/deals-report';
import { swapReport } from '../src/lib/settlement/metrics';
import { withSessionLock } from '../src/lib/settlement/deals-lock';
import { DISK_MEASURE_SQL, HISTORICAL_ROOT_FREE_BYTES, projectFactDisk } from '../src/lib/settlement/deals-disk';
import { MAX_CHUNK_BYTES, MAX_CHUNK_DEALS } from '../src/lib/settlement/deals-parse';

const title = { filter: '*', from: '2026-10-01', to: '2026-10-05', star: true };

function fact(partial: Partial<DealFact> & Pick<DealFact, 'deal' | 'serverDate'>): DealFact {
  return {
    login: '2000001', serverTime: `${partial.serverDate} 12:00:00`, entry: 'in', volume: 1,
    commission: -1, fee: 0, swap: 0, profit: 0, currency: 'USD', rate: 10000, ...partial,
  };
}

function publish(state: DhState, id: string, owner: string, deals: DealFact[], fileTitle = title, footer?: { commission: number; swap: number }) {
    const opened = openDhSession(state, { id, ownerId: owner, title: fileTitle });
  if (!opened.ok) throw new Error(opened.error);
  const chunk = applyDhChunk(opened.state, { sessionId: id, actorId: owner, seq: 1, hash: `h-${id}`, deals, byteLength: 100 });
  if (!chunk.ok) throw new Error(chunk.error);
  const sum = (field: 'commission' | 'swap') => Math.round(deals.reduce((total, deal) => total + deal[field], 0) * 100) / 100;
  const committed = commitDhSession(chunk.state, { sessionId: id, actorId: owner, footer: footer ?? { commission: sum('commission'), swap: sum('swap') } });
  if (!committed.ok) throw new Error(committed.error);
  return committed;
}

describe('deals history sessions', () => {
  const month = [
    fact({ deal: '1', serverDate: '2026-10-01', commission: -10 }),
    fact({ deal: '2', serverDate: '2026-10-03', commission: -4 }),
    fact({ deal: '3', serverDate: '2026-10-03', commission: -6, swap: -1 }),
    fact({ deal: '4', serverDate: '2026-10-05', commission: -2 }),
  ];
  const week = [month[1], month[3]];

  it('keeps deals a later subset omits, and a rerun does not double-count', () => {
    const first = publish(emptyDhState(), 'month', 'owner', month);
    const second = publish(first.state, 'week', 'owner', week, { filter: '*', from: '2026-10-03', to: '2026-10-05', star: true });
    assert.equal(second.value.inserted, 0);
    assert.equal(second.value.unchanged, 2);
    assert.equal(second.state.facts['1'].commission, -10);
    const again = publish(second.state, 'week-2', 'owner', week, { filter: '*', from: '2026-10-03', to: '2026-10-05', star: true });
    assert.equal(again.value.inserted, 0);
    assert.equal(again.value.updated, 0);
    assert.equal(again.value.unchanged, 2);
    const changed = publish(again.state, 'edit', 'owner', [{ ...month[1], commission: -9 }]);
    assert.equal(changed.value.updated, 1);
    assert.equal(changed.state.facts['2'].commission, -9);
    assert.equal(changed.state.facts['1'].commission, -10);
  });

  it('marks only a star file as full coverage and does not turn a real zero into pending', () => {
    const full = publish(emptyDhState(), 'full', 'owner', [fact({ deal: '9', serverDate: '2026-10-03', commission: 0, swap: 0 })]);
    assert.equal(full.state.coverage['2026-10-03'].status, 'full');
    const partial = publish(full.state, 'part', 'owner', [fact({ deal: '8', serverDate: '2026-10-06' })], { filter: 'group', from: '2026-10-06', to: '2026-10-06', star: false });
    assert.equal(partial.state.coverage['2026-10-06'].status, 'partial');
    assert.equal(partial.state.coverage['2026-10-03'].status, 'full');
    const report = dealsHistoryReport(Object.values(partial.state.facts), partial.state.coverage, ['2026-10-03', '2026-10-06', '2026-10-07']);
    assert.equal(report[0].swap?.[10000], 0);
    assert.equal(report[1].commission, null);
    assert.equal(report[2].status, 'missing');
  });

  it('rejects another user, replays the same chunk, and refuses a lower sequence overwrite', () => {
    const opened = openDhSession(emptyDhState(), { id: 's', ownerId: 'owner', title });
    if (!opened.ok) throw new Error(opened.error);
    const denied = applyDhChunk(opened.state, { sessionId: 's', actorId: 'other', seq: 1, hash: 'a', deals: [fact({ deal: '1', serverDate: '2026-10-01' })], byteLength: 10 });
    assert.equal(denied.ok, false);
    const first = applyDhChunk(opened.state, { sessionId: 's', actorId: 'owner', seq: 2, hash: 'new', deals: [fact({ deal: '1', serverDate: '2026-10-01', commission: -5 })], byteLength: 10 });
    if (!first.ok) throw new Error(first.error);
    const replay = applyDhChunk(first.state, { sessionId: 's', actorId: 'owner', seq: 2, hash: 'new', deals: [fact({ deal: '1', serverDate: '2026-10-01', commission: -9 })], byteLength: 10 });
    assert.equal(replay.ok && replay.value.idempotent, true);
    assert.equal(replay.ok && replay.state.sessions.s.staging['1'].commission, -5);
    const older = applyDhChunk(first.state, { sessionId: 's', actorId: 'owner', seq: 1, hash: 'old', deals: [fact({ deal: '1', serverDate: '2026-10-01', commission: -9 })], byteLength: 10 });
    assert.equal(older.ok && older.state.sessions.s.staging['1'].commission, -5);
  });

  it('aborts staging and a thrown commit leaves live facts unchanged', () => {
    const live = publish(emptyDhState(), 'live', 'owner', month);
    const opened = openDhSession(live.state, { id: 'bad', ownerId: 'owner', title });
    if (!opened.ok) throw new Error(opened.error);
    const staged = applyDhChunk(opened.state, { sessionId: 'bad', actorId: 'owner', seq: 1, hash: 'z', deals: [fact({ deal: '99', serverDate: '2026-10-02', commission: -50 })], byteLength: 10 });
    if (!staged.ok) throw new Error(staged.error);
    const aborted = abortDhSession(staged.state, { sessionId: 'bad', actorId: 'owner' });
    assert.equal(aborted.ok, true);
    assert.equal(aborted.ok && aborted.state.facts['99'], undefined);
    assert.equal(aborted.ok && aborted.state.facts['1'].commission, -10);
    assert.throws(() => commitDhSession(staged.state, {
      sessionId: 'bad', actorId: 'owner', footer: { commission: -50, swap: 0 }, beforePublish() { throw new Error('boom'); },
    }));
    assert.equal(staged.state.facts['99'], undefined);
    assert.equal(staged.state.facts['1'].commission, -10);
  });

  it('rejects a footer that does not match the parsed columns', () => {
    const opened = openDhSession(emptyDhState(), { id: 'f', ownerId: 'owner', title });
    if (!opened.ok) throw new Error(opened.error);
    const staged = applyDhChunk(opened.state, { sessionId: 'f', actorId: 'owner', seq: 1, hash: 'f', deals: [fact({ deal: '1', serverDate: '2026-10-01', commission: -10 })], byteLength: 10 });
    if (!staged.ok) throw new Error(staged.error);
    const rejected = commitDhSession(staged.state, { sessionId: 'f', actorId: 'owner', footer: { commission: -11, swap: 0 } });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.state.facts['1'], undefined);
    assert.equal(footerMatches([fact({ deal: '1', serverDate: '2026-10-01', commission: -10 })], { commission: -10, swap: 0 }), true);
  });

  it('reproduces the audited 01–05 Oct buckets and keeps phase 1 swap beside a pending deals term', () => {
    const deals = officialBucketDeals();
    const coverage = Object.fromEntries(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05'].map(date => [date, { status: 'full' as const }]));
    const report = dealsHistoryReport(deals, coverage, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    for (const bucket of OFFICIAL_COMMISSION_BUCKETS) {
      const day = report.find(row => row.date === bucket.date);
      assert.deepEqual(day?.commission, { 1: bucket.usd, 10000: bucket.r10000, 12000: bucket.r12000, 14000: bucket.r14000 });
      assert.deepEqual(day?.swap, { 1: 0, 10000: 0, 12000: 0, 14000: 0 });
    }
    assert.equal(report.find(row => row.date === '2026-10-04')?.status, 'missing');
    const total = deals.filter(deal => deal.entry === 'in').reduce((sum, deal) => sum + deal.commission, 0);
    assert.equal(Math.round(total * 100) / 100, OFFICIAL_DH_OCT_1_5.commission);
    assert.equal(deals.reduce((sum, deal) => sum + deal.swap, 0), OFFICIAL_DH_OCT_1_5.swap);
    assert.equal(OFFICIAL_DH_OCT_1_5.uniqueDeals, 390366);
    const crm = swapReport([], { from: '2026-10-01', to: '2026-10-05' });
    const composed = composeSwap(crm, report);
    assert.equal(composed.find(day => day.date === '2026-10-04')?.dealsStatus, 'missing');
    assert.equal(PENDING_DEALS_HISTORY, 'Pending: Deals History');
  });

  it('locks one session so parallel chunks cannot drop each other', async () => {
    const state = openDhSession(emptyDhState(), { id: 'lock', ownerId: 'owner', title });
    if (!state.ok) throw new Error(state.error);
    const current = state.state;
    const apply = (seq: number, deal: string) => withSessionLock('lock', async () => {
      const snapshot = currentState;
      await new Promise(resolve => setTimeout(resolve, 5));
      const applied = applyDhChunk(snapshot, { sessionId: 'lock', actorId: 'owner', seq, hash: deal, deals: [fact({ deal, serverDate: '2026-10-01' })], byteLength: 10 });
      if (!applied.ok) throw new Error(applied.error);
      currentState = applied.state;
    });
    let currentState = current;
    await Promise.all([apply(1, 'a'), apply(2, 'b')]);
    assert.deepEqual(Object.keys(currentState.sessions.lock.staging).sort(), ['a', 'b']);
  });

  it('projects disk growth without deleting and caps a chunk at 2000 deals and 25 MB', () => {
    assert.equal(projectFactDisk(390366, 256).bytes, 390366 * 256);
    assert.equal(projectFactDisk(1, HISTORICAL_ROOT_FREE_BYTES + 1).exceedsHistoricalSnapshot, true);
    assert.match(DISK_MEASURE_SQL, /pg_total_relation_size/);
    assert.match(DISK_MEASURE_SQL, /settlement_mt5_deal_facts/);
    assert.doesNotMatch(DISK_MEASURE_SQL, /DELETE/i);
    const opened = openDhSession(emptyDhState(), { id: 'cap', ownerId: 'owner', title });
    if (!opened.ok) throw new Error(opened.error);
    const tooMany = Array.from({ length: MAX_CHUNK_DEALS + 1 }, (_, index) => fact({ deal: String(index + 1), serverDate: '2026-10-01' }));
    assert.equal(applyDhChunk(opened.state, { sessionId: 'cap', actorId: 'owner', seq: 1, hash: 'big', deals: tooMany, byteLength: 100 }).ok, false);
    assert.equal(applyDhChunk(opened.state, { sessionId: 'cap', actorId: 'owner', seq: 1, hash: 'big', deals: [fact({ deal: '1', serverDate: '2026-10-01' })], byteLength: MAX_CHUNK_BYTES + 1 }).ok, false);
  });

  it('mergeIncoming does not require facts that are absent from the file', () => {
    const merged = mergeIncoming({ '2': fact({ deal: '2', serverDate: '2026-10-03', commission: -4 }) }, [fact({ deal: '2', serverDate: '2026-10-03', commission: -4 })]);
    assert.deepEqual(merged, { upserts: [], touchedDates: [], inserted: 0, updated: 0, unchanged: 1 });
  });
});
