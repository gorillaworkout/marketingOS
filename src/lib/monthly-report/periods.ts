/**
 * Monthly Report periods. Every date is a plain `YYYY-MM-DD` string for a
 * calendar day in Asia/Jakarta (WIB), so nothing here depends on the server
 * timezone. Ranges are inclusive on both ends.
 */

export const PERIOD_PRESETS = ['day', 'week', 'month', '3m', 'year', 'custom'] as const;
export type PeriodPreset = typeof PERIOD_PRESETS[number];
export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = typeof GRANULARITIES[number];

export const PRESET_LABELS: Record<PeriodPreset, string> = {
  day: 'Day', week: 'Week', month: 'Month', '3m': '3 Months', year: 'Year', custom: 'Custom',
};

export const MAX_RANGE_DAYS = 366;
export const REPORT_TIMEZONE = 'Asia/Jakarta';

export interface DateRange { from: string; to: string }
export interface Bucket extends DateRange { key: string; label: string }
export interface PeriodInput { preset: PeriodPreset; anchor?: string; from?: string; to?: string }
export interface ResolvedPeriod {
  preset: PeriodPreset;
  anchor: string;
  range: DateRange;
  previous: DateRange;
  days: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3];
}

function assertDate(value: unknown, name: string): string {
  if (!isIsoDate(value)) throw new Error(`${name} must be a valid date (YYYY-MM-DD)`);
  return value;
}

function toUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const value = toUtc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return fromUtc(value);
}

/** Monday = 1 … Sunday = 7. */
export function weekdayOf(date: string): number {
  return toUtc(date).getUTCDay() || 7;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000) + 1;
}

function monthStart(date: string): string { return `${date.slice(0, 7)}-01`; }

function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return fromUtc(new Date(Date.UTC(y, m, 0)));
}

/** Adds months to a date, clamping the day to the target month's length. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return fromUtc(target);
}

function shortDay(date: string): string { return date.slice(8, 10); }

/**
 * Report weeks for one calendar month (`YYYY-MM`). Weeks end on Sunday and
 * never cross the month boundary. A first partial week is merged into the
 * next week; a last partial week stays on its own when it has 4+ days,
 * otherwise it is merged into the previous week.
 */
