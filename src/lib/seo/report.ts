import { queryAll, queryOne } from '@/lib/database';
import { addDays } from './gsc-sync';
import { gscRowsSql, sourceKindForTable } from './gsc-source';

export const RANGE_PRESETS = { '7d': 7, '28d': 28, '90d': 90, '6m': 182, '12m': 365, '16m': 486 } as const;
export type RangePreset = keyof typeof RANGE_PRESETS;
export const DEFAULT_RANGE: RangePreset = '28d';

export interface DateRange { start: string; end: string }
export interface ReportRange { current: DateRange; previous: DateRange; days: number }
export interface ReportFilters { query?: string; page?: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayCount(range: DateRange): number {
  return Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Resolves the requested window and the equally long window right before it.
 * `anchor` is the last day with data (or yesterday) so presets are not shifted
 * by Search Console's 2-3 day lag.
 */
export function resolveReportRange(params: { range?: string | null; start?: string | null; end?: string | null }, anchor: string): ReportRange {
  let current: DateRange;
  if (params.start && params.end && ISO_DATE.test(params.start) && ISO_DATE.test(params.end) && params.start <= params.end) {
    current = { start: params.start, end: params.end };
  } else {
    const preset = (params.range && params.range in RANGE_PRESETS ? params.range : DEFAULT_RANGE) as RangePreset;
    current = { start: addDays(anchor, -(RANGE_PRESETS[preset] - 1)), end: anchor };
  }
  const days = dayCount(current);
  const previousEnd = addDays(current.start, -1);
  return { current, previous: { start: addDays(previousEnd, -(days - 1)), end: previousEnd }, days };
}

export function cleanFilter(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim().slice(0, 200);
  return trimmed || undefined;
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`;
}

/**
 * Picks the narrowest table that can answer the filters. Site totals include
 * anonymized queries, so they are used whenever no query filter is set.
 */
export function reportSource(filters: ReportFilters): { table: string; where: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let table = 'seo_gsc_site_daily';
  if (filters.query) {
    table = 'seo_gsc_daily';
    clauses.push(`query ILIKE ? ESCAPE '\\'`);
    values.push(likePattern(filters.query));
  } else if (filters.page) {
    table = 'seo_gsc_page_daily';
  }
  if (filters.page) {
    clauses.push(`page ILIKE ? ESCAPE '\\'`);
    values.push(likePattern(filters.page));
  }
  return { table, where: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', values };
}

export interface Totals { clicks: number; impressions: number; ctr: number; position: number | null }

/**
 * Sums over gscRowsSql() columns: clicks and impressions are rounded (a
 * prorated month can be fractional), CTR comes from the sums and position is
 * impression-weighted.
 */
const AGGREGATE = `ROUND(COALESCE(SUM(clicks), 0))::BIGINT AS clicks, ROUND(COALESCE(SUM(impressions), 0))::BIGINT AS impressions,
  SUM(weighted) / NULLIF(SUM(impressions), 0) AS position`;

function toTotals(row: { clicks: string | number; impressions: string | number; position: string | number | null } | undefined): Totals {
  const clicks = Number(row?.clicks ?? 0);
  const impressions = Number(row?.impressions ?? 0);
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0, position: row?.position == null ? null : Number(row.position) };
}

type AggregateRow = { clicks: string; impressions: string; position: string | null };

/** Daily rows plus rolled-up monthly rows for the range, with the filter clauses applied outside. */
function rangeRows(siteId: string, range: DateRange, source: { table: string; where: string; values: unknown[] }) {
  const rows = gscRowsSql(sourceKindForTable(source.table), siteId, range);
  return { from: `(${rows.sql}) s WHERE TRUE${source.where}`, values: [...rows.values, ...source.values] };
}

export async function getTotals(siteId: string, range: DateRange, filters: ReportFilters): Promise<Totals> {
  const rows = rangeRows(siteId, range, reportSource(filters));
  const row = await queryOne<AggregateRow>(`SELECT ${AGGREGATE} FROM ${rows.from}`, rows.values);
  return toTotals(row);
}

export type TrendPoint = Totals & {
  date: string;
  /** 'month' points come from rolled-up months: values are daily averages over `days` days, starting at `date`. */
  granularity: 'day' | 'month';
  days: number;
};

/**
 * One point per day. Rolled-up months (query or page filter on ranges older
 * than the retention cutoff) give one point per month whose clicks and
 * impressions are the month's daily average, so the line keeps a daily scale
 * instead of spiking on the 1st. CTR and position are the month's values.
 */
export async function getTrend(siteId: string, range: DateRange, filters: ReportFilters): Promise<TrendPoint[]> {
  const rows = rangeRows(siteId, range, reportSource(filters));
  const result = await queryAll<{ date: string; grain: 'day' | 'month'; days: number | string; clicks: string; impressions: string; position: string | null }>(
    `SELECT to_char(bucket, 'YYYY-MM-DD') AS date, grain, MAX(span_days) AS days,
       COALESCE(SUM(clicks), 0) / MAX(span_days) AS clicks, COALESCE(SUM(impressions), 0) / MAX(span_days) AS impressions,
       SUM(weighted) / NULLIF(SUM(impressions), 0) AS position
     FROM ${rows.from} GROUP BY bucket, grain ORDER BY bucket, grain`,
    rows.values,
  );
  return result.map(row => ({ date: row.date, ...toTotals(row), granularity: row.grain, days: Number(row.days) }));
}

/** Top queries always come from query+page rows; top pages use page rows unless a query filter is set. */
export function topRowsSource(dimension: 'query' | 'page', filters: ReportFilters): { table: string; where: string; values: unknown[] } {
  const source = reportSource(filters);
  const table = dimension === 'query' || filters.query ? 'seo_gsc_daily' : 'seo_gsc_page_daily';
  return { ...source, table };
}

export async function getTopRows(siteId: string, range: DateRange, filters: ReportFilters, dimension: 'query' | 'page', limit = 50): Promise<Array<Totals & { key: string }>> {
  const rows = rangeRows(siteId, range, topRowsSource(dimension, filters));
  const result = await queryAll<AggregateRow & { key: string }>(
    `SELECT ${dimension} AS key, ${AGGREGATE} FROM ${rows.from} GROUP BY ${dimension}
     ORDER BY SUM(clicks) DESC, SUM(impressions) DESC, ${dimension} LIMIT ?`,
    [...rows.values, limit],
  );
  return result.map(row => ({ key: row.key, ...toTotals(row) }));
}

export async function getDataBounds(siteId: string): Promise<{ first: string | null; last: string | null }> {
  const row = await queryOne<{ first: string | null; last: string | null }>(
    `SELECT to_char(MIN(date), 'YYYY-MM-DD') AS first, to_char(MAX(date), 'YYYY-MM-DD') AS last FROM seo_gsc_site_daily WHERE site_id = ?`,
    [siteId],
  );
  return { first: row?.first ?? null, last: row?.last ?? null };
}
