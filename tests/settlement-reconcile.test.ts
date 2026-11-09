import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCrmDeposits, parseCrmWithdrawals } from '../src/lib/settlement/crm-parse';
import { parseMt5DepositWithdrawal } from '../src/lib/settlement/mt5-parse';
import { buildDailyReconciliation } from '../src/lib/settlement/reconcile';
import { DAY, crmDepositXlsx, crmWithdrawalXlsx, dayDeals, dayDeposits, dayWithdrawals, mt5DwText } from './fixtures/settlement';

const deposits = parseCrmDeposits(crmDepositXlsx(dayDeposits)).rows;
const withdrawals = parseCrmWithdrawals(crmWithdrawalXlsx(dayWithdrawals)).rows;
const deals = parseMt5DepositWithdrawal(mt5DwText(dayDeals)).rows;
const line = (block: { byRate: Array<{ rate: number; deposit: number; withdrawal: number }> }, rate: number) => block.byRate.find(l => l.rate === rate);

describe('settlement daily reconciliation', () => {
  const report = buildDailyReconciliation(DAY, deposits, withdrawals, deals);

  it('CRM block: deposits by completion, withdrawals by request, rejects and WD-2', () => {
    assert.deepEqual(report.crm.clients, { deposit: 4, withdrawal: 3, reject: 2 });
    assert.deepEqual(line(report.crm, 10000), { rate: 10000, deposit: 20, withdrawal: -15, total: 5 });
    assert.deepEqual(line(report.crm, 14000), { rate: 14000, deposit: 70, withdrawal: -60, total: 10 });
    assert.deepEqual(line(report.crm, 1), { rate: 1, deposit: 50, withdrawal: 0, total: 50 });
    assert.deepEqual(report.crm.differences.map(d => [d.label, d.amount, d.count]), [['Deposit Reject', 40, 1], ['WD Reject', -35, 1], ['WD-2', -25, 1]]);
    assert.deepEqual(report.crm.total, { deposit: 100, withdrawal: -15, net: 85 });
  });

  it('MT5 block: D/W/WC only, WC counted as deposit and shown as the difference', () => {
    assert.deepEqual(report.mt5.clients, { deposit: 5, withdrawal: 3, reject: 1 });
    assert.deepEqual(line(report.mt5, 14000), { rate: 14000, deposit: 70, withdrawal: -60, total: 10 });
    assert.deepEqual(report.mt5.differences.map(d => [d.label, d.amount]), [['CRM-WC', 35]]);
    assert.deepEqual(report.mt5.total, { deposit: 105, withdrawal: -75, net: 30 });
  });

  it('lists only real mismatches', () => {
    assert.deepEqual(report.mismatches.map(m => [m.reason, m.reference]), [['mt5_only', '9999']]);
    const shifted = buildDailyReconciliation(DAY, deposits, withdrawals, deals.map(d => (d.deal === '502' ? { ...d, amountUsd: 31 } : d)));
    assert.deepEqual(shifted.mismatches.map(m => m.reason).sort(), ['amount_diff', 'mt5_only']);
  });
});
