/** .xlsx export of the Settlement report, one sheet per section in the manual files' layout. */
import * as XLSX from 'xlsx';
import { RATES, type Rate } from './conventions';
import { ATTESTED_EMPTY, PENDING_DEALS_HISTORY, type DealsDay } from './deals-report';
import { WITHDRAWAL_PCT_KPI } from './kpi-config';
import { withdrawalPctCards } from './kpis';
import { formatDuration } from './metrics';
import type { DailyReconciliation, ReconciliationBlock } from './reconcile';
import type { SettlementReport } from './report';
import { dealsHistorySummary } from './summary';

export const SETTLEMENT_SHEETS = ['Overview', 'Processing Time', 'Withdrawal %', 'Margin In-Out', 'Swap', 'Commission'] as const;
const RATE_LABEL = (rate: Rate) => (rate === 1 ? 'USD' : String(rate));
const PENDING_IM = 'Pending: Dealing FTD list';
type Cell = string | number | null;

const change = (current: number | null, previous: number | null): number | null => (current === null || previous === null ? null : current - previous);

export function overviewRows(report: SettlementReport): Cell[][] {
  const a = report.applications;
  const current = report.summary.current;
  const previous = report.summary.previous;
  const pct = withdrawalPctCards(current, WITHDRAWAL_PCT_KPI);
  const previousPct = withdrawalPctCards(previous, WITHDRAWAL_PCT_KPI);
  const commission = current.commission;
  const previousCommission = previous.commission;
  const commissionPending = !commission || commission.status !== 'complete';
  const previousPending = !previousCommission || previousCommission.status !== 'complete';
  return [
    ['Settlement Report', `${report.period.range.from} – ${report.period.range.to} (WIB)`],
    [],
    ['Deposit applications', a.deposit], ['Deposit rejected', a.depositRejected],
    ['Withdrawal applications', a.withdrawal], ['Withdrawal rejected', a.withdrawalRejected],
    [],
    ['KPI', 'Current', 'Previous', 'Change'],
    ['Deposits IDR', current.totals.deposit.idr, previous.totals.deposit.idr, change(current.totals.deposit.idr, previous.totals.deposit.idr)],
    ['Deposits USD', current.totals.deposit.usd, previous.totals.deposit.usd, change(current.totals.deposit.usd, previous.totals.deposit.usd)],
    ['Withdrawals IDR', current.totals.withdrawal.idr, previous.totals.withdrawal.idr, change(current.totals.withdrawal.idr, previous.totals.withdrawal.idr)],
    ['Withdrawals USD', current.totals.withdrawal.usd, previous.totals.withdrawal.usd, change(current.totals.withdrawal.usd, previous.totals.withdrawal.usd)],
    ['Net IDR', current.totals.netIdr, previous.totals.netIdr, change(current.totals.netIdr, previous.totals.netIdr)],
    ...pct.map((card, index) => [card.label, card.value, previousPct[index]?.value ?? null, change(card.value, previousPct[index]?.value ?? null)]),
    ['Avg deposit processing', current.processing.deposit, previous.processing.deposit, change(current.processing.deposit, previous.processing.deposit)],
    ['Avg withdrawal processing', current.processing.withdrawal, previous.processing.withdrawal, change(current.processing.withdrawal, previous.processing.withdrawal)],
    ['Commission IDR', commissionPending ? PENDING_DEALS_HISTORY : commission.commissionIdr, previousPending ? PENDING_DEALS_HISTORY : previousCommission.commissionIdr, commissionPending || previousPending ? null : change(commission.commissionIdr, previousCommission.commissionIdr)],
    ['Commission USD', commissionPending ? PENDING_DEALS_HISTORY : commission.commissionUsd, previousPending ? PENDING_DEALS_HISTORY : previousCommission.commissionUsd, commissionPending || previousPending ? null : change(commission.commissionUsd, previousCommission.commissionUsd)],
    [],
    ['Data through (per upload kind)'],
    ...Object.entries(report.coverage).map(([kind, to]) => [kind, to]),
  ];
}

function commissionCell(day: DealsDay, rate: Rate): Cell {
  if (day.status === 'observed' && day.commission) return day.commission[rate];
  if (day.status === 'attested') return ATTESTED_EMPTY;
  return PENDING_DEALS_HISTORY;
}

export function commissionRows(report: SettlementReport): Cell[][] {
  const days = report.dealsHistory ?? [];
  const summary = report.summary.current.commission ?? dealsHistorySummary(days);
  const pending = summary.status !== 'complete';
  const totals = RATES.map(rate => {
    if (pending) return PENDING_DEALS_HISTORY;
    return days.reduce((sum, day) => sum + (day.status === 'observed' && day.commission ? day.commission[rate] : 0), 0);
  });
  return [
    ['Date (MT5 server)', ...RATES.map(rate => (rate === 1 ? 'USD' : String(rate)))],
    ...days.map(day => [day.date, ...RATES.map(rate => commissionCell(day, rate))]),
    ['Total', ...totals],
    ['Commission IDR (Σ × rate)', pending ? PENDING_DEALS_HISTORY : summary.commissionIdr],
    ['Commission USD', pending ? PENDING_DEALS_HISTORY : summary.commissionUsd],
  ];
}

