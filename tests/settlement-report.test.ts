import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCrmDeposits, parseCrmWithdrawals } from '../src/lib/settlement/crm-parse';
import { parseMt5DepositWithdrawal } from '../src/lib/settlement/mt5-parse';
import { parseSettlementFtd } from '../src/lib/settlement/ftd-parse';
import { buildDailyReconciliation } from '../src/lib/settlement/reconcile';
import { reconciliationWindow } from '../src/lib/settlement/conventions';
import { SWAP_LABEL, buildSettlementReport, mismatchState, resolveSettlementPeriod, settlementCrmRange, shapeReconciliation, wibBounds, weeksTouching } from '../src/lib/settlement/report';
import { DAY, crmDepositXlsx, crmWithdrawalXlsx, dayDeals, dayDeposits, dayWithdrawals, ftdRows, ftdXlsx, mt5DwText } from './fixtures/settlement';

const deposits = parseCrmDeposits(crmDepositXlsx(dayDeposits)).rows;
const withdrawals = parseCrmWithdrawals(crmWithdrawalXlsx(dayWithdrawals)).rows;
const deals = parseMt5DepositWithdrawal(mt5DwText(dayDeals)).rows;

describe('settlement periods (weeks Monday–Sunday)', () => {
  it('resolves day, Mon–Sun week (across months), month and custom', () => {
    assert.deepEqual(resolveSettlementPeriod('day', '2026-11-06').range, { from: '2026-11-06', to: '2026-11-06' });
    assert.deepEqual(resolveSettlementPeriod('week', '2026-11-08').range, { from: '2026-11-02', to: '2026-11-08' });
    assert.deepEqual(resolveSettlementPeriod('week', '2026-10-01').range, { from: '2026-09-28', to: '2026-10-04' });
    assert.deepEqual(resolveSettlementPeriod('month', '2026-02-10').range, { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(resolveSettlementPeriod('custom', '', '2026-10-01', '2026-10-31').range, { from: '2026-10-01', to: '2026-10-31' });
    assert.throws(() => resolveSettlementPeriod('custom', '', '2026-01-01', '2026-12-31'), /limited to 93 days/);
    assert.throws(() => resolveSettlementPeriod('year', '2026-01-01'), /not supported/);
    const day = resolveSettlementPeriod('day', '2026-11-10');
    assert.equal(day.basis, 'noon');
    assert.deepEqual(day.window, reconciliationWindow('2026-11-10'));
    assert.equal(resolveSettlementPeriod('week', '2026-11-08').basis, 'calendar');
    assert.equal(resolveSettlementPeriod('month', '2026-02-10').basis, 'calendar');
    assert.equal(resolveSettlementPeriod('custom', '', '2026-10-01', '2026-10-31').basis, 'calendar');
  });

  it('computes WIB bounds and full weeks', () => {
    assert.deepEqual(wibBounds({ from: '2026-11-06', to: '2026-11-06' }), { fromIso: '2026-11-05T17:00:00.000Z', toIso: '2026-11-06T17:00:00.000Z' });
    assert.deepEqual(weeksTouching({ from: '2026-10-01', to: '2026-10-31' }), { from: '2026-09-28', to: '2026-11-01' });
  });
});

describe('settlement report assembly', () => {
  const period = resolveSettlementPeriod('week', DAY);
  const report = buildSettlementReport({
    period, deposits, withdrawals, swapDeals: deals, yearDeposits: deposits, yearWithdrawals: withdrawals,
    ftd: parseSettlementFtd(ftdXlsx(ftdRows)).rows, holidays: new Set(), coverage: { settlement_mt5_dw: '2026-11-06' },
  });

  it('assembles every section', () => {
    assert.equal(report.applications.deposit, 6);
    assert.equal(report.withdrawalWeeks[0].weekStart, '2026-11-02');
    assert.equal(report.margin[0].idrInitialMargin, 900000);
    assert.equal(report.swap.totalSwap[10000], -1.5);
    assert.equal(report.swapLabel, SWAP_LABEL);
    assert.deepEqual(report.previousRange, { from: '2026-10-26', to: '2026-11-01' });
    assert.equal(report.summary.current.totals.deposit.count > 0, true);
    assert.equal(report.summary.previous.range.from, '2026-10-26');
    assert.equal(report.daily.length, 7);
    assert.equal(report.daily[0].date, '2026-11-02');
    const january = resolveSettlementPeriod('month', '2026-01-15');
    assert.equal(settlementCrmRange(january).from, '2025-12-01');
  });

  it('pages and masks the mismatch list and marks pending vs missing', () => {
    const daily = buildDailyReconciliation(DAY, deposits, withdrawals, deals);
    const shaped = shapeReconciliation(daily, 'mt5_only', 1, v => `${v.slice(0, 2)}***`, Date.parse('2026-11-06T06:00:00Z'));
    assert.deepEqual(shaped.mismatchCounts, { crm_only: 0, mt5_only: 1, amount_diff: 0, account_diff: 0 });
    assert.equal(shaped.list?.items[0].accountNo, '24***');
    assert.equal(shaped.list?.items[0].state, 'pending');
    assert.equal(mismatchState('2026-11-01T00:00:00Z', Date.parse('2026-11-06T00:00:00Z')), 'missing');
    assert.equal(shapeReconciliation(daily, null, 1, v => v).list, null);
  });
});
