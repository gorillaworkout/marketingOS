/**
 * BI JISDOR daily fixings. Display only: this module does not convert commission or swap,
 * and it does not copy a previous fixing onto a missing date.
 * Fetch is on demand from the Settlement Report page. No scheduled job is installed.
 */
export const JISDOR_PAGE_URL = 'https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx';

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  january: 1, february: 2, march: 3, may: 5, june: 6, july: 7, august: 8, october: 10, december: 12,
};

export interface JisdorFixing { date: string; rate: number }

const DATE_RE = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/;

export function parseJisdorDate(text: string): string | null {
  const match = DATE_RE.exec(text.trim());
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  const day = Number(match[1]);
  const date = `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const check = new Date(`${date}T00:00:00Z`);
  if (check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  return date;
}

/**
 * "Rp 18.103,00" → 18103. Dots are thousands and the comma is decimals.
 * A value with no comma, such as 18.103, is rejected rather than guessed.
 */
export function parseJisdorRate(text: string): number | null {
  const raw = text.replace(/rp/ig, '').replace(/\s/g, '');
  if (!/^\d{1,3}(\.\d{3})*,\d{2}$/.test(raw)) return null;
  return Number(raw.replace(/\./g, '').replace(',', '.'));
}

/** Rows the page actually published. Dates that are absent stay absent. */
export function parseJisdorHtml(html: string): JisdorFixing[] {
  const rows: JisdorFixing[] = [];
  const seen = new Set<string>();
  const pattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => cell[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
    if (cells.length < 2) continue;
    const date = parseJisdorDate(cells[0]);
    const rate = parseJisdorRate(cells[1]);
    if (!date || rate === null || seen.has(date)) continue;
    seen.add(date);
    rows.push({ date, rate });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export interface JisdorMonthRow { date: string; rate: number; change: number | null }

/**
 * Published fixings in one month, newest first.
 * Change is versus the previous published fixing, which may fall in the prior month.
 * Dates the source omitted (weekends, holidays) are not invented.
 */
export function jisdorMonthTable(fixings: readonly JisdorFixing[], yearMonth: string): JisdorMonthRow[] {
  const sorted = [...fixings].sort((a, b) => a.date.localeCompare(b.date));
  const withChange = sorted.map((row, index) => {
    const previous = index === 0 ? null : sorted[index - 1].rate;
    const change = previous === null ? null : Math.round((row.rate - previous) * 100) / 100;
    return { date: row.date, rate: row.rate, change };
  });
  return withChange.filter(row => row.date.startsWith(`${yearMonth}-`)).reverse();
}

export const JISDOR_MONTH_UNAVAILABLE = 'JISDOR not available for this month';

/** Upsert parsed dates only. Does not invent a row for a gap between them. */
export function applyFixings(existing: readonly JisdorFixing[], parsed: readonly JisdorFixing[]): JisdorFixing[] {
  const rates = new Map(existing.map(row => [row.date, row.rate]));
  for (const row of parsed) rates.set(row.date, row.rate);
  return [...rates].map(([date, rate]) => ({ date, rate })).sort((a, b) => a.date.localeCompare(b.date));
}
