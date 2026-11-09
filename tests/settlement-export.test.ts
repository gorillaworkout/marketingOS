import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as XLSX from 'xlsx';
import { parseCrmDeposits, parseCrmWithdrawals } from '../src/lib/settlement/crm-parse';
import { parseMt5DepositWithdrawal } from '../src/lib/settlement/mt5-parse';
import { SETTLEMENT_SHEETS, buildReconciliationWorkbook, buildSettlementWorkbook, marginRows } from '../src/lib/settlement/export';
import { parseSettlementFtd } from '../src/lib/settlement/ftd-parse';
import { buildDailyReconciliation } from '../src/lib/settlement/reconcile';
import { SWAP_LABEL, buildSettlementReport, resolveSettlementPeriod } from '../src/lib/settlement/report';
import { DAY, crmDepositXlsx, crmWithdrawalXlsx, dayDeals, dayDeposits, dayWithdrawals, ftdRows, ftdXlsx, mt5DwText } from './fixtures/settlement';

const deposits = parseCrmDeposits(crmDepositXlsx(dayDeposits)).rows;
const withdrawals = parseCrmWithdrawals(crmWithdrawalXlsx(dayWithdrawals)).rows;
const deals = parseMt5DepositWithdrawal(mt5DwText(dayDeals)).rows;

describe('settlement export', () => {
  const period = resolveSettlementPeriod('week', DAY);
  const report = buildSettlementReport({
    period, deposits, withdrawals, swapDeals: deals, yearDeposits: deposits, yearWithdrawals: withdrawals,
    ftd: parseSettlementFtd(ftdXlsx(ftdRows)).rows, holidays: new Set(), coverage: { settlement_mt5_dw: '2026-11-06' },
  });

  it('writes one sheet per section and marks months without FTD as pending', () => {
    const book = XLSX.read(buildSettlementWorkbook(report), { type: 'buffer' });
    assert.deepEqual(book.SheetNames, [...SETTLEMENT_SHEETS]);
    const pending = marginRows({ ...report, margin: [{ ...report.margin[0], idrInitialMargin: null, usdInitialMargin: null, idrDepositExIm: null, usdDepositExIm: null }] });
    assert.equal(pending[1][1], 'Pending: Dealing FTD list');
    const swapSheet = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Swap, { header: 1 });
    assert.equal(swapSheet[0][0], SWAP_LABEL);
  });

  it('exports the daily CRM and MT5 blocks', () => {
    const daily = buildDailyReconciliation(DAY, deposits, withdrawals, deals);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(buildReconciliationWorkbook(daily), { type: 'buffer' }).Sheets['Daily Report'], { header: 1 });
    assert.equal(rows[0][0], 'Daily Report Deposit and Withdrawal 2026-11-05 12:00:01 – 2026-11-06 12:00:00 WIB');
    assert.ok(rows.some(r => r[0] === 'MT5'));
    assert.ok(rows.some(r => r[0] === 'WD-2' && r[2] === -25));
  });

});
