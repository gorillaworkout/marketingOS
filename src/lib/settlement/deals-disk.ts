/** Historical snapshot of free space on the shared VPS root. Not a budget and not measured in this environment. */
export const HISTORICAL_ROOT_FREE_BYTES = 10 * 1024 * 1024 * 1024;

/**
 * Run after migration 047, on a copy of the 5-day file, before choosing any retention.
 * Read-only. Deploy checks free disk again; this cloud run does not.
 */
export const DISK_MEASURE_SQL = `SELECT c.relname, pg_total_relation_size(c.oid) AS bytes
FROM pg_class c
WHERE c.relname IN ('settlement_mt5_deal_facts', 'settlement_dh_staging', 'settlement_dh_daily')`;

export function projectFactDisk(deals: number, bytesPerDeal: number): { bytes: number; exceedsHistoricalSnapshot: boolean; historicalFreeBytes: number } {
  const bytes = deals * bytesPerDeal;
  return { bytes, exceedsHistoricalSnapshot: bytes > HISTORICAL_ROOT_FREE_BYTES, historicalFreeBytes: HISTORICAL_ROOT_FREE_BYTES };
}
