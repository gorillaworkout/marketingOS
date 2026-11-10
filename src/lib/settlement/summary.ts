/**
 * Period comparisons for the Settlement Report. Money follows marginInOut:
 * successful deposits by completion day, successful withdrawals by request day.
 */
import { addDays, daysBetween, type DateRange } from '@/lib/monthly-report/periods';
import { RATES, wibDateOf, type Rate } from './conventions';
import { eachDate } from './deals-parse';
import type { DealsDay } from './deals-report';
import type { CrmTransaction } from './types';

export interface MoneyTotal { idr: number; usd: number; count: number }
export interface WithdrawalPctTotals { officeHourPct: number | null; ofDepositsPct: number | null; office: number; second: number; total: number }
export interface PeriodTotals { deposit: MoneyTotal; withdrawal: MoneyTotal; netIdr: number; withdrawalPct: WithdrawalPctTotals }
export interface DealsHistorySummary {
  status: 'complete' | 'pending';
  commissionByRate: Record<Rate, number>;
  swapByRate: Record<Rate, number>;
  commissionIdr: number;
  commissionUsd: number;
  observedDays: number;
  attestedDays: number;
  pendingDays: number;
  totalDays: number;
  lastCoveredDate: string | null;
}
export interface PeriodSummary {
  range: DateRange;
  totals: PeriodTotals;
  processing: { deposit: number | null; withdrawal: number | null };
  commission?: DealsHistorySummary;
}
export interface DailyFlow {
  date: string;
  depositIdr: number;
  withdrawalIdr: number;
  depositUsd: number;
  withdrawalUsd: number;
  netIdr: number;
  depositCount: number;
  withdrawalCount: number;
  officeHourPct: number | null;
}

type DayKey = (iso: string) => string;
const round2 = (value: number) => Math.round(value * 100) / 100;
const emptyRates = (): Record<Rate, number> => ({ 1: 0, 10000: 0, 12000: 0, 14000: 0 });

export function previousSettlementRange(period: { preset: string; anchor: string; range: DateRange }): DateRange {
  if (period.preset === 'day') {
    const previous = addDays(period.anchor, -1);
    return { from: previous, to: previous };
  }
  if (period.preset === 'week') return { from: addDays(period.range.from, -7), to: addDays(period.range.to, -7) };
  if (period.preset === 'month') {
    const [year, month] = period.range.from.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 2, 1));
    const end = new Date(Date.UTC(year, month - 1, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  const length = daysBetween(period.range.from, period.range.to);
  const to = addDays(period.range.from, -1);
  return { from: addDays(to, 1 - length), to };
}

function addMoney(total: MoneyTotal, tx: CrmTransaction) {
  if (tx.amountUsd === null || tx.rate === null) return;
  if (tx.rate === 1) total.usd += tx.amountUsd;
  else total.idr += tx.amountUsd * tx.rate;
  total.count += 1;
}

export function periodTotals(deposits: CrmTransaction[], withdrawals: CrmTransaction[], range: DateRange, dayKey: DayKey = wibDateOf): PeriodTotals {
  const deposit: MoneyTotal = { idr: 0, usd: 0, count: 0 };
  const withdrawal: MoneyTotal = { idr: 0, usd: 0, count: 0 };
  for (const tx of deposits) {
    if (tx.status !== 'Successful' || !tx.completedAt || !inRange(dayKey(tx.completedAt), range)) continue;
    addMoney(deposit, tx);
  }
  let second = 0;
  let requests = 0;
  for (const tx of withdrawals) {
    if (!inRange(dayKey(tx.requestedAt), range)) continue;
    requests += 1;
    if (tx.completedAt && wibDateOf(tx.completedAt) > wibDateOf(tx.requestedAt)) second += 1;
    if (tx.status !== 'Successful') continue;
    addMoney(withdrawal, tx);
  }
  const office = requests - second;
  return {
    deposit: { idr: round2(deposit.idr), usd: round2(deposit.usd), count: deposit.count },
    withdrawal: { idr: round2(withdrawal.idr), usd: round2(withdrawal.usd), count: withdrawal.count },
    netIdr: round2(deposit.idr - withdrawal.idr),
    withdrawalPct: {
      officeHourPct: requests > 0 ? (office / requests) * 100 : null,
      ofDepositsPct: deposit.idr > 0 ? (withdrawal.idr / deposit.idr) * 100 : null,
      office, second, total: requests,
    },
  };
}

function inRange(day: string, range: DateRange) { return day >= range.from && day <= range.to; }

export function dailyFlows(deposits: CrmTransaction[], withdrawals: CrmTransaction[], range: DateRange, dayKey: DayKey = wibDateOf): DailyFlow[] {
  return eachDate(range.from, range.to).map(date => {
    const totals = periodTotals(deposits, withdrawals, { from: date, to: date }, dayKey);
    return {
      date,
      depositIdr: totals.deposit.idr,
      withdrawalIdr: totals.withdrawal.idr,
      depositUsd: totals.deposit.usd,
      withdrawalUsd: totals.withdrawal.usd,
      netIdr: totals.netIdr,
      depositCount: totals.deposit.count,
      withdrawalCount: totals.withdrawal.count,
      officeHourPct: totals.withdrawalPct.officeHourPct,
    };
  });
}

export function dealsHistorySummary(days: DealsDay[]): DealsHistorySummary {
  const commissionByRate = emptyRates();
  const swapByRate = emptyRates();
  let observedDays = 0;
  let attestedDays = 0;
  let pendingDays = 0;
  let lastCoveredDate: string | null = null;
  for (const day of days) {
    if (day.status === 'missing' || day.status === 'partial') { pendingDays += 1; continue; }
    if (day.status === 'attested') attestedDays += 1;
    else observedDays += 1;
    if (day.commission && day.swap) {
      for (const rate of RATES) {
        commissionByRate[rate] += day.commission[rate];
        swapByRate[rate] += day.swap[rate];
      }
    }
    if (!lastCoveredDate || day.date > lastCoveredDate) lastCoveredDate = day.date;
  }
  for (const rate of RATES) {
    commissionByRate[rate] = round2(commissionByRate[rate]);
    swapByRate[rate] = round2(swapByRate[rate]);
  }
  const commissionIdr = round2(RATES.filter(rate => rate !== 1).reduce((sum, rate) => sum + commissionByRate[rate] * rate, 0));
  return {
    status: pendingDays > 0 ? 'pending' : 'complete',
    commissionByRate, swapByRate, commissionIdr, commissionUsd: commissionByRate[1],
    observedDays, attestedDays, pendingDays, totalDays: days.length, lastCoveredDate,
  };
}

export type SourceFreshness = { status: 'current' } | { status: 'behind'; days: number } | { status: 'none' };

/** Current when the source reaches yesterday (WIB) or later. */
export function sourceFreshness(through: string | null, today: string): SourceFreshness {
  if (!through) return { status: 'none' };
  if (through >= addDays(today, -1)) return { status: 'current' };
  return { status: 'behind', days: daysBetween(through, today) - 1 };
}

export function coverageTone(through: string | null, rangeEnd: string): 'ok' | 'warn' {
  return through && through >= rangeEnd ? 'ok' : 'warn';
}
