/**
 * Keyword Trends: fixed Keyword Planner configuration (approved 2026-11-24).
 * Not editable in the UI. Port of Bayu's standalone tool (collector.py).
 */
import type { GenerateKeywordIdeasRequest } from '@/lib/google-ads/client';

export const KEYWORD_TRENDS_CONFIG = {
  seedKeywords: ['forex'] as readonly string[],
  pageUrl: 'https://dupoin.com/',
  marketCode: 'ID',
  marketName: 'Indonesia',
  geoIds: ['2360'] as readonly string[],
  languageId: '1025',
  languageName: 'Indonesian',
  network: 'GOOGLE_SEARCH' as const,
  maxIdeas: 1000,
  seedLimit: 20,
  includeAdultKeywords: false,
} as const;

export type KeywordTrendsConfig = typeof KEYWORD_TRENDS_CONFIG;

export type DiscoverySource = 'keyword' | 'site';

export interface RequestSpec {
  source: DiscoverySource;
  /** Seed keywords of this batch; empty for the site spec. */
  keywords: string[];
}

/** Mirrors _request_specs: one keyword batch per `seedLimit` seeds, then one site spec when a page URL is set. */
export function requestSpecs(seeds: readonly string[], pageUrl: string | null, seedLimit: number): RequestSpec[] {
  const unique = [...new Set(seeds.map(seed => seed.trim()).filter(Boolean))];
  const limit = Math.max(1, seedLimit);
  const specs: RequestSpec[] = [];
  for (let index = 0; index < unique.length; index += limit) specs.push({ source: 'keyword', keywords: unique.slice(index, index + limit) });
  if (pageUrl) specs.push({ source: 'site', keywords: [] });
  if (!specs.length) throw new Error('Seed keywords and page URL cannot both be empty.');
  return specs;
}

/** REST body for one spec (pageToken is added by the client while paging). */
export function buildIdeasRequest(spec: RequestSpec, config: KeywordTrendsConfig = KEYWORD_TRENDS_CONFIG): GenerateKeywordIdeasRequest {
  const body: GenerateKeywordIdeasRequest = {
    language: `languageConstants/${config.languageId}`,
    geoTargetConstants: config.geoIds.map(id => `geoTargetConstants/${id}`),
    keywordPlanNetwork: config.network,
    includeAdultKeywords: config.includeAdultKeywords,
    keywordAnnotation: ['KEYWORD_CONCEPT'],
    pageSize: Math.min(config.maxIdeas, 10_000),
  };
  if (spec.source === 'site') body.siteSeed = { site: config.pageUrl };
  else body.keywordSeed = { keywords: [...spec.keywords] };
  return body;
}

/** Monthly cron: the 3rd at 06:00 WIB. Server crontab runs in UTC, so 23:00 on the 2nd. */
export const KEYWORD_TRENDS_CRON_UTC = '0 23 2 * *';
