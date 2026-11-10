/**
 * Self-contained Settlement Report HTML. Figures come from the same row builders as the workbook.
 * There is no Onboarding HTML generator in this repo; the layout follows that report's card style.
 */
import { PENDING_DEALS_HISTORY } from './deals-report';
import { SETTLEMENT_KIND_LABELS } from './detect';
import { commissionRows, jisdorSheetRows, marginRows, overviewRows, processingRows, swapRows, withdrawalRows } from './export';
import { formatDurationShort, formatIdr, formatUsd } from './format';
import { buildKpis } from './kpis';
import { JISDOR_MONTH_UNAVAILABLE } from './jisdor';
import { formatDuration } from './metrics';
import type { DailyReconciliation } from './reconcile';
import type { SettlementReport } from './report';

type Cell = string | number | null;

const PRESET_TITLE: Record<string, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', custom: 'Custom' };
const MISMATCH_LABELS = [
  ['crm_only', 'CRM only'],
  ['mt5_only', 'MT5 only'],
  ['amount_diff', 'Amount differs'],
  ['account_diff', 'Account differs'],
] as const;
const COVERAGE = [
  ['settlement_crm_deposit', 'CRM Deposit'],
  ['settlement_crm_withdrawal', 'CRM Withdrawal'],
  ['settlement_mt5_dw', 'MT5 D&W'],
  ['settlement_ftd', 'Dealing FTD'],
] as const;

const esc = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function showNumber(value: number): string {
  if (Number.isInteger(value)) return formatIdr(value);
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cellText(value: Cell): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return showNumber(value);
  return value;
}

function td(value: Cell, numeric = false): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return `<td${numeric ? ' class="num"' : ''} data-xlsx="${esc(raw)}">${esc(cellText(value))}</td>`;
}

function table(rows: Cell[][], options: { numericFrom?: number; totalLabel?: string } = {}): string {
  if (!rows.length) return '';
  const [head, ...body] = rows;
  const numericFrom = options.numericFrom ?? 1;
  const totalLabel = options.totalLabel ?? 'Total';
  const header = `<tr>${head.map((cell, index) => `<th${index >= numericFrom ? ' class="num"' : ''}>${esc(cellText(cell))}</th>`).join('')}</tr>`;
  const lines = body.filter(row => row.some(cell => cell !== null && cell !== '')).map(row => {
    const total = String(row[0] ?? '') === totalLabel || String(row[0] ?? '').startsWith('Total');
    return `<tr${total ? ' class="total"' : ''}>${row.map((cell, index) => td(cell, index >= numericFrom)).join('')}</tr>`;
  });
  return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${lines.join('')}</tbody></table></div>`;
}

function periodPill(report: SettlementReport): string {
  const period = report.period;
  if (period.window) return period.window.label;
  return `${period.range.from} – ${period.range.to} · 12:00–12:00 WIB`;
}

function coverageLine(report: SettlementReport): string {
  const parts = COVERAGE.map(([key, label]) => {
    const through = report.coverage[key];
    return through ? `${label} through ${through}` : `Pending: ${label}`;
  });
  const commission = report.summary.current.commission;
  parts.push(!commission || commission.status !== 'complete' ? PENDING_DEALS_HISTORY : `Deals History through ${commission.lastCoveredDate ?? report.period.range.to}`);
  return parts.join(' · ');
}

function kpiGrid(report: SettlementReport): string {
  const cards = buildKpis(report.summary);
  const swapPending = !report.coverage.settlement_mt5_dw && report.swap.days.length === 0;
  const swapValue = swapPending ? 'Pending: MT5 D&W' : formatIdr(report.swap.idrSwap);
  const swapDetail = swapPending ? 'CRM-S is not counted as 0' : `CRM-SR ${formatIdr(report.swap.idrRefund)}`;
  const items = [
    ...cards.map(card => {
      const value = card.pending ? PENDING_DEALS_HISTORY : card.kind === 'idr' ? formatIdr(card.value) : card.kind === 'duration' ? formatDurationShort(card.value) : card.value === null ? '—' : `${card.value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
      const raw = card.pending ? PENDING_DEALS_HISTORY : card.value === null ? '' : String(card.value);
      return { label: card.label, value, detail: card.note, raw };
    }),
    { label: 'Swap (CRM-S)', value: swapValue, detail: swapDetail, raw: swapPending ? 'Pending: MT5 D&W' : String(report.swap.idrSwap) },
  ];
  return `<div class="metrics">${items.map((item, index) => `<article class="metric tone-${index % 3}" data-xlsx="${esc(item.raw)}"><p class="value">${esc(item.value)}</p><p class="label">${esc(item.label)}</p><p class="detail">${esc(item.detail)}</p></article>`).join('')}</div>`;
}

