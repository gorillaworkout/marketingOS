import { execute, executeTransaction, queryAll, queryOne, type DatabaseTransaction } from '@/lib/database';
import type { CampaignDailyRow, AdGroupDailyRow, KeywordDailyRow, SearchTermDailyRow, Metrics, RangeSnapshot } from './gaql';
import type { AccountRunDetail, DiscoveredAccount, GoogleAdsSyncStore, RowCounts, StoredAccountState } from './sync';

/** Rows per INSERT; far below PostgreSQL's 65,535 parameter cap (13 columns x 500). */
export const UPSERT_BATCH_SIZE = 500;

export type DailyTable = 'google_ads_campaign_daily' | 'google_ads_ad_group_daily' | 'google_ads_keyword_daily' | 'google_ads_search_term_daily';

export interface TableSpec<T> {
  table: DailyTable;
  keyColumns: string[];
  attributeColumns: string[];
  values: (row: T) => unknown[];
}

const METRIC_COLUMNS = ['impressions', 'clicks', 'cost_micros', 'conversions', 'conversions_value', 'synced_at'] as const;

/** Multi-row INSERT ... ON CONFLICT DO UPDATE with `?` placeholders. Columns: customer_id, keys, attributes, metrics. */
export function buildUpsertSql(spec: Pick<TableSpec<unknown>, 'table' | 'keyColumns' | 'attributeColumns'>, rowCount: number): string {
  const columns = ['customer_id', ...spec.keyColumns, ...spec.attributeColumns, ...METRIC_COLUMNS];
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  const values = Array.from({ length: rowCount }, () => tuple).join(', ');
  const updates = [...spec.attributeColumns, ...METRIC_COLUMNS].map(column => `${column} = EXCLUDED.${column}`).join(', ');
  return `INSERT INTO ${spec.table} (${columns.join(', ')}) VALUES ${values} ON CONFLICT (customer_id, ${spec.keyColumns.join(', ')}) DO UPDATE SET ${updates}`;
}

export const CAMPAIGN_SPEC: TableSpec<CampaignDailyRow> = {
  table: 'google_ads_campaign_daily', keyColumns: ['date', 'campaign_id'], attributeColumns: ['campaign_name', 'campaign_status', 'channel_type'],
  values: row => [row.date, row.campaignId, row.campaignName, row.campaignStatus, row.channelType],
};
export const AD_GROUP_SPEC: TableSpec<AdGroupDailyRow> = {
  table: 'google_ads_ad_group_daily', keyColumns: ['date', 'ad_group_id'], attributeColumns: ['campaign_id', 'ad_group_name', 'ad_group_status'],
  values: row => [row.date, row.adGroupId, row.campaignId, row.adGroupName, row.adGroupStatus],
};
export const KEYWORD_SPEC: TableSpec<KeywordDailyRow> = {
  table: 'google_ads_keyword_daily', keyColumns: ['date', 'ad_group_id', 'criterion_id'], attributeColumns: ['campaign_id', 'keyword_text', 'match_type', 'criterion_status'],
  values: row => [row.date, row.adGroupId, row.criterionId, row.campaignId, row.keywordText, row.matchType, row.criterionStatus],
};
export const SEARCH_TERM_SPEC: TableSpec<SearchTermDailyRow> = {
  table: 'google_ads_search_term_daily', keyColumns: ['date', 'ad_group_id', 'search_term', 'match_type'], attributeColumns: ['campaign_id', 'term_status'],
  values: row => [row.date, row.adGroupId, row.searchTerm, row.matchType, row.campaignId, row.termStatus],
};

export function chunk<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

/** Flat parameter list for one batch, in buildUpsertSql column order. */
export function upsertValues<T extends Metrics>(spec: TableSpec<T>, customerId: string, rows: T[], syncedAt: Date): unknown[] {
  return rows.flatMap(row => [customerId, ...spec.values(row), row.impressions, row.clicks, row.costMicros, row.conversions, row.conversionsValue, syncedAt]);
}

async function upsertTable<T extends Metrics>(transaction: DatabaseTransaction, spec: TableSpec<T>, customerId: string, rows: T[], syncedAt: Date): Promise<number> {
  let count = 0;
  for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
    count += await transaction.execute(buildUpsertSql(spec, batch.length), upsertValues(spec, customerId, batch, syncedAt));
  }
  return count;
}

/**
 * Replaces one account's [start, end] range atomically: upsert every row,
 * then delete rows in that range that this sync did not return.
 */
