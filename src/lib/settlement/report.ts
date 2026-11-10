/**
 * Settlement report assembly. Period parsing (weeks are Monday–Sunday WIB, unlike the Onboarding month-weeks),
 * a pure builder over loaded rows, and the DB loader used by the API routes.
 */
import type { DateRange } from '@/lib/monthly-report/periods';
import { addDays, weekdayOf } from '@/lib/monthly-report/periods';
import { RATES, reconciliationWindow, wibDateOf, type Rate } from './conventions';
import type { FtdEntry } from './ftd-parse';
import { applications, marginInOut, processingTime, swapReport, withdrawalPercentage, type Applications, type MarginMonth, type ProcessingTime, type SwapReport, type WithdrawalWeek } from './metrics';
import { buildDailyReconciliation, type DailyReconciliation, type MismatchItem } from './reconcile';
import { loadCrm, loadFtd, loadHolidays, loadMt5Deals, loadSettlementCoverage } from './store';
import type { DealsDay } from './deals-report';
import type { CrmTransaction, Mt5Deal } from './types';

export const SETTLEMENT_PRESETS = ['day', 'week', 'month', 'custom'] as const;
export type SettlementPreset = typeof SETTLEMENT_PRESETS[number];
export interface SettlementPeriod { preset: SettlementPreset; anchor: string; range: DateRange }
export const MAX_SETTLEMENT_DAYS = 93;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const lastDayOfMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** day = that day; week = Monday–Sunday containing anchor; month = calendar month; custom ≤ 93 days. */
export function resolveSettlementPeriod(preset: string, anchor: string, from?: string | null, to?: string | null): SettlementPeriod {
  if (!(SETTLEMENT_PRESETS as readonly string[]).includes(preset)) throw new Error('preset is not supported');
  if (preset === 'custom') {
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to) throw new Error('from/to must be YYYY-MM-DD with from ≤ to');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > MAX_SETTLEMENT_DAYS) throw new Error(`Custom ranges are limited to ${MAX_SETTLEMENT_DAYS} days`);
    return { preset, anchor: from, range: { from, to } };
  }
  if (!DATE_RE.test(anchor)) throw new Error('anchor must be YYYY-MM-DD');
  if (preset === 'day') return { preset, anchor, range: { from: anchor, to: anchor } };
  if (preset === 'week') {
    const monday = addDays(anchor, 1 - weekdayOf(anchor));
    return { preset, anchor, range: { from: monday, to: addDays(monday, 6) } };
  }
  const month = anchor.slice(0, 7);
  return { preset: 'month', anchor, range: { from: `${month}-01`, to: lastDayOfMonth(month) } };
}

/** WIB day bounds as ISO instants: [from 00:00 WIB, to+1 00:00 WIB). */
export function wibBounds(range: DateRange, padDays = 0): { fromIso: string; toIso: string } {
  const start = Date.parse(`${addDays(range.from, -padDays)}T00:00:00.000Z`) - 7 * 3_600_000;
  const end = Date.parse(`${addDays(range.to, 1 + padDays)}T00:00:00.000Z`) - 7 * 3_600_000;
  return { fromIso: new Date(start).toISOString(), toIso: new Date(end).toISOString() };
}

export interface SettlementReport {
  period: SettlementPeriod;
  applications: Applications;
  processing: ProcessingTime;
  withdrawalWeeks: WithdrawalWeek[];
  margin: MarginMonth[];
  swap: SwapReport;
  swapLabel: string;
  coverage: Record<string, string | null>;
  /** Absent until the report route attaches Deals History. Missing dates are Pending, not zero. */
  dealsHistory?: DealsDay[];
}

export const SWAP_LABEL = 'Swap from Deposit & Withdrawal (CRM-S / CRM-SR), excludes Deals History swap';

export function buildSettlementReport(input: {
  period: SettlementPeriod; deposits: CrmTransaction[]; withdrawals: CrmTransaction[]; swapDeals: Mt5Deal[];
  yearDeposits: CrmTransaction[]; yearWithdrawals: CrmTransaction[]; ftd: FtdEntry[]; holidays: ReadonlySet<string>; coverage: Record<string, string | null>;
}): SettlementReport {
  const { period, holidays } = input;
  const weeks = weeksTouching(period.range);
  const inWeeks = (tx: CrmTransaction) => { const d = wibDateOf(tx.requestedAt); return d >= weeks.from && d <= weeks.to; };
  return {
    period,
    applications: applications(input.deposits, input.withdrawals, period.range),
    processing: processingTime(input.deposits, input.withdrawals, period.range, holidays),
    withdrawalWeeks: withdrawalPercentage(input.withdrawals.filter(inWeeks), holidays),
    margin: marginInOut(input.yearDeposits, input.yearWithdrawals, input.ftd),
    swap: swapReport(input.swapDeals, period.range),
    swapLabel: SWAP_LABEL,
    coverage: input.coverage,
  };
}