function dailyTable(report: SettlementReport): string {
  if (report.period.preset === 'day') return '';
  const totals = report.summary.current.totals;
  const rows: Cell[][] = [
    ['Date', 'Deposits IDR', 'Withdrawals IDR', 'Net IDR', 'Deposit requests', 'Withdrawal requests', 'Office-hour %'],
    ...report.daily.map(day => [day.date, day.depositIdr, day.withdrawalIdr, day.netIdr, day.depositCount, day.withdrawalCount, day.officeHourPct]),
    ['Total', totals.deposit.idr, totals.withdrawal.idr, totals.netIdr, totals.deposit.count, totals.withdrawal.count, totals.withdrawalPct.officeHourPct],
  ];
  return `<section class="block"><h2>Daily breakdown</h2>${table(rows)}</section>`;
}

function reconciliationBlock(recon: DailyReconciliation | null): string {
  if (!recon) {
    return `<section class="block"><h2><span>01</span> CRM vs MT5</h2><p class="note">Pending: reconciliation</p></section>`;
  }
  const counts = { crm_only: 0, mt5_only: 0, amount_diff: 0, account_diff: 0 };
  for (const item of recon.mismatches) counts[item.reason] += 1;
  const total = counts.crm_only + counts.mt5_only + counts.amount_diff + counts.account_diff;
  const rows: Cell[][] = [
    ['Category', 'Count'],
    ...MISMATCH_LABELS.map(([key, label]) => [label, counts[key]]),
    ['Total', total],
  ];
  return `<section class="block"><h2><span>01</span> CRM vs MT5</h2><p class="note">${esc(recon.window.label)}</p>${table(rows, { numericFrom: 1 })}</section>`;
}

function notes(report: SettlementReport, recon: DailyReconciliation | null): string {
  const totals = report.summary.current.totals;
  const commission = overviewRows(report).find(row => row[0] === 'Commission IDR')?.[1];
  const lines = [
    `Successful deposits are ${formatIdr(totals.deposit.idr)} IDR (${formatUsd(totals.deposit.usd)} USD, ${totals.deposit.count} requests).`,
    `Successful withdrawals are ${formatIdr(totals.withdrawal.idr)} IDR (${totals.withdrawal.count} requests). Net margin in–out is ${formatIdr(totals.netIdr)} IDR.`,
  ];
  if (totals.withdrawalPct.officeHourPct === null) lines.push('Office-hour withdrawal % is Pending: withdrawals.');
  else lines.push(`Office-hour withdrawals are ${totals.withdrawalPct.office} of ${totals.withdrawalPct.total} requests (${totals.withdrawalPct.officeHourPct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%).`);
  lines.push(typeof commission === 'string' ? `Commission is ${commission}.` : `Commission is ${formatIdr(typeof commission === 'number' ? commission : null)} IDR.`);
  if (!recon) lines.push('Reconciliation is Pending: reconciliation.');
  else {
    const count = recon.mismatches.length;
    lines.push(count === 0 ? `Reconciliation on ${recon.date} has no mismatches.` : `Reconciliation on ${recon.date} has ${count} mismatch${count === 1 ? '' : 'es'}.`);
  }
  const jisdor = jisdorSheetRows(report);
  if (jisdor.length <= 2 && jisdor.some(row => row.includes(JISDOR_MONTH_UNAVAILABLE))) lines.push(JISDOR_MONTH_UNAVAILABLE);
  else {
    const latest = jisdor[2];
    if (latest) lines.push(`Latest JISDOR fixing in ${report.period.anchor.slice(0, 7)} is ${latest[0]} at ${formatUsd(typeof latest[1] === 'number' ? latest[1] : null)} IDR per USD.`);
  }
  const depositAvg = report.summary.current.processing.deposit;
  lines.push(`Average office-hour deposit processing is ${depositAvg === null ? '—' : formatDuration(depositAvg)}.`);
  return `<section class="block"><h2>Notes</h2><ul class="notes">${lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul></section>`;
}

export function settlementHtmlFileName(report: SettlementReport): string {
  const preset = PRESET_TITLE[report.period.preset]?.toLowerCase() ?? report.period.preset;
  return `settlement-report-${preset}-${report.period.range.from}_${report.period.range.to}.html`;
}

function commissionTable(report: SettlementReport): string {
  const attached = report.dealsHistory !== undefined && report.summary.current.commission !== undefined;
  if (!attached || report.summary.current.commission?.status !== 'complete') {
    const rows = attached ? commissionRows(report) : [
      ['Date (MT5 server)', 'USD', '10000', '12000', '14000'],
      ['Total', PENDING_DEALS_HISTORY, PENDING_DEALS_HISTORY, PENDING_DEALS_HISTORY, PENDING_DEALS_HISTORY],
      ['Commission IDR (Σ × rate)', PENDING_DEALS_HISTORY],
      ['Commission USD', PENDING_DEALS_HISTORY],
    ];
    return table(rows.map(row => (row[0] === 'Total' || String(row[0]).startsWith('Commission')
      ? [row[0], ...row.slice(1).map(cell => (typeof cell === 'number' ? PENDING_DEALS_HISTORY : cell))]
      : row)));
  }
  return table(commissionRows(report));
}

