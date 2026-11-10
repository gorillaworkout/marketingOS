import { addDays, isIsoDate, weekdayOf, type DateRange } from '@/lib/monthly-report/periods';
import { reconciliationWindow, wibDateOf } from '@/lib/settlement/conventions';
import { formatDailySpan } from '@/lib/settlement/format';
import type { SettlementPeriod, SettlementPreset } from '@/lib/settlement/report';

const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Daily windows use both dates ("05–06 Nov"). The anchor is the window's end date. */
export function dailyPairLabel(endDate: string): string {
  return formatDailySpan(wibDateOf(reconciliationWindow(endDate).start), endDate);
}

export function periodTitle(period: Pick<SettlementPeriod, 'preset' | 'anchor' | 'range'>): string {
  if (period.preset === 'day') return dailyPairLabel(period.anchor);
  if (period.preset === 'month') return `${LONG[Number(period.range.from.slice(5, 7)) - 1]} ${period.range.from.slice(0, 4)}`;
  const span = formatDailySpan(period.range.from, period.range.to);
  return span.includes(period.range.to.slice(0, 4)) ? span : `${span} ${period.range.to.slice(0, 4)}`;
}

export function periodSubtitle(period: SettlementPeriod): string {
  if (period.preset === 'day' && period.window) return period.window.label;
  if (period.preset === 'week') return 'Mon–Sun · WIB';
  const month = SHORT[Number(period.range.from.slice(5, 7)) - 1];
  return `${Number(period.range.from.slice(8))} – ${Number(period.range.to.slice(8))} ${month} ${period.range.from.slice(0, 4)} · WIB`;
}

export function previousTitle(preset: SettlementPreset, range: DateRange): string {
  return periodTitle({ preset, anchor: preset === 'day' ? range.to : range.from, range });
}

/**
 * Value from the period picker. Daily stays the report day (the 12:00 window that ends that day).
 * Weekly snaps to the Monday of the Mon–Sun week that contains the picked date.
 * Monthly accepts YYYY-MM and returns the first of that month.
 */
export function anchorFromPicker(preset: string, raw: string): string | null {
  if (preset === 'month') {
    if (!/^\d{4}-\d{2}$/.test(raw)) return null;
    const anchor = `${raw}-01`;
    return isIsoDate(anchor) ? anchor : null;
  }
  if (!isIsoDate(raw)) return null;
  if (preset === 'week') return addDays(raw, 1 - weekdayOf(raw));
  return raw;
}

export function shiftAnchor(anchor: string, preset: string, direction: number): string {
  const date = new Date(`${anchor}T00:00:00Z`);
  if (preset === 'month') date.setUTCMonth(date.getUTCMonth() + direction, 1);
  else date.setUTCDate(date.getUTCDate() + direction * (preset === 'week' ? 7 : 1));
  return date.toISOString().slice(0, 10);
}

export const todayWib = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

export function generatedAtWib(now = Date.now()): string {
  return `${new Date(now + 7 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')} WIB`;
}

export function defaultReconDate(now = Date.now()): string {
  const wib = new Date(now + 7 * 3_600_000);
  if (wib.getUTCHours() >= 12) return wib.toISOString().slice(0, 10);
  return addDays(wib.toISOString().slice(0, 10), -1);
}