export function processingRows(report: SettlementReport): Cell[][] {
  const p = report.processing;
  const t = (cell: { avgSeconds: number | null; hits: number }) => [formatDuration(cell.avgSeconds), cell.hits];
  return [
    ['Deposit', 'Office API avg', 'hits', 'Office Manual avg', 'hits', 'After office API avg', 'hits', 'After office Manual avg', 'hits'],
    ...p.deposits.map(d => [d.date, ...t(d.officeApi), ...t(d.officeManual), ...t(d.afterApi), ...t(d.afterManual)]),
    [],
    ['Withdrawal', 'Office hour avg', 'hits', '2nd withdrawal avg', 'hits'],
    ...p.withdrawals.map(w => [w.date, ...t(w.office), ...t(w.secondWithdrawal)]),
    [],
    ['Summary (mean of daily office-hour averages)', 'Deposit API', formatDuration(p.summary.depositApi), 'Deposit Manual', formatDuration(p.summary.depositManual), 'Withdrawal', formatDuration(p.summary.withdrawal)],
  ];
}

export function withdrawalRows(report: SettlementReport): Cell[][] {
  const pct = (n: number, total: number) => (total ? Math.round((n / total) * 10000) / 100 : 0);
  return [
    ['Week (Mon–Fri label, Mon–Sun data)', 'Office hour', '%', 'After office hour', '%', '2nd withdrawal', '%', 'Total'],
    ...report.withdrawalWeeks.map(w => [w.label, w.office, pct(w.office, w.total), w.afterOffice, pct(w.afterOffice, w.total), w.secondWithdrawal, pct(w.secondWithdrawal, w.total), w.total]),
  ];
}

export function marginRows(report: SettlementReport): Cell[][] {
  const im = (value: number | null) => (value === null ? PENDING_IM : value);
  return [
    ['Month', 'SPA (IDR) Initial Margin', 'SPA (IDR) Deposit', 'SPA (IDR) Withdrawal', 'Multi IM', 'Multi Deposit', 'Multi Withdrawal', 'USD Initial Margin', 'USD Deposit', 'USD Withdrawal'],
    ...report.margin.map(m => [
      m.month, im(m.idrInitialMargin), m.idrDepositExIm ?? m.idrDeposit, m.idrWithdrawal, 0, 0, 0,
      im(m.usdInitialMargin), m.usdDepositExIm ?? m.usdDeposit, m.usdWithdrawal,
    ]),
    [],
    ['IDR = USD × account rate (default, pending Settlement confirmation). Deposit = all successful deposits − Initial Margin when the FTD list is loaded.'],
  ];
}

export function swapRows(report: SettlementReport): Cell[][] {
  const s = report.swap;
  const head = ['Date (MT5 server)', ...RATES.map(r => `CRM-S ${RATE_LABEL(r)}`), ...RATES.map(r => `CRM-SR ${RATE_LABEL(r)}`)];
  return [
    [report.swapLabel],
    head,
    ...s.days.map(d => [d.date, ...RATES.map(r => d.swap[r]), ...RATES.map(r => d.refund[r])]),
    ['Total', ...RATES.map(r => s.totalSwap[r]), ...RATES.map(r => s.totalRefund[r])],
    [],
    ['IDR (Σ × rate, IDR buckets)', 'CRM-S', s.idrSwap, 'CRM-SR', s.idrRefund, 'S + SR', Math.round((s.idrSwap + s.idrRefund) * 100) / 100],
    [],
    ['Deals History swap (separate from CRM-S and CRM-SR)'],
    ['Date (MT5 server)', ...RATES.map(rate => `DH swap ${RATE_LABEL(rate)}`)],
    ...(report.dealsHistory?.length
      ? report.dealsHistory.map(day => [day.date, ...RATES.map(rate => dealsHistoryCell(day, rate))])
      : [['(no dates)', ...RATES.map(() => PENDING_DEALS_HISTORY)]]),
  ];
}

export function buildSettlementWorkbook(report: SettlementReport): Buffer {
  const book = XLSX.utils.book_new();
  const sheets: Record<typeof SETTLEMENT_SHEETS[number], Cell[][]> = {
    Overview: overviewRows(report), 'Processing Time': processingRows(report), 'Withdrawal %': withdrawalRows(report), 'Margin In-Out': marginRows(report), Swap: swapRows(report), Commission: commissionRows(report),
  };
  for (const name of SETTLEMENT_SHEETS) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheets[name]), name);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function dealsHistoryCell(day: DealsDay, rate: Rate): Cell {
  if (day.status === 'observed' && day.swap) return day.swap[rate];
  if (day.status === 'attested') return ATTESTED_EMPTY;
  return PENDING_DEALS_HISTORY;
}

function blockRows(title: string, block: ReconciliationBlock): Cell[][] {
  return [
    [title, 'Deposit', 'Withdrawal', 'Total'],
    ['Clients', block.clients.deposit, block.clients.withdrawal, block.clients.reject],
    ...block.byRate.map(line => [RATE_LABEL(line.rate), line.deposit, line.withdrawal, line.total]),
    ...block.differences.map(d => [d.label, d.side === 'deposit' ? d.amount : null, d.side === 'withdrawal' ? d.amount : null, d.count]),
    ['Total', block.total.deposit, block.total.withdrawal, block.total.net],
  ];
}

export function buildReconciliationWorkbook(daily: DailyReconciliation): Buffer {
  const book = XLSX.utils.book_new();
  const rows: Cell[][] = [[`Daily Report Deposit and Withdrawal ${daily.window.label}`], [], ...blockRows('CRM', daily.crm), [], ...blockRows('MT5', daily.mt5)];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Daily Report');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export const settlementExportFileName = (report: SettlementReport) => `settlement-report_${report.period.range.from}_${report.period.range.to}.xlsx`;
export const reconciliationExportFileName = (date: string) => `settlement-daily_${date}.xlsx`;
