import { execute, executeTransaction, queryAll, queryOne } from '@/lib/database';
import type { CollectedTrends, FetchTrigger, KeywordTrendsStore } from './collector';
import type { KeywordTrendsConfig } from './config';
import type { HeatLevel, TrendDirection, TrendRow } from './metrics';

/** A running snapshot older than this is treated as crashed and marked failed. */
export const STALE_SNAPSHOT_MS = 60 * 60 * 1000;
/** Rows per INSERT; 34 columns x 400 stays far below PostgreSQL's 65,535 parameter cap. */
export const INSERT_BATCH_SIZE = 400;

/** Column order for INSERT and rowValues. */
export const ROW_COLUMNS = [
  'snapshot_id', 'keyword_text', 'search_month', 'keyword_word_count', 'keyword_character_count', 'is_seed_keyword', 'discovery_sources', 'concepts',
  'avg_monthly_searches', 'monthly_searches', 'previous_monthly_searches', 'mom_change_abs', 'mom_change_pct', 'trend_direction', 'trend_index_pct',
  'peak_monthly_searches', 'peak_share_pct', 'heat_rank', 'heat_percentile_pct', 'heat_level', 'result_set_total_avg_monthly_searches', 'avg_search_share_pct',
  'result_set_monthly_searches', 'monthly_search_share_pct', 'monthly_rank', 'monthly_heat_percentile_pct', 'competition', 'competition_index',
  'low_top_of_page_bid_micros', 'high_top_of_page_bid_micros', 'low_top_of_page_bid', 'high_top_of_page_bid', 'bid_midpoint', 'bid_range',
] as const;

export function rowValues(snapshotId: string, row: TrendRow): unknown[] {
  return [
    snapshotId, row.keyword, row.searchMonth, row.keywordWordCount, row.keywordCharacterCount, row.isSeedKeyword, row.discoverySources, row.concepts,
    row.avgMonthlySearches, row.monthlySearches, row.previousMonthlySearches, row.momChangeAbs, row.momChangePct, row.trendDirection, row.trendIndexPct,
    row.peakMonthlySearches, row.peakSharePct, row.heatRank, row.heatPercentilePct, row.heatLevel, row.resultSetTotalAvgMonthlySearches, row.avgSearchSharePct,
    row.resultSetMonthlySearches, row.monthlySearchSharePct, row.monthlyRank, row.monthlyHeatPercentilePct, row.competition, row.competitionIndex,
    row.lowTopOfPageBidMicros, row.highTopOfPageBidMicros, row.lowTopOfPageBid, row.highTopOfPageBid, row.bidMidpoint, row.bidRange,
  ];
}

export function buildInsertSql(rowCount: number): string {
  const tuple = `(${ROW_COLUMNS.map(() => '?').join(', ')})`;
  return `INSERT INTO keyword_trend_rows (${ROW_COLUMNS.join(', ')}) VALUES ${Array.from({ length: rowCount }, () => tuple).join(', ')}`;
}

async function releaseStale(): Promise<void> {
  await execute(
    `UPDATE keyword_trend_snapshots SET status = 'failed', error = 'Stopped: the fetch did not finish within 1 hour.', finished_at = CURRENT_TIMESTAMP
     WHERE status = 'running' AND started_at < ?`,
    [new Date(Date.now() - STALE_SNAPSHOT_MS)],
  );
}

