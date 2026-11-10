import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyDhChunk, commitDhSession, emptyDhState, openDhSession, type DhState } from '../src/lib/settlement/deals-engine';
import { ingestDealsBytes } from '../src/lib/settlement/deals-ingest';
import { ATTESTED_EMPTY } from '../src/lib/settlement/deals-report';
import { swapRows } from '../src/lib/settlement/export';
import { buildSettlementReport, resolveSettlementPeriod } from '../src/lib/settlement/report';

function utf16(text: string): Uint8Array {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

describe('deals history ingest reaches commit', () => {
  it('streams a split UTF-16 file through open, chunk, and commit', async () => {
    const text = [
      "Trades\\Deals History Report for '*' from '2026.10.01' to '2026.10.01'",
      'Deal\tLogin\tName\tTime\tEntry\tVolume\tCommission\tFee\tSwap\tProfit\tCurrency\tComment',
      '10\t2000001\t"Quoted\tName"\t2026.10.01 01:00:00\tin\t1\t-2.50\t0\t0\t0\tUSD\tnote',
      '11\t2400001\tClient\t2026.10.01 02:00:00\tin\t1\t-1.25\t0\t-0.50\t0\tUSD\t',
      'Total\t\t\t\t\t2\t-3.75\t0\t-0.50\t0\t\t',
    ].join('\r\n') + '\r\n';
    const bytes = utf16(text);
    const cut = 9;
    let state: DhState = emptyDhState();
    let sessionId = '';
    await ingestDealsBytes((async function* () {
      yield bytes.subarray(0, cut);
      yield bytes.subarray(cut);
    })(), {
      open: async title => {
        const opened = openDhSession(state, { id: 'file', ownerId: 'owner', title: { filter: '*', from: '2026-10-01', to: '2026-10-01', star: true } });
        if (!opened.ok) throw new Error(opened.error);
        assert.match(title, /for '\*'/);
        state = opened.state;
        sessionId = 'file';
      },
      chunk: async deals => {
        const applied = applyDhChunk(state, { sessionId, actorId: 'owner', seq: 1, hash: 'stream', deals, byteLength: 100 });
        if (!applied.ok) throw new Error(applied.error);
        state = applied.state;
      },
      commit: async (footer, confirmation) => {
        const committed = commitDhSession(state, { sessionId, actorId: 'owner', eof: true, declaredCount: confirmation.deals, footer });
        if (!committed.ok) throw new Error(committed.error);
        state = committed.state;
      },
    });
    assert.equal(state.facts['10'].commission, -2.5);
    assert.equal(state.facts['11'].swap, -0.5);
    assert.equal(state.facts['10'].login, '2000001');
    assert.equal(state.coverage['2026-10-01'].status, 'attested');
    assert.equal('name' in state.facts['10'], false);
  });

  it('does not publish coverage when a broad title stops before the last chunks and footer', async () => {
    const text = [
      "Trades\\Deals History Report for '*' from '2026.10.01' to '2026.10.31'",
      'Deal\tLogin\tName\tTime\tEntry\tVolume\tCommission\tFee\tSwap\tProfit\tCurrency\tComment',
      '10\t2000001\tClient\t2026.10.01 01:00:00\tin\t1\t-2.50\t0\t0\t0\tUSD\t',
      '11\t2000001\tClient\t2026.10.15 01:00:00\tin\t1\t-1.00\t0\t0\t0\tUSD\t',
    ].join('\r\n');
    let state: DhState = emptyDhState();
    await assert.rejects(() => ingestDealsBytes((async function* () { yield utf16(text); })(), {
      open: async () => {
        const opened = openDhSession(state, { id: 'cut', ownerId: 'owner', title: { filter: '*', from: '2026-10-01', to: '2026-10-31', star: true } });
        if (!opened.ok) throw new Error(opened.error);
        state = opened.state;
      },
      chunk: async deals => {
        const applied = applyDhChunk(state, { sessionId: 'cut', actorId: 'owner', seq: 1, hash: 'partial', deals, byteLength: 80 });
        if (!applied.ok) throw new Error(applied.error);
        state = applied.state;
      },
      commit: async () => { throw new Error('commit must not run'); },
    }), /footer was not parsed/);
    const aborted = commitDhSession(state, { sessionId: 'cut', actorId: 'owner', eof: false, declaredCount: 4, footer: { commission: -3.5, swap: 0 } });
    assert.equal(aborted.ok, false);
    assert.equal(aborted.state.sessions.cut.status, 'aborted');
    assert.equal(aborted.state.facts['10'], undefined);
    assert.equal(aborted.state.coverage['2026-10-01'], undefined);
    assert.equal(aborted.state.coverage['2026-10-15'], undefined);
    assert.equal(aborted.state.coverage['2026-10-31'], undefined);
  });
});

describe('swap export writes deals-history numbers, not a silent zero', () => {
  it('keeps CRM-SR once and prints Pending for a day that is not full', () => {
    const period = resolveSettlementPeriod('day', '2026-10-01');
    const report = buildSettlementReport({
      period, deposits: [], withdrawals: [], swapDeals: [], yearDeposits: [], yearWithdrawals: [], ftd: [], holidays: new Set(), coverage: {},
    });
    report.dealsHistory = [
      { date: '2026-10-01', status: 'observed', commission: { 1: -24.96, 10000: 0, 12000: 0, 14000: 0 }, swap: { 1: 0, 10000: 0, 12000: 0, 14000: 0 }, outCommission: 0 },
      { date: '2026-10-04', status: 'attested', commission: null, swap: null, outCommission: null },
      { date: '2026-10-06', status: 'missing', commission: null, swap: null, outCommission: null },
    ];
    const rows = swapRows(report);
    const header = rows[1].join('|');
    assert.equal(header.match(/CRM-SR/g)?.length, 4);
    const dhAt = rows.findIndex(row => String(row[0]).startsWith('Deals History swap'));
    const dhRows = rows.slice(dhAt + 2);
    assert.deepEqual(dhRows[0], ['2026-10-01', 0, 0, 0, 0]);
    assert.deepEqual(dhRows[1]?.slice(1), [ATTESTED_EMPTY, ATTESTED_EMPTY, ATTESTED_EMPTY, ATTESTED_EMPTY]);
    assert.deepEqual(dhRows[2]?.slice(1), ['Pending: Deals History', 'Pending: Deals History', 'Pending: Deals History', 'Pending: Deals History']);
  });
});
