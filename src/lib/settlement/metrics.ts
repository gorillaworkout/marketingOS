/**
 * Period metrics for the Settlement report (pure; inputs are already-loaded rows).
 * Days are WIB. Office hour = Mon–Fri 09:00–18:00 WIB minus holidays.
 */
import { RATES, isOfficeHour, wibDateOf, type Rate } from './conventions';
import type { FtdEntry } from './ftd-parse';
import type { CrmTransaction, Mt5Deal } from './types';

export interface DateRange { from: string; to: string }
const inRange = (day: string, range: DateRange) => day >= range.from && day <= range.to;
const round2 = (value: number) => Math.round(value * 100) / 100;
const seconds = (tx: CrmTransaction) => (tx.completedAt ? (Date.parse(tx.completedAt) - Date.parse(tx.requestedAt)) / 1000 : null);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export interface Applications { deposit: number; depositRejected: number; withdrawal: number; withdrawalRejected: number }

/** Requests by WIB request date; rejected = Unsuccessful. */
export function applications(deposits: CrmTransaction[], withdrawals: CrmTransaction[], range: DateRange, dayKey: (iso: string) => string = wibDateOf): Applications {
  const dep = deposits.filter(tx => inRange(dayKey(tx.requestedAt), range));
  const wd = withdrawals.filter(tx => inRange(dayKey(tx.requestedAt), range));
  return {
    deposit: dep.length, depositRejected: dep.filter(tx => tx.status === 'Unsuccessful').length,
    withdrawal: wd.length, withdrawalRejected: wd.filter(tx => tx.status === 'Unsuccessful').length,
  };
}

export interface TimeCell { avgSeconds: number | null; hits: number }
export interface DepositProcessingDay { date: string; officeApi: TimeCell; officeManual: TimeCell; afterApi: TimeCell; afterManual: TimeCell }
export interface WithdrawalProcessingDay { date: string; office: TimeCell; secondWithdrawal: TimeCell }
export interface ProcessingTime {
  deposits: DepositProcessingDay[];
  withdrawals: WithdrawalProcessingDay[];
  /** Means of the daily office-hour averages (days that have data), as in the weekly docx. */
  summary: { depositApi: number | null; depositManual: number | null; deposit: number | null; withdrawal: number | null };
}

function cell(values: number[]): TimeCell { return { avgSeconds: mean(values), hits: values.length }; }

/**
 * Deposits: rows with a completion (Processing excluded), by WIB request date, split office/after × API(Auto)/Manual.
 * Withdrawals office: Successful, requested in office hour, completed the same WIB day. 2nd withdrawal: completed a later WIB day.
 */
export function processingTime(deposits: CrmTransaction[], withdrawals: CrmTransaction[], range: DateRange, holidays: ReadonlySet<string> = new Set(), dayKey: (iso: string) => string = wibDateOf): ProcessingTime {
  const depDays = new Map<string, Record<'officeApi' | 'officeManual' | 'afterApi' | 'afterManual', number[]>>();
  for (const tx of deposits) {
    const day = dayKey(tx.requestedAt);
    const s = seconds(tx);
    if (!inRange(day, range) || s === null || tx.status === 'Processing') continue;
    const bucket = depDays.get(day) ?? { officeApi: [], officeManual: [], afterApi: [], afterManual: [] };
    const office = isOfficeHour(tx.requestedAt, holidays);
    const api = tx.fundingMethod === 'Auto';
    bucket[office ? (api ? 'officeApi' : 'officeManual') : (api ? 'afterApi' : 'afterManual')].push(s);
    depDays.set(day, bucket);
  }
  const wdDays = new Map<string, { office: number[]; second: number[] }>();
  for (const tx of withdrawals) {
    const day = dayKey(tx.requestedAt);
    const s = seconds(tx);
    if (!inRange(day, range) || s === null || tx.status !== 'Successful' || !tx.completedAt) continue;
    const bucket = wdDays.get(day) ?? { office: [], second: [] };
    if (wibDateOf(tx.completedAt) > wibDateOf(tx.requestedAt)) bucket.second.push(s);
    else if (isOfficeHour(tx.requestedAt, holidays)) bucket.office.push(s);
    wdDays.set(day, bucket);
  }
  const depositsOut = [...depDays.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({
    date, officeApi: cell(b.officeApi), officeManual: cell(b.officeManual), afterApi: cell(b.afterApi), afterManual: cell(b.afterManual),
  }));
  const withdrawalsOut = [...wdDays.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({ date, office: cell(b.office), secondWithdrawal: cell(b.second) }));
  const daily = (pick: (d: DepositProcessingDay) => TimeCell) => depositsOut.map(pick).filter(c => c.hits > 0).map(c => c.avgSeconds as number);
  const api = daily(d => d.officeApi);
  const manual = daily(d => d.officeManual);
  return {
    deposits: depositsOut,
    withdrawals: withdrawalsOut,
    summary: {
      depositApi: mean(api), depositManual: mean(manual),
      deposit: mean([...api, ...manual]),
      withdrawal: mean(withdrawalsOut.filter(d => d.office.hits > 0).map(d => d.office.avgSeconds as number)),
    },
  };
}

