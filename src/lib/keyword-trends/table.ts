/** Client-safe filter and sort for the Keyword Trends table (pure). */
import type { KeywordSummary, TrendDirection } from './metrics';

export type SortKey = 'keyword' | 'avgMonthlySearches' | 'lastMonthSearches' | 'momChangeAbs' | 'momChangePct' | 'trendDirection' | 'competition' | 'lowTopOfPageBid' | 'highTopOfPageBid';

export interface KeywordFilters { text: string; trend: TrendDirection | 'all'; competition: string; minVolume: number | null }

const COMPETITION_ORDER: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const TREND_ORDER: Record<string, number> = { FALLING: 1, STABLE: 2, RISING: 3, NEW: 4 };

function sortValue(row: KeywordSummary, key: SortKey): number | string | null {
  if (key === 'keyword') return row.keyword.toLocaleLowerCase();
  if (key === 'competition') return row.competition ? COMPETITION_ORDER[row.competition] ?? 0 : null;
  if (key === 'trendDirection') return row.trendDirection ? TREND_ORDER[row.trendDirection] : null;
  return row[key];
}

/** Filters, then sorts. Empty values (null) always go last, whichever the direction. */
export function filterAndSortKeywords(rows: KeywordSummary[], filters: KeywordFilters, sort: { key: SortKey; desc: boolean }): KeywordSummary[] {
  const needle = filters.text.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => (!needle || row.keyword.toLocaleLowerCase().includes(needle))
    && (filters.trend === 'all' || row.trendDirection === filters.trend)
    && (!filters.competition || filters.competition === 'all' || (row.competition ?? 'UNSPECIFIED') === filters.competition)
    && (filters.minVolume === null || row.avgMonthlySearches >= filters.minVolume));
  return [...filtered].sort((left, right) => {
    const a = sortValue(left, sort.key);
    const b = sortValue(right, sort.key);
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return (sort.desc ? -order : order) || left.keyword.localeCompare(right.keyword);
  });
}
