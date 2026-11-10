/**
 * Settlement data conventions (see SPEC-settlement-phase1.md §2).
 *  - CRM times are WIB wall-clock "dd/mm/yyyy HH:MM:SS"; "--" = empty.
 *  - MT5 times are server wall-clock in EET/EEST (EU DST rules).
 *  - Rate (IDR per USD) comes from the 2nd digit of the account/login.
 */
export type Rate = 1 | 10000 | 12000 | 14000;
export const RATES: readonly Rate[] = [1, 10000, 12000, 14000];
const RATE_BY_DIGIT: Record<string, Rate> = { '0': 10000, '2': 12000, '4': 14000, '9': 1 };

const HOUR_MS = 3_600_000;
const WIB_OFFSET_MS = 7 * HOUR_MS;

/** 2041125 → 10000, 2200001 → 12000, 2443172 → 14000, 2901960 → 1; anything else → null. */
export function rateFromAccount(account: string | number | null | undefined): Rate | null {
  const value = String(account ?? '').trim();
  if (!/^\d{2,}$/.test(value)) return null;
  return RATE_BY_DIGIT[value[1]] ?? null;
}

/** "IDR 4000000.00000" → { currency: 'IDR', value: 4000000 }; "--" / blank → null. */
export function parseMoney(raw: unknown): { currency: string; value: number } | null {
  const text = String(raw ?? '').trim();
  const match = /^([A-Z]{3})\s+(-?\d+(?:\.\d+)?)$/.exec(text);
  if (!match) return null;
  return { currency: match[1], value: Number(match[2]) };
}

/** "05/11/2026 12:00:01" (WIB, day first) or an Excel serial → ISO UTC; "--" / invalid → null. */
export function parseCrmDate(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return new Date(Math.round(raw * 86_400) * 1000 + Date.UTC(1899, 11, 30) - WIB_OFFSET_MS).toISOString();
  }
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(raw ?? '').trim());
  if (!match) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = match.map(Number);
  const utc = Date.UTC(yyyy, mm - 1, dd, hh, mi, ss) - WIB_OFFSET_MS;
  const check = new Date(utc + WIB_OFFSET_MS);
  if (check.getUTCDate() !== dd || check.getUTCMonth() !== mm - 1) return null;
  return new Date(utc).toISOString();
}

/** Start of EU summer time for a year: last Sunday of March/October at 01:00 UTC. */
function lastSundayAt0100Utc(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const day = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, month, day, 1, 0, 0);
}

export function isEuSummerTime(utcMs: number): boolean {
  const year = new Date(utcMs).getUTCFullYear();
  return utcMs >= lastSundayAt0100Utc(year, 2) && utcMs < lastSundayAt0100Utc(year, 9);
}

/** Server zone of the MT5 exports: EET (UTC+2) / EEST (UTC+3). */
export const MT5_SERVER_TZ = 'Europe/Athens';

/** "2026.11.05 07:00:00" (MT5 server) → "2026-11-05T05:00:00.000Z". Ambiguous fall-back hour → first (summer) occurrence. */
export function mt5ServerToUtc(raw: unknown): string | null {
  const match = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(raw ?? '').trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const local = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  const asSummer = local - 3 * HOUR_MS;
  const utc = isEuSummerTime(asSummer) ? asSummer : local - 2 * HOUR_MS;
  return new Date(utc).toISOString();
}

/** "2026.11.05 07:00:20" → "2026-11-05 07:00:20" (stored as TIMESTAMP without zone). */
export function mt5ServerTimestamp(raw: unknown): string | null {
  const match = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(raw ?? '').trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d} ${h}:${mi}:${s ?? '00'}`;
}

export interface WibParts { date: string; hour: number; weekday: number }

/** WIB calendar parts of an ISO instant. weekday: 0 = Sunday … 6 = Saturday. */
export function wibParts(iso: string): WibParts {
  const shifted = new Date(Date.parse(iso) + WIB_OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours(), weekday: shifted.getUTCDay() };
}

export const wibDateOf = (iso: string) => wibParts(iso).date;

/** Report day of an instant: the 12:00 WIB window that contains it. D 12:00:00 belongs to D. */
export function settlementDayOf(iso: string): string {
  return wibDateOf(new Date(Date.parse(iso) + 12 * HOUR_MS - 1).toISOString());
}

export const OFFICE_START_HOUR = 9;
export const OFFICE_END_HOUR = 18;

/** Mon–Fri, 09:00 ≤ time < 18:00 WIB, and not a holiday (YYYY-MM-DD set). */
export function isOfficeHour(iso: string, holidays: ReadonlySet<string> = new Set()): boolean {
  const { date, hour, weekday } = wibParts(iso);
  return weekday >= 1 && weekday <= 5 && hour >= OFFICE_START_HOUR && hour < OFFICE_END_HOUR && !holidays.has(date);
}

export const SETTLEMENT_CUTOFF_HOUR = 12;

/** Report date D → window (D−1 12:00:00, D 12:00:00] WIB, as ISO instants. Every calendar day, weekends included. */
export function reconciliationWindow(date: string): { start: string; end: string; label: string } {
  const endMs = Date.parse(`${date}T${String(SETTLEMENT_CUTOFF_HOUR).padStart(2, '0')}:00:00.000Z`) - WIB_OFFSET_MS;
  const startMs = endMs - 24 * HOUR_MS;
  const previous = new Date(startMs + WIB_OFFSET_MS).toISOString().slice(0, 10);
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), label: `${previous} 12:00:01 – ${date} 12:00:00 WIB` };
}

export function inWindow(iso: string | null, window: { start: string; end: string }): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t > Date.parse(window.start) && t <= Date.parse(window.end);
}

/** Holidays seeded by migration 046 (from the Recap Time Process list). */
export const SEEDED_HOLIDAYS: ReadonlyArray<[string, string]> = [
  ['2026-03-19', 'Hari Suci Nyepi'],
  ['2026-04-03', 'Jumat Agung'],
  ['2026-05-01', 'Hari Buruh'],
  ['2026-05-27', 'Idul Adha'],
  ['2026-06-01', 'Hari Lahir Pancasila'],
  ['2026-07-06', 'Libur kantor'],
  ['2026-08-17', 'HUT RI'],
  ['2026-08-25', 'Maulid Nabi'],
  ['2026-12-25', 'Hari Natal'],
];