export function buildSettlementHtml(report: SettlementReport, options: { reconciliation?: DailyReconciliation | null } = {}): string {
  const title = `${PRESET_TITLE[report.period.preset] ?? 'Settlement'} Settlement Report`;
  const processing = processingRows(report);
  const splitAt = processing.findIndex((row, index) => index > 0 && row[0] === 'Withdrawal');
  const depositRows = splitAt > 0 ? processing.slice(0, splitAt).filter(row => row.length > 1 || row[0]) : processing;
  const withdrawalPart = splitAt > 0 ? processing.slice(splitAt) : [];
  const summary = processing.filter(row => String(row[0] ?? '').startsWith('Summary'));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e8edf2; color: #1c2430; font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 28px 20px 48px; }
  .card { background: #fff; border-radius: 16px; padding: 22px 22px 8px; box-shadow: 0 1px 2px rgba(20, 32, 51, .06); }
  h1 { margin: 0; font-size: 28px; letter-spacing: -.03em; }
  .pill { display: inline-block; margin-top: 12px; padding: 4px 10px; border-radius: 999px; background: #e7eef8; color: #1e3a5f; font-size: 12px; font-weight: 650; letter-spacing: .04em; }
  .coverage { margin: 10px 0 0; color: #5c6b7a; font-size: 13px; }
  .block { margin-top: 22px; padding-top: 16px; border-top: 1px solid #e4e9ef; }
  h2 { margin: 0 0 12px; font-size: 16px; }
  h3 { margin: 14px 0 8px; font-size: 13px; color: #334155; }
  h2 span { display: inline-block; min-width: 1.6em; margin-right: 6px; color: #1d4ed8; }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 18px; }
  .metric { background: #fff; border: 1px solid #e6ebf1; border-radius: 12px; border-top-width: 4px; padding: 14px 14px 12px; }
  .tone-0 { border-top-color: #2563eb; }
  .tone-1 { border-top-color: #16a34a; }
  .tone-2 { border-top-color: #7c3aed; }
  .value { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
  .label { margin: 4px 0 0; font-size: 13px; font-weight: 650; }
  .detail, .note, .notes { color: #5c6b7a; font-size: 13px; }
  .detail { margin: 4px 0 0; }
  .table-wrap { overflow-x: auto; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { background: #1d4ed8; color: #fff; text-align: left; font-weight: 650; font-size: 12px; padding: 8px 10px; }
  th.num, td.num { text-align: right; }
  td { padding: 8px 10px; border-bottom: 1px solid #e7edf3; font-size: 13px; }
  tbody tr:nth-child(even) td { background: #f4f7fb; }
  tr.total td { font-weight: 750; background: #e8eef8; }
  .notes { margin: 0 0 12px; padding-left: 18px; }
  @media (max-width: 760px) { .metrics { grid-template-columns: 1fr 1fr; } h1 { font-size: 24px; } }
  @media (max-width: 420px) { .metrics { grid-template-columns: 1fr; } main { padding: 16px 12px 32px; } .value { font-size: 22px; } }
  @media print { body { background: #fff; } main { max-width: none; padding: 0; } .card, .metric { box-shadow: none; } .block { break-inside: avoid; } }
</style>
</head>
<body>
<main>
  <article class="card">
    <h1>${esc(title)}</h1>
    <p class="pill">REPORT PERIOD · ${esc(periodPill(report))}</p>
    <p class="coverage">${esc(coverageLine(report))}</p>
    ${kpiGrid(report)}
    ${dailyTable(report)}
    ${reconciliationBlock(options.reconciliation ?? null)}
    <section class="block"><h2><span>02</span> Processing time</h2>${table(depositRows)}${withdrawalPart.length ? table(withdrawalPart) : ''}${summary.length ? `<p class="note">${summary.map(row => row.map(cell => cellText(cell)).join(' · ')).map(esc).join('<br>')}</p>` : ''}</section>
    <section class="block"><h2>Withdrawal %</h2>${table(withdrawalRows(report))}</section>
    <section class="block"><h2>Margin in–out</h2>${table(marginRows(report).filter(row => row.length > 1))}</section>
    <section class="block"><h2><span>03</span> Commission and swap</h2><p class="note">${esc(report.swapLabel)}</p><h3>Commission</h3>${commissionTable(report)}<h3>Swap</h3>${table(swapRows(report).filter(row => row.length > 1))}</section>
    <section class="block"><h2>JISDOR</h2>${table(jisdorSheetRows(report), { numericFrom: 1 })}</section>
    ${notes(report, options.reconciliation ?? null)}
  </article>
</main>
</body>
</html>`;
}