export const postgresKeywordTrendsStore: KeywordTrendsStore = {
  async startSnapshot({ id, trigger, triggeredBy, reportDate, config }) {
    await releaseStale();
    try {
      await execute(
        `INSERT INTO keyword_trend_snapshots (id, status, trigger, triggered_by, report_date, config) VALUES (?, 'running', ?, ?, ?, ?::jsonb)`,
        [id, trigger, triggeredBy, reportDate, JSON.stringify(config)],
      );
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return false;
      throw error;
    }
  },
  async completeSnapshot(id, collected: CollectedTrends) {
    await executeTransaction(async transaction => {
      for (let index = 0; index < collected.rows.length; index += INSERT_BATCH_SIZE) {
        const batch = collected.rows.slice(index, index + INSERT_BATCH_SIZE);
        await transaction.execute(buildInsertSql(batch.length), batch.flatMap(row => rowValues(id, row)));
      }
      await transaction.execute(
        `UPDATE keyword_trend_snapshots SET status = 'succeeded', customer_id = ?, account_name = ?, currency_code = ?, ideas_count = ?, rows_count = ?,
           first_month = ?, last_month = ?, error = NULL, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [collected.account.customerId, collected.account.name, collected.account.currencyCode, collected.ideasCount, collected.rows.length,
          collected.firstMonth, collected.lastMonth, id],
      );
    });
  },
  async failSnapshot(id, error) {
    await execute(`UPDATE keyword_trend_snapshots SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`, [error, id]);
  },
};

export interface SnapshotInfo {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  trigger: FetchTrigger;
  triggeredBy: string | null;
  reportDate: string;
  customerId: string | null;
  accountName: string;
  currencyCode: string;
  config: Partial<KeywordTrendsConfig>;
  ideasCount: number;
  rowsCount: number;
  firstMonth: string | null;
  lastMonth: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface SnapshotRow {
  id: string; status: SnapshotInfo['status']; trigger: FetchTrigger; triggered_by_name: string | null; report_date: string; customer_id: string | null;
  account_name: string; currency_code: string; config: Partial<KeywordTrendsConfig> | null; ideas_count: number; rows_count: number;
  first_month: string | null; last_month: string | null; error: string | null; started_at: Date | string; finished_at: Date | string | null;
}

const iso = (value: Date | string | null) => (value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString());

function mapSnapshot(row: SnapshotRow): SnapshotInfo {
  return {
    id: row.id, status: row.status, trigger: row.trigger, triggeredBy: row.triggered_by_name, reportDate: row.report_date, customerId: row.customer_id,
    accountName: row.account_name, currencyCode: row.currency_code, config: row.config ?? {}, ideasCount: Number(row.ideas_count), rowsCount: Number(row.rows_count),
    firstMonth: row.first_month, lastMonth: row.last_month, error: row.error, startedAt: iso(row.started_at)!, finishedAt: iso(row.finished_at),
  };
}

const SNAPSHOT_SELECT = `SELECT s.id, s.status, s.trigger, u.name AS triggered_by_name, s.report_date::text AS report_date, s.customer_id, s.account_name, s.currency_code,
  s.config, s.ideas_count, s.rows_count, s.first_month::text AS first_month, s.last_month::text AS last_month, s.error, s.started_at, s.finished_at
  FROM keyword_trend_snapshots s LEFT JOIN users u ON u.id = s.triggered_by`;

export async function recentSnapshots(limit = 10): Promise<SnapshotInfo[]> {
  await releaseStale();
  return (await queryAll<SnapshotRow>(`${SNAPSHOT_SELECT} ORDER BY s.started_at DESC LIMIT ?`, [limit])).map(mapSnapshot);
}

export async function latestSucceededSnapshot(): Promise<SnapshotInfo | null> {
  const row = await queryOne<SnapshotRow>(`${SNAPSHOT_SELECT} WHERE s.status = 'succeeded' ORDER BY s.finished_at DESC LIMIT 1`);
  return row ? mapSnapshot(row) : null;
}

export async function getSnapshot(id: string): Promise<SnapshotInfo | null> {
  const row = await queryOne<SnapshotRow>(`${SNAPSHOT_SELECT} WHERE s.id = ?`, [id]);
  return row ? mapSnapshot(row) : null;
}

export async function runningSnapshot(): Promise<SnapshotInfo | null> {
  await releaseStale();
  const row = await queryOne<SnapshotRow>(`${SNAPSHOT_SELECT} WHERE s.status = 'running' LIMIT 1`);
  return row ? mapSnapshot(row) : null;
}

type DbTrendRow = Record<(typeof ROW_COLUMNS)[number], unknown>;
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function mapTrendRow(row: DbTrendRow): TrendRow {
  const searchMonth = String(row.search_month);
  return {
    keyword: String(row.keyword_text), searchMonth, searchYear: Number(searchMonth.slice(0, 4)), searchMonthNumber: Number(searchMonth.slice(5, 7)),
    searchQuarter: Math.floor((Number(searchMonth.slice(5, 7)) - 1) / 3) + 1,
    keywordWordCount: Number(row.keyword_word_count), keywordCharacterCount: Number(row.keyword_character_count), isSeedKeyword: row.is_seed_keyword === true,
    discoverySources: (row.discovery_sources as TrendRow['discoverySources']) ?? [], concepts: (row.concepts as string[]) ?? [],
    avgMonthlySearches: Number(row.avg_monthly_searches), monthlySearches: Number(row.monthly_searches), previousMonthlySearches: num(row.previous_monthly_searches),
    momChangeAbs: num(row.mom_change_abs), momChangePct: num(row.mom_change_pct), trendDirection: row.trend_direction as TrendDirection, trendIndexPct: num(row.trend_index_pct),
    peakMonthlySearches: Number(row.peak_monthly_searches), peakSharePct: num(row.peak_share_pct), heatRank: Number(row.heat_rank),
    heatPercentilePct: Number(row.heat_percentile_pct), heatLevel: row.heat_level as HeatLevel, resultSetTotalAvgMonthlySearches: Number(row.result_set_total_avg_monthly_searches),
    avgSearchSharePct: num(row.avg_search_share_pct), resultSetMonthlySearches: Number(row.result_set_monthly_searches), monthlySearchSharePct: num(row.monthly_search_share_pct),
    monthlyRank: Number(row.monthly_rank), monthlyHeatPercentilePct: Number(row.monthly_heat_percentile_pct), competition: row.competition === null ? null : String(row.competition),
    competitionIndex: num(row.competition_index), lowTopOfPageBidMicros: num(row.low_top_of_page_bid_micros), highTopOfPageBidMicros: num(row.high_top_of_page_bid_micros),
    lowTopOfPageBid: num(row.low_top_of_page_bid), highTopOfPageBid: num(row.high_top_of_page_bid), bidMidpoint: num(row.bid_midpoint), bidRange: num(row.bid_range),
  };
}

/** Every row of a snapshot, or only the given search months (YYYY-MM-01). */
export async function snapshotRows(snapshotId: string, months: string[] | null = null): Promise<TrendRow[]> {
  const columns = ROW_COLUMNS.map(column => (column === 'search_month' ? 'search_month::text AS search_month' : column)).join(', ');
  const rows = months
    ? await queryAll<DbTrendRow>(`SELECT ${columns} FROM keyword_trend_rows WHERE snapshot_id = ? AND search_month = ANY(?::date[]) ORDER BY search_month, lower(keyword_text)`, [snapshotId, months])
    : await queryAll<DbTrendRow>(`SELECT ${columns} FROM keyword_trend_rows WHERE snapshot_id = ? ORDER BY lower(keyword_text), search_month`, [snapshotId]);
  return rows.map(mapTrendRow);
}

export async function snapshotMonths(snapshotId: string): Promise<string[]> {
  const rows = await queryAll<{ month: string }>('SELECT DISTINCT search_month::text AS month FROM keyword_trend_rows WHERE snapshot_id = ? ORDER BY month', [snapshotId]);
  return rows.map(row => row.month);
}
