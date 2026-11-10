import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCrmDeposits, parseCrmWithdrawals } from '../src/lib/settlement/crm-parse';
import { settlementDayOf } from '../src/lib/settlement/conventions';
import { dealsHistoryReport, officialBucketDeals } from '../src/lib/settlement/deals-report';
import { resolveSettlementPeriod } from '../src/lib/settlement/report';
import { coverageTone, dailyFlows, dealsHistorySummary, periodTotals, previousSettlementRange, sourceFreshness } from '../src/lib/settlement/summary';
import { crmDepositXlsx, crmWithdrawalXlsx, type CrmRowInput } from './fixtures/settlement';

const at = (request: string, complete: string, usd: number, extra: Partial<CrmRowInput> = {}): CrmRowInput => ({
  reference: request, account: '2000011', request, complete, usd, ...extra,
});

describe('previous settlement range', () => {
  it('steps a day, a week across a month, a year boundary and a custom length', () => {
    assert.deepEqual(previousSettlementRange(resolveSettlementPeriod('day', '2026-11-10')), { from: '2026-11-09', to: '2026-11-09' });
    assert.deepEqual(previousSettlementRange(resolveSettlementPeriod('week', '2026-10-01')), { from: '2026-09-21', to: '2026-09-27' });
    assert.deepEqual(previousSettlementRange(resolveSettlementPeriod('month', '2026-01-15')), { from: '2025-12-01', to: '2025-12-31' });
    assert.deepEqual(previousSettlementRange(resolveSettlementPeriod('custom', '', '2026-10-10', '2026-10-12')), { from: '2026-10-07', to: '2026-10-09' });
  });
});

describe('period totals and daily flows', () => {
  const deposits = parseCrmDeposits(crmDepositXlsx([
    at('10/11/2026 11:00:00', '10/11/2026 11:30:00', 10, { account: '2000011' }),
    at('10/11/2026 11:10:00', '10/11/2026 11:40:00', 20, { account: '2900033', reference: 'usd' }),
    at('10/11/2026 11:20:00', '10/11/2026 11:25:00', 5, { status: 'Unsuccessful', reference: 'bad' }),
    at('09/11/2026 10:00:00', '11/11/2026 09:00:00', 7, { reference: 'late' }),
  ])).rows;
  const withdrawals = parseCrmWithdrawals(crmWithdrawalXlsx([
    at('10/11/2026 10:00:00', '10/11/2026 10:20:00', 4, { account: '2000011' }),
    at('10/11/2026 11:00:00', '11/11/2026 09:00:00', 6, { account: '2400022', reference: 'second' }),
    at('10/11/2026 12:30:00', '10/11/2026 12:40:00', 3, { status: 'Unsuccessful', reference: 'next-window' }),
  ])).rows;

  it('sums successful money by completion or request day and both withdrawal ratios', () => {
    const totals = periodTotals(deposits, withdrawals, { from: '2026-11-10', to: '2026-11-10' }, settlementDayOf);
    assert.equal(totals.deposit.idr, 10 * 10000);
    assert.equal(totals.deposit.usd, 20);
    assert.equal(totals.deposit.count, 2);
    assert.equal(totals.withdrawal.idr, (4 * 10000) + (6 * 14000));
    assert.equal(totals.withdrawal.count, 2);
    assert.equal(totals.withdrawalPct.officeHourPct, 50);
    assert.equal(totals.withdrawalPct.ofDepositsPct, totals.withdrawal.idr / totals.deposit.idr * 100);
    assert.equal(periodTotals([], [], { from: '2026-11-10', to: '2026-11-10' }, settlementDayOf).withdrawalPct.officeHourPct, null);
    assert.equal(periodTotals([], [], { from: '2026-11-10', to: '2026-11-10' }, settlementDayOf).withdrawalPct.ofDepositsPct, null);
  });

  it('writes one daily row per date, with zeros where nothing settled', () => {
    const rows = dailyFlows(deposits, withdrawals, { from: '2026-11-10', to: '2026-11-11' }, settlementDayOf);
    assert.deepEqual(rows.map(row => row.date), ['2026-11-10', '2026-11-11']);
    assert.equal(rows[0].depositIdr, 10 * 10000);
    assert.equal(rows[1].depositIdr, 7 * 10000);
    assert.equal(rows[1].withdrawalIdr, 0);
    assert.equal(rows[1].netIdr, 7 * 10000);
  });
});

describe('deals history summary', () => {
  const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05'];
  const days = dealsHistoryReport(officialBucketDeals(), {}, dates);

  it('sums the audited October buckets and marks a gap as pending', () => {
    const summary = dealsHistorySummary(days);
    assert.equal(summary.status, 'complete');
    assert.equal(summary.commissionIdr, -663_133_880);
    assert.deepEqual(summary.commissionByRate, { 1: -100.79, 10000: -14033.77, 12000: -66.89, 14000: -37285.25 });
    const missing = dealsHistorySummary(dealsHistoryReport(officialBucketDeals(), {}, [...dates, '2026-10-04']));
    assert.equal(missing.status, 'pending');
    assert.equal(missing.pendingDays, 1);
    const attested = dealsHistorySummary(dealsHistoryReport([], { '2026-10-04': { status: 'attested' } }, ['2026-10-04']));
    assert.equal(attested.status, 'complete');
    assert.equal(attested.attestedDays, 1);
    assert.equal(attested.pendingDays, 0);
  });

  it('grades source freshness against yesterday and coverage against the period end', () => {
    assert.deepEqual(sourceFreshness(null, '2026-11-10'), { status: 'none' });
    assert.deepEqual(sourceFreshness('2026-11-09', '2026-11-10'), { status: 'current' });
    assert.deepEqual(sourceFreshness('2026-11-08', '2026-11-10'), { status: 'behind', days: 2 });
    assert.equal(coverageTone('2026-11-10', '2026-11-10'), 'ok');
    assert.equal(coverageTone('2026-11-09', '2026-11-10'), 'warn');
    assert.equal(coverageTone(null, '2026-11-10'), 'warn');
  });
});
