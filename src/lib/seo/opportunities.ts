import { queryAll } from '@/lib/database';
import type { DateRange } from './report';

/**
 * Opportunity bands use the impression-weighted average position, rounded the
 * way Search Console displays it: "11-20" means 10.5 <= position < 20.5.
 */
export const OPPORTUNITY_BANDS = {
  push: { min: 10.5, max: 20.5, label: 'Push', description: 'Average position 11-20 with impressions: page 2, close to page 1.' },
  're-optimize': { min: 20.5, max: 30.5, label: 'Re-optimize', description: 'Average position 21-30: the page needs a stronger rewrite.' },
} as const;
export type OpportunityBand = keyof typeof OPPORTUNITY_BANDS;

/** Matches a site root URL such as https://example.org or https://www.example.org/. Passed as a parameter (no ? in SQL text). */
export const HOMEPAGE_URL_PATTERN = '^https?://[^/?#]+/?$';
const HOMEPAGE = new RegExp(HOMEPAGE_URL_PATTERN, 'i');

export function bandForPosition(position: number | null): OpportunityBand | null {
  if (position == null || !Number.isFinite(position)) return null;
  for (const [band, bounds] of Object.entries(OPPORTUNITY_BANDS) as Array<[OpportunityBand, typeof OPPORTUNITY_BANDS[OpportunityBand]]>) {
    if (position >= bounds.min && position < bounds.max) return band;
  }
  return null;
}

export function isHomepageUrl(url: string | null | undefined): boolean {
  return Boolean(url && HOMEPAGE.test(url));
}

export interface QueryOpportunity {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  bestPage: string;
  homepage: boolean;
  band: OpportunityBand | null;
  tracked: boolean;
  targetPageUrl: string | null;
  queued: boolean;
}

export interface KeywordWithoutPage { id: string; keyword: string; intent: string | null; queued: boolean }

export interface OpportunityReport {
  push: QueryOpportunity[];
  reoptimize: QueryOpportunity[];
  homepage: QueryOpportunity[];
  untargetedKeywords: KeywordWithoutPage[];
}

type QueryRow = {
  query: string; clicks: string | number; impressions: string | number; position: string | number;
  best_page: string; tracked: boolean; target_page_url: string | null; queued: boolean;
};

/**
 * One row per query for the window: summed clicks and impressions, the
 * impression-weighted position, and the page that earned the most clicks
 * (then impressions). Only queries in a band, or whose best page is the
 * homepage, are returned.
 */
export const QUERY_OPPORTUNITIES_SQL = `WITH per_page AS (
  SELECT query, page, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
  FROM seo_gsc_daily WHERE site_id = ? AND date BETWEEN ? AND ?
  GROUP BY query, page
), per_query AS (
  SELECT query, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(weighted) / NULLIF(SUM(impressions), 0) AS position
  FROM per_page GROUP BY query
), best AS (
  SELECT DISTINCT ON (query) query, page FROM per_page ORDER BY query, clicks DESC, impressions DESC, page
)
SELECT q.query, q.clicks::BIGINT AS clicks, q.impressions::BIGINT AS impressions, q.position, b.page AS best_page,
  (k.id IS NOT NULL) AS tracked, k.target_page_url,
  EXISTS (SELECT 1 FROM seo_content_queue c WHERE c.site_id = ? AND c.keyword_normalized = q.query AND c.status = 'pending') AS queued
FROM per_query q
JOIN best b ON b.query = q.query
LEFT JOIN seo_keywords k ON k.site_id = ? AND k.keyword_normalized = q.query
WHERE q.impressions >= ?
  AND ((q.position >= ? AND q.position < ?) OR b.page ~* ?)
ORDER BY q.impressions DESC, q.query
LIMIT ?`;

/** Tracked keywords with no target page and no Search Console row at all in the window. */
export const UNTARGETED_KEYWORDS_SQL = `SELECT k.id, k.keyword, k.intent,
  EXISTS (SELECT 1 FROM seo_content_queue c WHERE c.site_id = k.site_id AND c.keyword_normalized = k.keyword_normalized AND c.status = 'pending') AS queued
FROM seo_keywords k
WHERE k.site_id = ? AND k.target_page_url IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM seo_gsc_daily g
    WHERE g.site_id = k.site_id AND g.query = k.keyword_normalized AND g.date BETWEEN ? AND ?
  )
ORDER BY k.keyword_normalized
LIMIT ?`;

export function toOpportunity(row: QueryRow): QueryOpportunity {
  const clicks = Number(row.clicks);
  const impressions = Number(row.impressions);
  const position = Number(row.position);
  return {
    query: row.query, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position,
    bestPage: row.best_page, homepage: isHomepageUrl(row.best_page), band: bandForPosition(position),
    tracked: Boolean(row.tracked), targetPageUrl: row.target_page_url, queued: Boolean(row.queued),
  };
}

export function groupOpportunities(rows: QueryOpportunity[], untargetedKeywords: KeywordWithoutPage[]): OpportunityReport {
  return {
    push: rows.filter(row => row.band === 'push'),
    reoptimize: rows.filter(row => row.band === 're-optimize'),
    homepage: rows.filter(row => row.homepage),
    untargetedKeywords,
  };
}

export async function getOpportunities(siteId: string, range: DateRange, options: { minImpressions?: number; limit?: number } = {}): Promise<OpportunityReport> {
  const minImpressions = Math.max(1, Math.floor(options.minImpressions ?? 1));
  const limit = Math.min(2000, Math.max(1, Math.floor(options.limit ?? 1000)));
  const [rows, keywords] = await Promise.all([
    queryAll<QueryRow>(QUERY_OPPORTUNITIES_SQL, [
      siteId, range.start, range.end, siteId, siteId, minImpressions,
      OPPORTUNITY_BANDS.push.min, OPPORTUNITY_BANDS['re-optimize'].max, HOMEPAGE_URL_PATTERN, limit,
    ]),
    queryAll<KeywordWithoutPage & { queued: boolean }>(UNTARGETED_KEYWORDS_SQL, [siteId, range.start, range.end, limit]),
  ]);
  return groupOpportunities(rows.map(toOpportunity), keywords.map(row => ({ id: row.id, keyword: row.keyword, intent: row.intent, queued: Boolean(row.queued) })));
}
