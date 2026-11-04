/**
 * Data coverage: which WIB days have been delivered by an upload (or CLI
 * import). Every upload row stores the first and last WIB day of its file
 * (`data_from` / `data_to`); a day is covered when it falls inside any
 * upload's range of that kind. Onboarding and FTD are tracked separately.
 *
 * Pure functions only (no database, no xlsx), so client components can import
 * them too. Dates are `YYYY-MM-DD` WIB calendar days, ranges inclusive.
 */
import { addDays, type DateRange } from './periods';

export const COVERAGE_KINDS = ['onboarding', 'ftd'] as const;
export type CoverageKind = typeof COVERAGE_KINDS[number];

/**
 * Merged, sorted, non-overlapping covered ranges per kind. `ftd` = days with
 * FTD data from any source (account-level upload or manual daily entry);
 * `ftdAccounts` = only the account-level uploads (needed by the same-account
 * cohort metrics). When `ftdAccounts` is absent, `ftd` is account-level only.
 */
export interface DataCoverage { onboarding: DateRange[]; ftd: DateRange[]; ftdAccounts?: DateRange[] }

/**
 * How much of a bucket is covered, counting only days up to today (WIB):
 *  - full: every past day is covered
 *  - partial: some past days are covered, some are missing
 *  - none: no past day is covered
 *  - future: the bucket lies entirely after today
 */
export type CoverageState = 'full' | 'partial' | 'none' | 'future';

export interface CoverageSummary {
  /** Last covered WIB day (the latest `data_to`), or null when nothing was uploaded. */
  through: string | null;
  /** Days in the requested range (up to today) that no upload covers, as merged ranges. */
  missing: DateRange[];
  /** Number of missing days. */
  missingDays: number;
}

export interface UploadRange { kind: string; data_from: string | null; data_to: string | null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Sorts and merges overlapping or adjacent (next-day) ranges. Invalid or inverted ranges are dropped. */
export function mergeRanges(ranges: readonly DateRange[]): DateRange[] {
  const valid = ranges
    .filter(range => DATE_RE.test(range.from) && DATE_RE.test(range.to) && range.from <= range.to)
    .map(range => ({ from: range.from, to: range.to }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const merged: DateRange[] = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && range.from <= addDays(last.to, 1)) {
      if (range.to > last.to) last.to = range.to;
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** Builds coverage from upload history rows (web uploads and CLI imports write the same rows). */
export function coverageFromUploads(uploads: readonly UploadRange[]): DataCoverage {
  const byKind: Record<CoverageKind, DateRange[]> = { onboarding: [], ftd: [] };
  for (const upload of uploads) {
    if (!(COVERAGE_KINDS as readonly string[]).includes(upload.kind)) continue;
    if (!upload.data_from || !upload.data_to) continue;
    byKind[upload.kind as CoverageKind].push({ from: upload.data_from.slice(0, 10), to: upload.data_to.slice(0, 10) });
  }
  return { onboarding: mergeRanges(byKind.onboarding), ftd: mergeRanges(byKind.ftd) };
}

export function isDayCovered(day: string, ranges: readonly DateRange[]): boolean {
  return ranges.some(range => day >= range.from && day <= range.to);
}

export function dataThrough(ranges: readonly DateRange[]): string | null {
  return ranges.length ? ranges.reduce((latest, range) => (range.to > latest ? range.to : latest), ranges[0].to) : null;
}

/** The part of `range` that is not after `today` (null when the whole range is in the future). */
export function clampToToday(range: DateRange, today: string): DateRange | null {
  if (range.from > today) return null;
  return { from: range.from, to: range.to > today ? today : range.to };
}

/** Days of `range` up to `today` that no range in `ranges` covers, merged into ranges. */
export function missingRanges(range: DateRange, ranges: readonly DateRange[], today: string): DateRange[] {
  const past = clampToToday(range, today);
  if (!past) return [];
  const missing: DateRange[] = [];
  let cursor = past.from;
  for (const covered of mergeRanges(ranges)) {
    if (covered.to < cursor) continue;
    if (covered.from > past.to) break;
    if (covered.from > cursor) missing.push({ from: cursor, to: addDays(covered.from, -1) });
    cursor = addDays(covered.to, 1);
    if (cursor > past.to) return missing;
  }
  if (cursor <= past.to) missing.push({ from: cursor, to: past.to });
  return missing;
}

export function countDays(ranges: readonly DateRange[]): number {
  let total = 0;
  for (const range of ranges) {
    const from = Date.parse(`${range.from}T00:00:00Z`);
    const to = Date.parse(`${range.to}T00:00:00Z`);
    total += Math.round((to - from) / 86_400_000) + 1;
  }
  return total;
}

export function coverageState(range: DateRange, ranges: readonly DateRange[], today: string): CoverageState {
  const past = clampToToday(range, today);
  if (!past) return 'future';
  const missing = countDays(missingRanges(past, ranges, today));
  if (missing === 0) return 'full';
  return missing === countDays([past]) ? 'none' : 'partial';
}

export function summarizeCoverage(range: DateRange, ranges: readonly DateRange[], today: string): CoverageSummary {
  const missing = missingRanges(range, ranges, today);
  return { through: dataThrough(ranges), missing, missingDays: countDays(missing) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-03` → `3 Oct 2026`. */
export function formatCoverageDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** `[{3 Oct}, {10–12 Oct}]` → `3 Oct 2026, 10 Oct 2026 – 12 Oct 2026`. */
export function formatRanges(ranges: readonly DateRange[], max = 8): string {
  const parts = ranges.slice(0, max).map(range => (range.from === range.to
    ? formatCoverageDate(range.from)
    : `${formatCoverageDate(range.from)} – ${formatCoverageDate(range.to)}`));
  if (ranges.length > max) parts.push(`and ${ranges.length - max} more`);
  return parts.join(', ');
}

/** `YYYY-MM` months touched by the uploads' data ranges, newest first (for the history month filter). */
export function monthsFromUploads(uploads: readonly UploadRange[]): string[] {
  const months = new Set<string>();
  for (const upload of uploads) {
    if (!upload.data_from || !upload.data_to || upload.data_from > upload.data_to) continue;
    let [y, m] = upload.data_from.slice(0, 7).split('-').map(Number);
    const end = upload.data_to.slice(0, 7);
    for (let guard = 0; guard < 240; guard += 1) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      months.add(key);
      if (key >= end) break;
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  return [...months].sort().reverse();
}

export interface CoverageOverview { range: DateRange | null; onboarding: CoverageSummary; ftd: CoverageSummary }

/**
 * Coverage for a filter range (e.g. one month). Without a range, checks from the
 * first covered day of either kind up to today, so gaps between imports show.
 */
export function coverageOverview(coverage: DataCoverage, today: string, range?: DateRange | null): CoverageOverview {
  const firsts = [...coverage.onboarding, ...coverage.ftd].map(item => item.from).sort();
  const span = range ?? (firsts.length ? { from: firsts[0], to: today } : null);
  const summary = (ranges: DateRange[]): CoverageSummary => (span
    ? summarizeCoverage(span, ranges, today)
    : { through: dataThrough(ranges), missing: [], missingDays: 0 });
  return { range: span, onboarding: summary(coverage.onboarding), ftd: summary(coverage.ftd) };
}
