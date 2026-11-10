import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { parseCrmDeposits, parseCrmWithdrawals } from '../src/lib/settlement/crm-parse';
import { PENDING_DEALS_HISTORY } from '../src/lib/settlement/deals-report';
import { buildSettlementDocx, settlementDocxFileName } from '../src/lib/settlement/docx-export';
import { overviewRows } from '../src/lib/settlement/export';
import { parseSettlementFtd } from '../src/lib/settlement/ftd-parse';
import { formatIdr } from '../src/lib/settlement/format';
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
    coverage: { settlement_crm_deposit: '2026-11-06', settlement_crm_withdrawal: null, settlement_mt5_dw: '2026-11-06', settlement_ftd: null },
  });
}

test('the settlement docx is a Word file with headings, tables, and the workbook figures', async () => {
  const report = weeklyReport();
  report.jisdor = [{ date: '2026-11-06', rate: 18130 }, { date: '2026-11-09', rate: 18103 }];
  const buffer = await buildSettlementDocx(report, { reconciliation: buildDailyReconciliation(DAY, deposits, withdrawals, deals) });
  assert.equal(settlementDocxFileName(report), 'settlement-report-weekly-2026-11-02_2026-11-08.docx');
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('[Content_Types].xml'));
  const document = await zip.file('word/document.xml')?.async('string');
  const header = await zip.file('word/header1.xml')?.async('string');
  const footer = await zip.file('word/footer1.xml')?.async('string');
  assert.ok(document && header && footer);
  assert.match(document, /w:val="Heading1"/);
  assert.match(document, /w:val="Heading2"/);
  assert.match(document, /<w:tbl[\s>]/);
  assert.doesNotMatch(document, /<w:drawing[\s>]/);
  const depositsIdr = overviewRows(report).find(row => row[0] === 'Deposits IDR')?.[1];
  assert.equal(typeof depositsIdr, 'number');
  assert.match(document, new RegExp(formatIdr(depositsIdr as number).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(document, new RegExp(formatIdr(overviewRows(report).find(row => row[0] === 'Withdrawals IDR')?.[1] as number)));
  assert.match(document, new RegExp(formatIdr(overviewRows(report).find(row => row[0] === 'Net IDR')?.[1] as number)));
  assert.match(document, /Pending: Deals History/);
  assert.match(document, /Pending: Dealing FTD/);
  assert.match(document, /Pending: CRM Withdrawal/);
  assert.match(document, /REPORT PERIOD/);
  assert.match(document, /12:00/);
  assert.match(document, /18103|18,103/);
  assert.match(header, /Weekly Settlement Report/);
  assert.match(footer, /PAGE/);
  assert.match(document, /w:orient="portrait"|<w:pgSz[^>]*w:w="11906"/);
});