export interface WithdrawalWeek { weekStart: string; label: string; office: number; afterOffice: number; secondWithdrawal: number; total: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function addDaysIso(date: string, days: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10); }
const shortDay = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(8, 10)}`;

/** Weeks Mon–Sun by WIB request date; 2nd withdrawal = completed on a later WIB day; label = Mon – Fri. */
export function withdrawalPercentage(withdrawals: CrmTransaction[], holidays: ReadonlySet<string> = new Set(), dayKey: (iso: string) => string = wibDateOf): WithdrawalWeek[] {
  const weeks = new Map<string, WithdrawalWeek>();
  for (const tx of withdrawals) {
    const date = dayKey(tx.requestedAt);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekStart = addDaysIso(date, -((weekday + 6) % 7));
    const week = weeks.get(weekStart) ?? { weekStart, label: `${shortDay(weekStart)} – ${shortDay(addDaysIso(weekStart, 4))}`, office: 0, afterOffice: 0, secondWithdrawal: 0, total: 0 };
    week.total += 1;
    if (tx.completedAt && wibDateOf(tx.completedAt) > wibDateOf(tx.requestedAt)) week.secondWithdrawal += 1;
    else if (!isOfficeHour(tx.requestedAt, holidays)) week.afterOffice += 1;
    else week.office += 1;
    weeks.set(weekStart, week);
  }
  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** IDR basis for Margin In–Out. Default pending Settlement confirmation (SPEC §13 item 5). */
export const MARGIN_IDR_BASIS = 'usd_x_rate' as const;

export interface MarginMonth {
  month: string;
  /** All successful deposits (Initial Margin + Deposit). */
  idrDeposit: number; idrWithdrawal: number; usdDeposit: number; usdWithdrawal: number;
  /** From the Dealing FTD list (Balance × rate), by MT5 server month of FTD Time. null = no FTD upload for the month. */
  idrInitialMargin: number | null; usdInitialMargin: number | null;
  /** Deposit column = all deposits − Initial Margin (null without FTD data). */
  idrDepositExIm: number | null; usdDepositExIm: number | null;
}

/** Successful only. Deposits by WIB completion month, withdrawals by WIB request month. IDR = USD × rate (rate ≠ 1); USD = rate 1. */
export function marginInOut(deposits: CrmTransaction[], withdrawals: CrmTransaction[], ftd: FtdEntry[] = []): MarginMonth[] {
  const months = new Map<string, MarginMonth>();
  const get = (month: string) => {
    const row = months.get(month) ?? { month, idrDeposit: 0, idrWithdrawal: 0, usdDeposit: 0, usdWithdrawal: 0, idrInitialMargin: null, usdInitialMargin: null, idrDepositExIm: null, usdDepositExIm: null };
    months.set(month, row);
    return row;
  };
  for (const tx of deposits) {
    if (tx.status !== 'Successful' || !tx.completedAt || tx.amountUsd === null || tx.rate === null) continue;
    const row = get(wibDateOf(tx.completedAt).slice(0, 7));
    if (tx.rate === 1) row.usdDeposit += tx.amountUsd; else row.idrDeposit += tx.amountUsd * tx.rate;
  }
  for (const tx of withdrawals) {
    if (tx.status !== 'Successful' || tx.amountUsd === null || tx.rate === null) continue;
    const row = get(wibDateOf(tx.requestedAt).slice(0, 7));
    if (tx.rate === 1) row.usdWithdrawal += tx.amountUsd; else row.idrWithdrawal += tx.amountUsd * tx.rate;
  }
  for (const entry of ftd) {
    if (entry.rate === null) continue;
    const row = get(entry.serverTime.slice(0, 7));
    if (entry.rate === 1) row.usdInitialMargin = (row.usdInitialMargin ?? 0) + entry.balanceUsd;
    else row.idrInitialMargin = (row.idrInitialMargin ?? 0) + entry.balanceUsd * entry.rate;
  }
  const r2 = (v: number | null) => (v === null ? null : round2(v));
  return [...months.values()].map(r => {
    const hasFtd = r.idrInitialMargin !== null || r.usdInitialMargin !== null;
    const idrIm = hasFtd ? r2(r.idrInitialMargin ?? 0) : null;
    const usdIm = hasFtd ? r2(r.usdInitialMargin ?? 0) : null;
    return {
      ...r, idrDeposit: round2(r.idrDeposit), idrWithdrawal: round2(r.idrWithdrawal), usdDeposit: round2(r.usdDeposit), usdWithdrawal: round2(r.usdWithdrawal),
      idrInitialMargin: idrIm, usdInitialMargin: usdIm,
      idrDepositExIm: idrIm === null ? null : round2(r.idrDeposit - idrIm),
      usdDepositExIm: usdIm === null ? null : round2(r.usdDeposit - usdIm),
    };
  }).sort((a, b) => a.month.localeCompare(b.month));
}

export interface SwapDay { date: string; swap: Record<Rate, number>; refund: Record<Rate, number> }
export interface SwapReport { days: SwapDay[]; totalSwap: Record<Rate, number>; totalRefund: Record<Rate, number>; idrSwap: number; idrRefund: number }

const zeroByRate = (): Record<Rate, number> => ({ 1: 0, 10000: 0, 12000: 0, 14000: 0 });

/** CRM-S and CRM-SR by MT5 server posting date × rate. Excludes Deals History swap (phase 2). */
export function swapReport(deals: Mt5Deal[], range: DateRange, dayKey?: (iso: string) => string): SwapReport {
  const days = new Map<string, SwapDay>();
  const totalSwap = zeroByRate(); const totalRefund = zeroByRate();
  for (const d of deals) {
    if ((d.kind !== 'S' && d.kind !== 'SR') || d.rate === null) continue;
    const date = dayKey ? dayKey(d.occurredAt) : d.serverTime.slice(0, 10);
    if (!inRange(date, range)) continue;
    const day = days.get(date) ?? { date, swap: zeroByRate(), refund: zeroByRate() };
    if (d.kind === 'S') { day.swap[d.rate] += d.amountUsd; totalSwap[d.rate] += d.amountUsd; }
    else { day.refund[d.rate] += d.amountUsd; totalRefund[d.rate] += d.amountUsd; }
    days.set(date, day);
  }
  const roundAll = (r: Record<Rate, number>) => { for (const rate of RATES) r[rate] = round2(r[rate]); return r; };
  const idr = (r: Record<Rate, number>) => round2(RATES.filter(rate => rate !== 1).reduce((acc, rate) => acc + r[rate] * rate, 0));
  return {
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ date: d.date, swap: roundAll(d.swap), refund: roundAll(d.refund) })),
    totalSwap: roundAll(totalSwap), totalRefund: roundAll(totalRefund), idrSwap: idr(totalSwap), idrRefund: idr(totalRefund),
  };
}

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return '—';
  const s = Math.round(totalSeconds);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
