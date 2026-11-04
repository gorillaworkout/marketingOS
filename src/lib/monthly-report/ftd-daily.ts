/**
 * Manual daily FTD entry: the FTD number of one WIB day typed in by an
 * uploader (date + count, optional amount), stored in onboarding_ftd_daily.
 *
 * Precedence, per WIB day:
 *  1. A manual entry exists for the day → FTD count and amount come from it
 *     (an entered 0 is a real 0). If its amount was left empty, the day's
 *     amount is "not entered" (it is NOT taken from the account rows, so count
 *     and amount always describe the same source).
 *  2. Otherwise → derived from the account-level rows (onboarding_ftd, one row
 *     per trading account, from the FTD report CSV), as before.
 *
 * FTD coverage ("data through", missing days, "No data") = days with a manual
 * entry OR covered by an account-level FTD upload.
 *
 * The same-account cohort metrics ("Activated → FTD (same accounts)", "From
 * accounts activated this period") need account numbers, which a manual count
 * does not have; they are only reported when account-level FTD data covers the
 * whole period (see `cohortAvailable` in metrics.ts), otherwise "No data".
 *
 * Pure functions only (no database), so client components and tests import them.
 */
import { isIsoDate, type DateRange } from './periods';
import { mergeRanges, type DataCoverage } from './coverage';
import type { DailyFtd } from './metrics';

export interface ManualFtdEntry {
  /** WIB calendar day, `YYYY-MM-DD`. */
  date: string;
  count: number;
  /** USD; null = not entered. */
  amount: number | null;
  updatedByName: string | null;
  /** ISO timestamp of the last save. */
  updatedAt: string;
  createdAt?: string;
}

export interface ManualFtdInput { date: string; count: number; amount: number | null }

export const MAX_DAILY_FTD_COUNT = 1_000_000;
export const MAX_DAILY_FTD_AMOUNT = 1_000_000_000;

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/,/g, '');
    if (trimmed === '') return null;
    return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : NaN;
  }
  if (value === null || value === undefined) return null;
  return NaN;
}

/**
 * Validates a manual entry from the form/API. `today` (WIB) is the latest
 * allowed date: FTDs of future days cannot be entered.
 */
export function validateManualFtd(body: unknown, today: string): { ok: true; value: ManualFtdInput } | { ok: false; error: string } {
  const input = (body ?? {}) as Record<string, unknown>;
  const date = typeof input.date === 'string' ? input.date.trim() : '';
  if (!isIsoDate(date)) return { ok: false, error: 'Date must be a valid date (YYYY-MM-DD, WIB).' };
  if (date > today) return { ok: false, error: 'Date cannot be in the future (WIB).' };
  const count = parseNumber(input.count);
  if (count === null) return { ok: false, error: 'FTD count is required.' };
  if (!Number.isInteger(count) || count < 0) return { ok: false, error: 'FTD count must be a whole number of 0 or more.' };
  if (count > MAX_DAILY_FTD_COUNT) return { ok: false, error: `FTD count must be at most ${MAX_DAILY_FTD_COUNT.toLocaleString('en-US')}.` };
  const amount = parseNumber(input.amount);
  if (amount !== null) {
    if (Number.isNaN(amount) || amount < 0) return { ok: false, error: 'FTD amount must be a number of 0 or more (USD), or empty.' };
    if (amount > MAX_DAILY_FTD_AMOUNT) return { ok: false, error: 'FTD amount is too large.' };
    if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
      return { ok: false, error: 'FTD amount can have at most 2 decimals.' };
    }
  }
  return { ok: true, value: { date, count, amount: amount === null ? null : Math.round(amount * 100) / 100 } };
}

/** Manual day → DailyFtd (no account types: micro/standard are unknown, counted as 0). */
export function manualToDaily(entry: Pick<ManualFtdEntry, 'date' | 'count' | 'amount'>): DailyFtd {
  return {
    date: entry.date, count: entry.count, amount: entry.amount ?? 0, micro: 0, standard: 0, other: 0,
    source: 'manual', amountEntered: entry.amount !== null,
  };
}

/** Applies the precedence: a manual entry replaces the derived (account-level) value of its day. */
export function mergeDailyFtd(derived: readonly DailyFtd[], manual: readonly Pick<ManualFtdEntry, 'date' | 'count' | 'amount'>[]): DailyFtd[] {
  const days = new Map<string, DailyFtd>();
  for (const day of derived) days.set(day.date, { ...day, source: 'accounts', amountEntered: true });
  for (const entry of manual) days.set(entry.date, manualToDaily(entry));
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Days with a manual entry, as merged ranges (for FTD coverage). */
export function manualCoverage(dates: readonly string[]): DateRange[] {
  return mergeRanges(dates.filter(isIsoDate).map(date => ({ from: date, to: date })));
}

/** Overall FTD span (first → last day) across account rows and manual entries. */
export function combinedSpan(accountSpan: DateRange | null, manualDates: readonly string[]): DateRange | null {
  const dates = [...manualDates.filter(isIsoDate), ...(accountSpan ? [accountSpan.from, accountSpan.to] : [])].sort();
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
}

/**
 * Adds the manual days to the FTD coverage. `ftd` becomes "upload OR manual";
 * `ftdAccounts` keeps the account-level (upload) part for the cohort metrics.
 */
export function withManualFtdCoverage(coverage: DataCoverage, manualDates: readonly string[]): DataCoverage {
  return {
    ...coverage,
    ftd: mergeRanges([...coverage.ftd, ...manualCoverage(manualDates)]),
    ftdAccounts: coverage.ftdAccounts ?? coverage.ftd,
  };
}

export const FTD_SOURCE_LABELS = { manual: 'Manual entry', accounts: 'FTD file (accounts)' } as const;
