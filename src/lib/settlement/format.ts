/** Screen formatters for the Settlement Report. Exports keep exact values. */

const MINUS = '−';
const EM = '—';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const idrFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usdFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function empty(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined || Number.isNaN(value);
}

/** Half away from zero, so −1234.5 IDR becomes −1,235. */
function roundHalfAway(value: number, digits: number): number {
  const factor = 10 ** digits;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * factor)) / factor;
}

function signed(text: string, negative: boolean): string {
  return negative ? `${MINUS}${text}` : text;
}

export function formatIdr(value: number | null | undefined): string {
  if (empty(value)) return EM;
  const rounded = roundHalfAway(value, 0);
  return signed(idrFormat.format(Math.abs(rounded)), rounded < 0);
}

export function formatUsd(value: number | null | undefined): string {
  if (empty(value)) return EM;
  const rounded = roundHalfAway(value, 2);
  return signed(usdFormat.format(Math.abs(rounded)), rounded < 0);
}

function compactUnit(value: number, digits: number): string {
  const rounded = roundHalfAway(value, digits);
  return rounded.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatCompact(value: number | null | undefined): string {
  if (empty(value)) return EM;
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1_000_000_000) text = `${compactUnit(abs / 1_000_000_000, 2)} B`;
  else if (abs >= 1_000_000) text = `${compactUnit(abs / 1_000_000, 2)} M`;
  else if (abs >= 1_000) text = `${compactUnit(abs / 1_000, 1)} K`;
  else text = String(Math.round(abs));
  return signed(text, value < 0);
}

/** Under an hour: `4m 12s`. An hour or more: `20h 15m`. */
export function formatDurationShort(totalSeconds: number | null | undefined): string {
  if (empty(totalSeconds)) return EM;
  const negative = totalSeconds < 0;
  const seconds = Math.round(Math.abs(totalSeconds));
  const text = seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return signed(text, negative);
}

/** "05–06 Nov" for a same-month window; months and years are added only when they differ. */
export function formatDailySpan(from: string, to: string): string {
  const [y1, m1, d1] = from.split('-');
  const [y2, m2, d2] = to.split('-');
  const day = (value: string) => value.padStart(2, '0');
  const month = (value: string) => MONTHS[Number(value) - 1];
  if (y1 === y2 && m1 === m2) return `${day(d1)}–${day(d2)} ${month(m1)}`;
  if (y1 === y2) return `${day(d1)} ${month(m1)}–${day(d2)} ${month(m2)}`;
  return `${day(d1)} ${month(m1)} ${y1}–${day(d2)} ${month(m2)} ${y2}`;
}

export type DeltaKind = 'relative' | 'points' | 'seconds';
export type Favourable = 'up' | 'down' | 'neutral';
export interface Delta { text: string; tone: 'good' | 'bad' | 'neutral' | 'flat'; sr: string }

const FLAT_RELATIVE_PCT = 0.05;

export function computeDelta(current: number | null, previous: number | null, options: { kind: DeltaKind; favourable: Favourable }): Delta | null {
  if (current === null || previous === null || previous === 0) return null;
  const diff = current - previous;
  const relativePct = (diff / Math.abs(previous)) * 100;
  if (Math.abs(relativePct) < FLAT_RELATIVE_PCT) {
    return { text: '0', tone: 'flat', sr: 'unchanged versus previous period' };
  }
  const up = diff > 0;
  const arrow = up ? '▲' : '▼';
  const direction = up ? 'up' : 'down';
  let magnitude: string;
  let spoken: string;
  if (options.kind === 'relative') {
    const pct = Math.abs(relativePct).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    magnitude = `${pct}%`;
    spoken = `${direction} ${pct}% versus previous period`;
  } else if (options.kind === 'points') {
    const points = Math.abs(diff).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    magnitude = `${points} pt`;
    spoken = `${direction} ${points} points versus previous period`;
  } else {
    const seconds = Math.round(Math.abs(diff));
    magnitude = seconds < 60 ? `${seconds}s` : formatDurationShort(seconds);
    spoken = `${direction} ${seconds} seconds versus previous period`;
  }
  const tone = options.favourable === 'neutral' ? 'neutral'
    : (up && options.favourable === 'up') || (!up && options.favourable === 'down') ? 'good' : 'bad';
  return { text: `${arrow} ${magnitude}`, tone, sr: spoken };
}
