import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WITHDRAWAL_PCT_KPI, withdrawalPctMethodology, type WithdrawalPctMode } from '../src/lib/settlement/kpi-config';
import { buildKpis, withdrawalPctCards } from '../src/lib/settlement/kpis';
import type { PeriodSummary } from '../src/lib/settlement/summary';

const summary = (officeHourPct: number | null, ofDepositsPct: number | null, office = 80, total = 100): PeriodSummary => ({
  range: { from: '2026-10-01', to: '2026-10-31' },
  totals: {
    deposit: { idr: 1000, usd: 10, count: 4 },
    withdrawal: { idr: 400, usd: 2, count: 2 },
    netIdr: 600,
    withdrawalPct: { officeHourPct, ofDepositsPct, office, second: total - office, total },
  },
  processing: { deposit: 252, withdrawal: 600 },
  commission: {
    status: 'complete', commissionByRate: { 1: -10, 10000: -2, 12000: 0, 14000: 0 }, swapByRate: { 1: 0, 10000: 0, 12000: 0, 14000: 0 },
    commissionIdr: -20000, commissionUsd: -10, observedDays: 31, attestedDays: 0, pendingDays: 0, totalDays: 31, lastCoveredDate: '2026-10-31',
  },
});

describe('withdrawal % configuration', () => {
  it('keeps the decided office-hour mode as the only definition point', () => {
    const modes: WithdrawalPctMode[] = ['office-hour', 'wd-over-dep', 'both'];
    assert.ok(modes.includes(WITHDRAWAL_PCT_KPI));
    assert.equal(WITHDRAWAL_PCT_KPI, 'office-hour');
  });

  it('builds one or two cards from the mode without hard-coding the choice', () => {
    const current = summary(80, 40);
    const office = withdrawalPctCards(current, 'office-hour');
    assert.equal(office.length, 1);
    assert.equal(office[0].label, 'Withdrawal % (office hour)');
    assert.equal(office[0].value, 80);
    assert.equal(office[0].favourable, 'up');
    assert.equal(office[0].note, '80 of 100 same-day');
    const ratio = withdrawalPctCards(current, 'wd-over-dep');
    assert.equal(ratio[0].label, 'Withdrawal % (of deposits)');
    assert.equal(ratio[0].value, 40);
    assert.equal(ratio[0].favourable, 'down');
    assert.equal(ratio[0].note, 'Withdrawals ÷ deposits (IDR)');
    const both = withdrawalPctCards(current, 'both');
    assert.deepEqual(both.map(card => card.label), ['Withdrawal % (office hour)', 'Withdrawal % (of deposits)']);
    assert.match(withdrawalPctMethodology('office-hour'), /2nd withdrawal/);
    assert.match(withdrawalPctMethodology('both'), /deposits/);
  });

  it('builds the KPI strip and keeps commission pending instead of zero', () => {
    const previous = summary(70, 50, 70, 100);
    previous.totals.deposit.idr = 800;
    previous.processing.deposit = 290;
    const cards = buildKpis({ current: summary(80, 40), previous });
    assert.deepEqual(cards.map(card => card.label), [
      'Deposits', 'Withdrawals', 'Net margin in–out', 'Withdrawal % (office hour)', 'Avg processing', 'Commission',
    ]);
    const pending = summary(80, 40);
    pending.commission = { ...pending.commission!, status: 'pending', pendingDays: 26, observedDays: 5, totalDays: 31 };
    const open = buildKpis({ current: pending, previous });
    const commission = open.find(card => card.id === 'commission');
    assert.equal(commission?.pending, true);
    assert.equal(commission?.value, null);
    assert.equal(commission?.delta, null);
    const closed = cards.find(card => card.id === 'commission');
    assert.equal(closed?.pending, false);
    assert.ok(closed?.delta);
  });
});
