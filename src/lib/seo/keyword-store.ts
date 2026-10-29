import { v4 as uuidv4 } from 'uuid';
import { executeTransaction, queryAll, queryOne } from '@/lib/database';
import { chunk } from './gsc-store';
import type { KeywordInput } from './keywords';

export interface StoredKeyword {
  id: string;
  keyword: string;
  target_page_url: string | null;
  intent: string | null;
  created_at: string;
  updated_at: string;
}

const BATCH = 500;

/**
 * Insert-or-update by (site, normalized keyword). An empty target URL or
 * intent in the file keeps the stored value, so a keyword-only re-import does
 * not wipe earlier work.
 */
export function buildKeywordUpsertSql(count: number): string {
  const tuples = Array.from({ length: count }, () => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
  return `INSERT INTO seo_keywords (id, site_id, keyword, keyword_normalized, target_page_url, intent, created_by)
VALUES ${tuples}
ON CONFLICT (site_id, keyword_normalized) DO UPDATE SET
  keyword = EXCLUDED.keyword,
  target_page_url = COALESCE(EXCLUDED.target_page_url, seo_keywords.target_page_url),
  intent = COALESCE(EXCLUDED.intent, seo_keywords.intent),
  updated_at = CURRENT_TIMESTAMP`;
}

export async function upsertKeywords(siteId: string, rows: KeywordInput[], userId: string | null, newId: () => string = uuidv4): Promise<{ inserted: number; updated: number }> {
  if (!rows.length) return { inserted: 0, updated: 0 };
  // Counted up front for the import summary; the upsert itself is atomic.
  const existing = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM seo_keywords WHERE site_id = ? AND keyword_normalized = ANY(?::text[])',
    [siteId, rows.map(row => row.normalized)],
  );
  await executeTransaction(async transaction => {
    for (const batch of chunk(rows, BATCH)) {
      await transaction.execute(buildKeywordUpsertSql(batch.length), batch.flatMap(row => [newId(), siteId, row.keyword, row.normalized, row.targetPageUrl, row.intent, userId]));
    }
  });
  const updated = Math.min(rows.length, Number(existing?.count ?? 0));
  return { inserted: rows.length - updated, updated };
}

export async function listKeywords(siteId: string): Promise<StoredKeyword[]> {
  return queryAll<StoredKeyword & Record<string, unknown>>(
    `SELECT id, keyword, target_page_url, intent, created_at, updated_at FROM seo_keywords WHERE site_id = ? ORDER BY keyword_normalized`,
    [siteId],
  );
}
