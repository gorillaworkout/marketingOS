import { queryAll, queryOne } from '@/lib/database';
import { BACKFILL_MONTHS } from './gsc-sync';
import type { OurKeyword } from './keyword-gap-bucket';

/**
 * Free-mode "our keywords".
 *
 * `npm run seo:sync` (scripts/seo-sync.ts) is the VPS cron. It writes Search
 * Analytics rows into seo_gsc_daily: query, page, clicks, impressions, ctr,
 * position. Those stored queries are the primary source. A Queries CSV/XLSX
 * upload is only the fallback when this table has no rows for the site.
 *
 * The cron calls syncableSiteIds(), which is active sites whose gsc_property
 * is set. Migration 035 seeds Dupoin (https://dupoin.co.id/, id
 * 00000000-0000-0000-0000-000000000102) with gsc_property NULL and active
 * FALSE, and it does not insert seo_gsc_daily rows. Per the schema, Dupoin
 * has no stored query/position data until an admin sets a property and a sync
 * runs. Live calls still use the existing service account (GSC_SA_KEY_PATH).
 * OAuth is not wired.
 */
export const STORED_GSC_QUERIES_SQL = `SELECT query,
  SUM(clicks)::bigint AS clicks,
  SUM(impressions)::bigint AS impressions,
  SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
FROM seo_gsc_daily
WHERE site_id = ? AND date >= (CURRENT_DATE - (? || ' months')::interval)
GROUP BY query
ORDER BY SUM(impressions) DESC
LIMIT 2000`;

export function gscKeywordSource(input: { gscProperty: string | null; active: boolean; storedRows: number }): 'stored' | 'upload' {
  return input.storedRows > 0 ? 'stored' : 'upload';
}

export async function countStoredGscRows(siteId: string): Promise<number> {
  const row = await queryOne<{ rows: string | number }>('SELECT COUNT(*)::bigint AS rows FROM seo_gsc_daily WHERE site_id = ?', [siteId]);
  return Number(row?.rows ?? 0);
}

export async function loadStoredGscQueries(siteId: string): Promise<OurKeyword[]> {
  const rows = await queryAll<{ query: string; clicks: string | number; impressions: string | number; position: string | number | null }>(
    STORED_GSC_QUERIES_SQL,
    [siteId, String(BACKFILL_MONTHS)],
  );
  return rows.map(row => {
    const clicks = Number(row.clicks) || 0;
    const impressions = Number(row.impressions) || 0;
    const position = row.position === null || row.position === undefined ? null : Number(row.position);
    return {
      query: row.query,
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : null,
      position: position !== null && Number.isFinite(position) ? position : null,
    };
  }).filter(row => row.query.trim());
}
