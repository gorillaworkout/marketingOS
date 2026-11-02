/** Dupoin brand colors (Brand Guidelines 2026), used for Monthly Report charts and highlights. */
export const DUPOIN = {
  teal: '#2EB5C4',
  tealDeep: '#1A8A96',
  ink: '#1A1F24',
  muted: '#5B6B73',
  soft: '#E6F7F9',
} as const;

export const formatInteger = (value: number | null | undefined) => (value === null || value === undefined ? '—' : Math.round(value).toLocaleString('en-US'));
export const formatDecimal = (value: number | null | undefined, digits = 1) => (value === null || value === undefined ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
export const formatPct = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);
export const formatAmount = (value: number | null | undefined) => (value === null || value === undefined ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function formatChange(change: number | null, changePct: number | null): string | null {
  if (change === null) return null;
  const sign = change > 0 ? '+' : change < 0 ? '−' : '±';
  const pct = changePct === null ? '' : ` (${sign}${Math.abs(changePct).toLocaleString('en-US', { maximumFractionDigits: 1 })}%)`;
  return `${sign}${Math.abs(change).toLocaleString('en-US')}${pct}`;
}

export function formatDateTimeWib(iso: string): string {
  const date = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} WIB`;
}