export async function replaceRangeInTransaction(transaction: DatabaseTransaction, customerId: string, start: string, end: string, snapshot: RangeSnapshot, syncedAt: Date): Promise<RowCounts> {
  const counts: RowCounts = {
    campaigns: await upsertTable(transaction, CAMPAIGN_SPEC, customerId, snapshot.campaigns, syncedAt),
    adGroups: await upsertTable(transaction, AD_GROUP_SPEC, customerId, snapshot.adGroups, syncedAt),
    keywords: await upsertTable(transaction, KEYWORD_SPEC, customerId, snapshot.keywords, syncedAt),
    searchTerms: await upsertTable(transaction, SEARCH_TERM_SPEC, customerId, snapshot.searchTerms, syncedAt),
  };
  for (const spec of [CAMPAIGN_SPEC, AD_GROUP_SPEC, KEYWORD_SPEC, SEARCH_TERM_SPEC]) {
    await transaction.execute(`DELETE FROM ${spec.table} WHERE customer_id = ? AND date BETWEEN ? AND ? AND synced_at < ?`, [customerId, start, end, syncedAt]);
  }
  return counts;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export const postgresGoogleAdsSyncStore: GoogleAdsSyncStore = {
  async startRun(run) {
    try {
      await execute(
        `INSERT INTO google_ads_sync_runs (id, mode, status, trigger, range_start, range_end, triggered_by) VALUES (?, ?, 'running', ?, ?, ?, ?)`,
        [run.id, run.mode, run.trigger, run.rangeStart, run.rangeEnd, run.triggeredBy],
      );
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  },
  async releaseStaleRuns(olderThan) {
    await execute(
      `UPDATE google_ads_sync_runs SET status = 'failed', error = 'Marked failed: run did not finish (stale lock released).', finished_at = CURRENT_TIMESTAMP
       WHERE status = 'running' AND started_at < ?`,
      [olderThan],
    );
  },
  async upsertAccounts(accounts: DiscoveredAccount[], checkedAt: Date) {
    for (const account of accounts) {
      await execute(
        `INSERT INTO google_ads_accounts (customer_id, descriptive_name, currency_code, time_zone, status, test_account, source, last_error, last_checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (customer_id) DO UPDATE SET
           descriptive_name = CASE WHEN EXCLUDED.descriptive_name = '' THEN google_ads_accounts.descriptive_name ELSE EXCLUDED.descriptive_name END,
           currency_code = CASE WHEN EXCLUDED.currency_code = '' THEN google_ads_accounts.currency_code ELSE EXCLUDED.currency_code END,
           time_zone = CASE WHEN EXCLUDED.time_zone = '' THEN google_ads_accounts.time_zone ELSE EXCLUDED.time_zone END,
           status = CASE WHEN EXCLUDED.status = '' THEN google_ads_accounts.status ELSE EXCLUDED.status END,
           test_account = EXCLUDED.test_account, source = EXCLUDED.source, last_error = EXCLUDED.last_error,
           last_checked_at = EXCLUDED.last_checked_at, updated_at = CURRENT_TIMESTAMP`,
        [account.customerId, account.descriptiveName, account.currencyCode, account.timeZone, account.status, account.testAccount, account.source, account.error ?? account.skipReason ?? null, checkedAt],
      );
    }
  },
  async accountStates(): Promise<StoredAccountState[]> {
    const rows = await queryAll<{ customer_id: string; first_synced_date: string | null; active: boolean }>(
      `SELECT customer_id, to_char(first_synced_date, 'YYYY-MM-DD') AS first_synced_date, active FROM google_ads_accounts`, [],
    );
    return rows.map(row => ({ customerId: row.customer_id, firstSyncedDate: row.first_synced_date, active: row.active }));
  },
  async replaceRange(customerId, start, end, snapshot, syncedAt) {
    return executeTransaction(transaction => replaceRangeInTransaction(transaction, customerId, start, end, snapshot, syncedAt));
  },
  async markAccountSynced(customerId, result) {
    if (result.error) {
      await execute('UPDATE google_ads_accounts SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ?', [result.error, customerId]);
      return;
    }
    await execute(
      `UPDATE google_ads_accounts SET last_error = NULL, last_synced_at = ?, first_synced_date = COALESCE(LEAST(first_synced_date, ?::DATE), ?::DATE), updated_at = CURRENT_TIMESTAMP WHERE customer_id = ?`,
      [result.at, result.firstSyncedDate, result.firstSyncedDate, customerId],
    );
  },
  async finishRun(runId, result: { status: string; accountsSynced: number; accountsFailed: number; rowsUpserted: number; details: AccountRunDetail[]; error: string | null }) {
    await execute(
      `UPDATE google_ads_sync_runs SET status = ?, accounts_synced = ?, accounts_failed = ?, rows_upserted = ?, details = ?::jsonb, error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [result.status, result.accountsSynced, result.accountsFailed, result.rowsUpserted, JSON.stringify(result.details), result.error, runId],
    );
  },
};

export async function runningSync(): Promise<{ id: string; started_at: string } | undefined> {
  return queryOne<{ id: string; started_at: string }>(`SELECT id, started_at FROM google_ads_sync_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`, []);
}
