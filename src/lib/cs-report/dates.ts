/** Date helpers. All CS dates are plain WIB calendar dates (YYYY-MM-DD). */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today in Asia/Jakarta (UTC+7, no DST). */
export function todayWib(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function weekBounds(date: string): { from: string; to: string } {
  const from = addDays(date, -weekdayIndex(date));
  return { from, to: addDays(from, 6) };
}

export function monthBounds(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

export type PeriodKind = 'day' | 'week' | 'month' | 'custom';

export function periodRange(kind: PeriodKind, anchor: string, customTo?: string): { from: string; to: string } {
  if (kind === 'day') return { from: anchor, to: anchor };
  if (kind === 'week') return weekBounds(anchor);
  if (kind === 'month') return monthBounds(anchor);
  const to = customTo && isIsoDate(customTo) ? customTo : anchor;
  return to < anchor ? { from: to, to: anchor } : { from: anchor, to };
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 1000; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Excel serials / JS Dates from the workbook are UTC-midnight dates. */
export function dateToIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}
