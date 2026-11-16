/**
 * Search Console rows for a date range, daily and rolled-up monthly combined.
 *
 * `npm run seo:gsc-retention -- --apply` keeps query+page and page rows daily
 * only from a month-aligned cutoff on. Older months live in seo_gsc_monthly /
 * seo_gsc_page_monthly, one summed row per month, with their covered dates in
 * seo_gsc_rollup_months. Site totals (seo_gsc_site_daily) always stay daily.
 *
 * gscRowsSql() returns a subquery with the same columns for both grains:
 *   [query,] [page,] clicks, impressions, weighted (= position * impressions),
 *   bucket (date), grain ('day' | 'month'), span_days
 * A monthly row is scaled by overlap / covered days when the range only covers
 * part of that month (e.g. a 6-month preset starting mid-month), so totals stay
 * proportional instead of counting a whole month. Within a fully covered month
 * the factor is 1 and sums are exact. CTR and impression-weighted position are
 * recomputed from the summed columns by the caller, so scaling cancels out.
 *
 * A rolled-up month has no daily rows left (the retention script deletes them
 * and the sync skips those months), so the two halves never double count.
 */
import type { DateRange } from './report';

export type GscSourceKind = 'site' | 'page' | 'query';

export interface GscSourceSql { sql: string; values: unknown[] }

const TABLES: Record<GscSourceKind, { daily: string; monthly: string | null; keys: string[] }> = {
  site: { daily: 'seo_gsc_site_daily', monthly: null, keys: [] },
  page: { daily: 'seo_gsc_page_daily', monthly: 'seo_gsc_page_monthly', keys: ['page'] },
  query: { daily: 'seo_gsc_daily', monthly: 'seo_gsc_monthly', keys: ['query', 'page'] },
};

export function sourceKindForTable(table: string): GscSourceKind {
  const kind = (Object.keys(TABLES) as GscSourceKind[]).find(key => TABLES[key].daily === table);
  if (!kind) throw new Error(`Unknown Search Console table: ${table}`);
  return kind;
}

export function gscRowsSql(kind: GscSourceKind, siteId: string, range: DateRange): GscSourceSql {
  const { daily, monthly, keys } = TABLES[kind];
  const dailyKeys = keys.map(key => `${key}, `).join('');
  const dailySql = `SELECT ${dailyKeys}clicks::DOUBLE PRECISION AS clicks, impressions::DOUBLE PRECISION AS impressions,
    position * impressions AS weighted, date AS bucket, 'day'::TEXT AS grain, 1 AS span_days
  FROM ${daily} WHERE site_id = ? AND date BETWEEN ?::DATE AND ?::DATE`;
  const dailyValues = [siteId, range.start, range.end];
  if (!monthly) return { sql: dailySql, values: dailyValues };

  const monthlyKeys = keys.map(key => `m.${key}, `).join('');
  const overlap = `(LEAST(last_date, ?::DATE) - GREATEST(first_date, ?::DATE) + 1)`;
  const monthlySql = `SELECT ${monthlyKeys}m.clicks * r.factor AS clicks, m.impressions * r.factor AS impressions,
    m.position * m.impressions * r.factor AS weighted, r.bucket, 'month'::TEXT AS grain, r.span_days
  FROM ${monthly} m
  JOIN (
    SELECT month, GREATEST(first_date, ?::DATE) AS bucket, ${overlap} AS span_days,
      ${overlap}::DOUBLE PRECISION / (last_date - first_date + 1) AS factor
    FROM seo_gsc_rollup_months
    WHERE site_id = ? AND first_date <= ?::DATE AND last_date >= ?::DATE
  ) r ON r.month = m.month
  WHERE m.site_id = ?`;
  const monthlyValues = [range.start, range.end, range.start, range.end, range.start, siteId, range.end, range.start, siteId];
  return { sql: `${dailySql}\n  UNION ALL\n  ${monthlySql}`, values: [...dailyValues, ...monthlyValues] };
}

/** Share of a rolled-up month [firstDate, lastDate] that falls inside range (0..1). Mirrors the SQL above. */
export function prorateFactor(month: { firstDate: string; lastDate: string }, range: DateRange): number {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  const start = Math.max(day(month.firstDate), day(range.start));
  const end = Math.min(day(month.lastDate), day(range.end));
  if (end < start) return 0;
  return (end - start + 1) / (day(month.lastDate) - day(month.firstDate) + 1);
}
