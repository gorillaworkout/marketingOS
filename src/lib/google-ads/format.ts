/** Display helpers for the Google Ads dashboard (pure, client-safe). */

export function formatMoney(value: number, currency = 'IDR', compact = false): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'IDR';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: code, currencyDisplay: 'code',
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 2 : (code === 'IDR' ? 0 : 2),
    }).format(value).replace(/\u00a0/g, ' ');
  } catch {
    return `${code} ${Math.round(value).toLocaleString('en-US')}`;
  }
}

export function formatCount(value: number, compact = false): string {
  return new Intl.NumberFormat('en-US', { notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 2 : 0 }).format(value);
}

export function formatConversions(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value);
}

export function formatRate(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/** '1234567890' -> '123-456-7890'. */
export function formatCustomerId(id: string): string {
  return /^[0-9]{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

/** Relative change vs previous period; `lowerIsBetter` for cost metrics. */
export function changeVs(current: number | null, previous: number | null, lowerIsBetter = false): { text: string; good: boolean | null } {
  if (current == null || previous == null || !previous) return { text: 'no comparison', good: null };
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.0005) return { text: '±0%', good: null };
  return { text: `${change > 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(1)}%`, good: lowerIsBetter ? change < 0 : change > 0 };
}

/** Today's date in Asia/Jakarta (Google Ads account time zone for Dupoin). */
export function jakartaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Preset range ending yesterday (Jakarta), like Google Ads' "Last N days"; 'today' is today only. */
export function presetRange(preset: string, now = new Date()): { start: string; end: string } {
  const today = jakartaToday(now);
  if (preset === 'today') return { start: today, end: today };
  const days = Number(preset.replace(/d$/, '')) || 30;
  const end = shiftDate(today, -1);
  return { start: shiftDate(end, -(days - 1)), end };
}