/** Whole Monday–Sunday weeks touching the range (Withdrawal % always shows full weeks). */
export function weeksTouching(range: DateRange): DateRange {
  return { from: addDays(range.from, 1 - weekdayOf(range.from)), to: addDays(range.to, 7 - weekdayOf(range.to)) };
}

export async function loadSettlementReport(period: SettlementPeriod): Promise<SettlementReport> {
  const crm = wibBounds(weeksTouching(period.range), 1);
  const year = period.range.to.slice(0, 4);
  const yearBounds = wibBounds({ from: `${year}-01-01`, to: `${year}-12-31` });
  // MT5 posting (server) dates are WIB − 4/5h: pad one day, swapReport filters by server date.
  const swap = wibBounds(period.range, 1);
  const [deposits, withdrawals, swapDeals, yearDeposits, yearWithdrawals, ftd, holidays, coverage] = await Promise.all([
    loadCrm('deposit', crm.fromIso, crm.toIso),
    loadCrm('withdrawal', crm.fromIso, crm.toIso),
    loadMt5Deals(swap.fromIso, swap.toIso, ['S', 'SR']),
    loadCrm('deposit', yearBounds.fromIso, yearBounds.toIso, { successfulOnly: true }),
    loadCrm('withdrawal', yearBounds.fromIso, yearBounds.toIso, { successfulOnly: true }),
    loadFtd(`${year}-01-01`, `${year}-12-31`),
    loadHolidays(),
    loadSettlementCoverage(),
  ]);
  return buildSettlementReport({ period, deposits, withdrawals, swapDeals, yearDeposits, yearWithdrawals, ftd, holidays, coverage });
}

export const MISMATCH_REASONS = ['crm_only', 'mt5_only', 'amount_diff', 'account_diff'] as const;
export const MISMATCH_PAGE_SIZE = 50;

export interface ReconciliationResponse {
  reconciliation: Omit<DailyReconciliation, 'mismatches'>;
  mismatchCounts: Record<MismatchItem['reason'], number>;
  list: { reason: MismatchItem['reason']; page: number; pageCount: number; items: Array<MismatchItem & { state: 'pending' | 'missing' }> } | null;
}

/** Unmatched for more than 24h after the row's time → "missing"; younger → "pending". */
export const mismatchState = (at: string | null, nowMs: number): 'pending' | 'missing' => (at && nowMs - Date.parse(at) <= 86_400_000 ? 'pending' : 'missing');

export function shapeReconciliation(daily: DailyReconciliation, list: string | null, page: number, mask: (value: string) => string | null, nowMs = Date.now()): ReconciliationResponse {
  const counts = { crm_only: 0, mt5_only: 0, amount_diff: 0, account_diff: 0 };
  for (const item of daily.mismatches) counts[item.reason] += 1;
  const { mismatches, ...rest } = daily;
  let shaped: ReconciliationResponse['list'] = null;
  if (list && (MISMATCH_REASONS as readonly string[]).includes(list)) {
    const items = mismatches.filter(item => item.reason === list);
    const pageCount = Math.max(1, Math.ceil(items.length / MISMATCH_PAGE_SIZE));
    const current = Math.min(Math.max(1, page), pageCount);
    shaped = {
      reason: list as MismatchItem['reason'], page: current, pageCount,
      items: items.slice((current - 1) * MISMATCH_PAGE_SIZE, current * MISMATCH_PAGE_SIZE).map(item => ({ ...item, accountNo: mask(item.accountNo) ?? '', state: mismatchState(item.at, nowMs) })),
    };
  }
  return { reconciliation: rest, mismatchCounts: counts, list: shaped };
}

export async function loadReconciliation(date: string): Promise<DailyReconciliation> {
  const window = reconciliationWindow(date);
  // ±1 day so a CRM row or deal on the other side of the cut-off still matches (SPEC §6).
  const pad = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();
  const [deposits, withdrawals, deals] = await Promise.all([
    loadCrm('deposit', pad(window.start, -1), pad(window.end, 1)),
    // loadCrm matches request OR completion in the bounds, so WD-2 rows (requested in the window, completed later) are included.
    loadCrm('withdrawal', pad(window.start, -1), pad(window.end, 1)),
    loadMt5Deals(pad(window.start, -1), pad(window.end, 1), ['D', 'W', 'WC']),
  ]);
  return buildDailyReconciliation(date, deposits, withdrawals, deals);
}

export const RATE_COLUMNS: readonly Rate[] = RATES;
