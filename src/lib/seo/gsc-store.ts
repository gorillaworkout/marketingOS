import { execute, executeTransaction, queryOne, type DatabaseTransaction } from '@/lib/database';
import type { DaySnapshot, SeoSiteRecord, SeoSyncStore } from './gsc-sync';

/** Rows per INSERT; keeps every statement far below PostgreSQL's 65,535 parameter cap. */
export const UPSERT_BATCH_SIZE = 500;

export interface UpsertSpec {
  table: 'seo_gsc_site_daily' | 'seo_gsc_page_daily' | 'seo_gsc_daily';
  keyColumns: string[];
}

const METRIC_COLUMNS = ['clicks', 'impressions', 'ctr', 'position', 'synced_at'] as const;

/** Multi-row INSERT ... ON CONFLICT DO UPDATE with `?` placeholders. */
export function buildUpsertSql(spec: UpsertSpec, rowCount: number): string {
  const columns = [...spec.keyColumns, ...METRIC_COLUMNS];
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  const values = Array.from({ length: rowCount }, () => tuple).join(', ');
  const updates = METRIC_COLUMNS.map(column => `${column} = EXCLUDED.${column}`).join(', ');
  return `INSERT INTO ${spec.table} (${columns.join(', ')}) VALUES ${values} ON CONFLICT (${spec.keyColumns.join(', ')}) DO UPDATE SET ${updates}`;
}

export function chunk<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

async function upsertRows<T extends { clicks: number; impressions: number; ctr: number; position: number }>(
  transaction: DatabaseTransaction,
  spec: UpsertSpec,
  rows: T[],
  keyValues: (row: T) => unknown[],
  syncedAt: Date,
): Promise<number> {
  let count = 0;
  for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
    const values = batch.flatMap(row => [...keyValues(row), row.clicks, row.impressions, row.ctr, row.position, syncedAt]);
    count += await transaction.execute(buildUpsertSql(spec, batch.length), values);
  }
  return count;
}

/**
 * Upserts one day atomically, then removes that day's rows that this sync did
 * not return (synced_at older than this run).
 */
export async function replaceDayInTransaction(transaction: DatabaseTransaction, siteId: string, date: string, snapshot: DaySnapshot, syncedAt: Date): Promise<number> {
  let rows = 0;
  rows += await upsertRows(transaction, { table: 'seo_gsc_site_daily', keyColumns: ['site_id', 'date'] }, snapshot.site, () => [siteId, date], syncedAt);
  rows += await upsertRows(transaction, { table: 'seo_gsc_page_daily', keyColumns: ['site_id', 'date', 'page'] }, snapshot.pages, row => [siteId, date, row.page], syncedAt);
  rows += await upsertRows(transaction, { table: 'seo_gsc_daily', keyColumns: ['site_id', 'date', 'query', 'page'] }, snapshot.queryPages, row => [siteId, date, row.query, row.page], syncedAt);
  for (const table of ['seo_gsc_site_daily', 'seo_gsc_page_daily', 'seo_gsc_daily']) {
    await transaction.execute(`DELETE FROM ${table} WHERE site_id = ? AND date = ? AND synced_at < ?`, [siteId, date, syncedAt]);
  }
  return rows;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export const postgresSeoSyncStore: SeoSyncStore = {
  async getSite(siteId) {
    return queryOne<SeoSiteRecord & Record<string, unknown>>('SELECT id, name, site_url, gsc_property, active FROM seo_sites WHERE id = ?', [siteId]);
  },
  async startRun(run) {
    try {
      await execute(
        `INSERT INTO seo_sync_runs (id, site_id, mode, status, range_start, range_end, triggered_by) VALUES (?, ?, ?, 'running', ?, ?, ?)`,
        [run.id, run.siteId, run.mode, run.rangeStart, run.rangeEnd, run.triggeredBy],
      );
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  },
  async releaseStaleRuns(siteId, olderThan) {
    await execute(
      `UPDATE seo_sync_runs SET status = 'failed', error = 'Marked failed: run did not finish (stale lock released).', finished_at = CURRENT_TIMESTAMP
       WHERE site_id = ? AND status = 'running' AND started_at < ?`,
      [siteId, olderThan],
    );
  },
  async replaceDay(siteId, date, snapshot, syncedAt) {
    return executeTransaction(transaction => replaceDayInTransaction(transaction, siteId, date, snapshot, syncedAt));
  },
  async finishRun(runId, result) {
    await execute(
      'UPDATE seo_sync_runs SET status = ?, days_synced = ?, rows_upserted = ?, error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?',
      [result.status, result.daysSynced, result.rowsUpserted, result.error, runId],
    );
  },
  async markSiteSynced(siteId, at) {
    await execute('UPDATE seo_sites SET last_synced_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [at, siteId]);
  },
};