export function monthWeekBuckets(month: string): Bucket[] {
  const first = `${month}-01`;
  const last = monthEnd(first);
  const weeks: DateRange[] = [];
  let start = first;
  while (start <= last) {
    const sunday = addDays(start, 7 - weekdayOf(start));
    const end = sunday < last ? sunday : last;
    weeks.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  if (weeks.length > 1 && weekdayOf(first) !== 1) {
    const [head, next] = weeks.splice(0, 2);
    weeks.unshift({ from: head.from, to: next.to });
  }
  const tail = weeks[weeks.length - 1];
  if (weeks.length > 1 && daysBetween(tail.from, tail.to) < 4) {
    weeks.pop();
    weeks[weeks.length - 1] = { from: weeks[weeks.length - 1].from, to: tail.to };
  }
  return weeks.map((week, index) => ({
    ...week,
    key: `${month}-W${index + 1}`,
    label: `Week ${ROMAN[index] ?? index + 1} (${shortDay(week.from)}-${shortDay(week.to)})`,
  }));
}

function monthLabel(date: string): string {
  return `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

export function formatDayLabel(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]}`;
}

/** Buckets covering [from, to]; week and month buckets are clipped to the range. */
export function reportBuckets(from: string, to: string, granularity: Granularity): Bucket[] {
  const buckets: Bucket[] = [];
  if (granularity === 'day') {
    for (let day = from; day <= to; day = addDays(day, 1)) buckets.push({ key: day, from: day, to: day, label: formatDayLabel(day) });
    return buckets;
  }
  const multiMonth = from.slice(0, 7) !== to.slice(0, 7);
  for (let month = monthStart(from); month <= to; month = addMonths(month, 1)) {
    const parts: Bucket[] = granularity === 'month'
      ? [{ key: month.slice(0, 7), from: month, to: monthEnd(month), label: monthLabel(month) }]
      : monthWeekBuckets(month.slice(0, 7)).map(week => (
        multiMonth ? { ...week, label: `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${week.label.replace(/^Week /, 'W')}` } : week
      ));
    for (const part of parts) {
      const clipped = { from: part.from < from ? from : part.from, to: part.to > to ? to : part.to };
      if (clipped.from > clipped.to) continue;
      const changed = clipped.from !== part.from || clipped.to !== part.to;
      const label = changed && granularity === 'week'
        ? part.label.replace(/\(\d{2}-\d{2}\)$/, `(${shortDay(clipped.from)}-${shortDay(clipped.to)})`)
        : part.label;
      buckets.push({ ...part, ...clipped, label });
    }
  }
  return buckets;
}

function weekContaining(date: string): DateRange {
  const week = monthWeekBuckets(date.slice(0, 7)).find(item => item.from <= date && date <= item.to)!;
  return { from: week.from, to: week.to };
}

function rangeFor(preset: Exclude<PeriodPreset, 'custom'>, anchor: string): DateRange {
  switch (preset) {
    case 'day': return { from: anchor, to: anchor };
    case 'week': return weekContaining(anchor);
    case 'month': return { from: monthStart(anchor), to: monthEnd(anchor) };
    case '3m': return { from: monthStart(addMonths(anchor, -2)), to: monthEnd(anchor) };
    case 'year': return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
  }
}

function previousFor(preset: PeriodPreset, range: DateRange): DateRange {
  if (preset === 'custom' || preset === 'day') {
    const days = daysBetween(range.from, range.to);
    return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
  }
  return rangeFor(preset, addDays(range.from, -1));
}

export function resolvePeriod(input: PeriodInput): ResolvedPeriod {
  if (!(PERIOD_PRESETS as readonly string[]).includes(input.preset)) throw new Error('preset is not supported');
  if (input.preset === 'custom') {
    const from = assertDate(input.from, 'from');
    const to = assertDate(input.to, 'to');
    if (from > to) throw new Error('from must be on or before to');
    const days = daysBetween(from, to);
    if (days > MAX_RANGE_DAYS) throw new Error(`Custom ranges are limited to ${MAX_RANGE_DAYS} days`);
    const range = { from, to };
    return { preset: 'custom', anchor: from, range, previous: previousFor('custom', range), days };
  }
  const anchor = assertDate(input.anchor, 'anchor date');
  const range = rangeFor(input.preset, anchor);
  return { preset: input.preset, anchor, range, previous: previousFor(input.preset, range), days: daysBetween(range.from, range.to) };
}

/** Moves the period one step back (-1) or forward (+1). */
export function shiftAnchor(input: PeriodInput, direction: -1 | 1): PeriodInput {
  const period = resolvePeriod(input);
  switch (period.preset) {
    case 'custom': {
      const shift = direction * period.days;
      return { preset: 'custom', from: addDays(period.range.from, shift), to: addDays(period.range.to, shift) };
    }
    case 'day': return { preset: 'day', anchor: addDays(period.anchor, direction) };
    case 'week': return { preset: 'week', anchor: direction < 0 ? period.previous.from : addDays(period.range.to, 1) };
    case 'month': return { preset: 'month', anchor: addMonths(period.anchor, direction) };
    case '3m': return { preset: '3m', anchor: addMonths(period.anchor, 3 * direction) };
    case 'year': return { preset: 'year', anchor: addMonths(period.anchor, 12 * direction) };
  }
}

export function defaultGranularity(preset: PeriodPreset): Granularity {
  if (preset === 'day' || preset === 'week') return 'day';
  if (preset === 'year') return 'month';
  return 'week';
}

export function describeRange(range: DateRange): string {
  if (range.from === range.to) return `${formatDayLabel(range.from)} ${range.from.slice(0, 4)}`;
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${formatDayLabel(range.from)}${sameYear ? '' : ` ${range.from.slice(0, 4)}`} – ${formatDayLabel(range.to)} ${range.to.slice(0, 4)}`;
}
