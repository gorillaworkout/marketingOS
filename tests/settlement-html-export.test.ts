import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseCrmDeposits, parseCrmWithdrawals } from '../src/lib/settlement/crm-parse';
import { PENDING_DEALS_HISTORY } from '../src/lib/settlement/deals-report';
import { buildSettlementWorkbook, overviewRows } from '../src/lib/settlement/export';
import { buildSettlementHtml, settlementHtmlFileName } from '../src/lib/settlement/html-export';
import { parseSettlementFtd } from '../src/lib/settlement/ftd-parse';
import { parseMt5DepositWithdrawal } from '../src/lib/settlement/mt5-parse';
import { buildDailyReconciliation } from '../src/lib/settlement/reconcile';
import { buildSettlementReport, resolveSettlementPeriod } from '../src/lib/settlement/report';
import { DAY, crmDepositXlsx, crmWithdrawalXlsx, dayDeals, dayDeposits, dayWithdrawals, ftdRows, ftdXlsx, mt5DwText } from './fixtures/settlement';

const deposits = parseCrmDeposits(crmDepositXlsx(dayDeposits)).rows;
const withdrawals = parseCrmWithdrawals(crmWithdrawalXlsx(dayWithdrawals)).rows;
const deals = parseMt5DepositWithdrawal(mt5DwText(dayDeals)).rows;

function weeklyReport() {
  const period = resolveSettlementPeriod('week', DAY);
  return buildSettlementReport({
    period, deposits, withdrawals, swapDeals: deals, yearDeposits: deposits, yearWithdrawals: withdrawals,
    ftd: parseSettlementFtd(ftdXlsx(ftdRows)).rows, holidays: new Set(),
    coverage: { settlement_crm_deposit: '2026-11-06', settlement_mt5_dw: null, settlement_ftd: null },
  });
}

test('settlement HTML names the period and escapes text', () => {
  const report = weeklyReport();
  report.swapLabel = '<script>alert(1)</script>';
  const html = buildSettlementHtml(report, { reconciliation: buildDailyReconciliation(DAY, deposits, withdrawals, deals) });
  assert.equal(settlementHtmlFileName(report), 'settlement-report-weekly-2026-11-02_2026-11-08.html');
  assert.match(html, /Weekly Settlement Report/);
  assert.match(html, /REPORT PERIOD/);
  assert.match(html, /12:00/);
  assert.match(html, /Pending: Dealing FTD/);
  assert.match(html, /Pending: MT5 D&amp;W/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /@media \(max-width: 760px\)/);
  assert.match(html, /@media \(max-width: 420px\)/);
  assert.match(html, /@media print/);
  assert.doesNotMatch(html, /src="http/);
});

test('HTML totals equal the workbook and a missing commission stays Pending', () => {
  const report = weeklyReport();
  report.jisdor = [{ date: '2026-11-06', rate: 18130 }, { date: '2026-11-09', rate: 18103 }];
  const html = buildSettlementHtml(report);
  const book = XLSX.read(buildSettlementWorkbook(report), { type: 'buffer' });
  const overview = overviewRows(report);
  const depositsIdr = overview.find(row => row[0] === 'Deposits IDR')?.[1];
  const withdrawalsIdr = overview.find(row => row[0] === 'Withdrawals IDR')?.[1];
  const net = overview.find(row => row[0] === 'Net IDR')?.[1];
  assert.match(html, new RegExp(`data-xlsx="${depositsIdr}"`));
  assert.match(html, new RegExp(`data-xlsx="${withdrawalsIdr}"`));
  assert.match(html, new RegExp(`data-xlsx="${net}"`));
  const sheetDeposits = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Overview, { header: 1 }).find(row => row[0] === 'Deposits IDR')?.[1];
  assert.equal(sheetDeposits, depositsIdr);
  assert.match(html, new RegExp(`data-xlsx="${PENDING_DEALS_HISTORY}"`));
  assert.match(html, /Commission IDR \(Σ × rate\)<\/td><td class="num" data-xlsx="Pending: Deals History"/);
  const total = html.match(/<tr class="total"><td data-xlsx="Total">Total<\/td><td class="num" data-xlsx="([^"]*)"/);
  assert.equal(Number(total?.[1]), depositsIdr);
  assert.match(html, /2026-11-09/);
  assert.match(html, /18103/);
});

test('the HTML export route stays behind the settlement access check', () => {
  const route = readFileSync('src/app/api/settlement-report/export/route.ts', 'utf8');
  const auth = route.indexOf('requireSettlementReport');
  const html = route.indexOf("format === 'html'");
  const docx = route.indexOf("format === 'docx'");
  assert.ok(auth >= 0 && html > auth && docx > auth);
  assert.match(route, /settlementHtmlFileName/);
  assert.match(route, /settlementDocxFileName/);
});
