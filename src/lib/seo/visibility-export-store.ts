import { queryAll } from '@/lib/database';
import type { GapCheckInput } from './visibility-gaps';

/** Read-only queries for the AI Visibility export and gap report. */

const LIFETIME_LIMIT = 50_000;

/** All stored checks for the site (no response text), newest first. */
export async function listLifetimeChecks(siteId: string): Promise<GapCheckInput[]> {
  const rows = await queryAll<GapCheckInput & Record<string, unknown>>(
    `SELECT c.id, c.prompt_id, c.model, c.answered_model, c.mentioned, c.rank_in_answer, c.cited_urls, c.site_cited,
       c.competitors_mentioned, c.error, c.created_at
     FROM seo_ai_checks c WHERE c.site_id = ? AND c.prompt_id IS NOT NULL
     ORDER BY c.created_at DESC LIMIT ${LIFETIME_LIMIT}`,
    [siteId],
  );
  return rows.map(normalize);
}

/** Latest check per prompt x model, with the full stored answer. */
export async function listLatestChecks(siteId: string): Promise<GapCheckInput[]> {
  const rows = await queryAll<GapCheckInput & Record<string, unknown>>(
    `SELECT DISTINCT ON (c.prompt_id, c.model) c.id, c.prompt_id, c.model, c.answered_model, c.response, c.mentioned, c.rank_in_answer,
       c.cited_urls, c.site_cited, c.competitors_mentioned, c.error, c.created_at
     FROM seo_ai_checks c WHERE c.site_id = ? AND c.prompt_id IS NOT NULL
     ORDER BY c.prompt_id, c.model, c.created_at DESC`,
    [siteId],
  );
  return rows.map(normalize);
}

function normalize(row: GapCheckInput): GapCheckInput {
  return {
    ...row,
    rank_in_answer: row.rank_in_answer === null || row.rank_in_answer === undefined ? null : Number(row.rank_in_answer),
    cited_urls: row.cited_urls ?? [],
    competitors_mentioned: row.competitors_mentioned ?? [],
  };
}
