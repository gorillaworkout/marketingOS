/**
 * Every treg.to path, endpoint id and price this app relies on lives here, so a
 * change on treg's side is a one-file edit. Sources (read 2026-11-16):
 * - https://treg.to/integrate.md and https://treg.to/skill.md (REST, headers, errors)
 * - https://treg.to/openapi.json (GET /auth/me, GET /orgs/{org_id}/balance)
 * - https://treg.to/catalog/endpoints/dataforseo.google.domain.ranked_keywords (body, price)
 * - https://docs.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live/ (response shape)
 */

export const TREG_DEFAULT_BASE_URL = 'https://treg.to';

/** treg relays the DataForSEO Labs "Ranked Keywords" call verbatim. */
export const TREG_RANKED_KEYWORDS_ENDPOINT = 'dataforseo.google.domain.ranked_keywords';

/** `POST /call/{endpoint-id}` runs a catalog endpoint. */
export function tregCallPath(endpointId: string): string {
  return `/call/${encodeURIComponent(endpointId)}`;
}

/** The caller's identity; an org-scoped token answers with `org_id`. */
export const TREG_ME_PATH = '/auth/me';

/** Prepaid balance; `balance_micro` is integer micro-USD. Any org member can read it. */
export function tregBalancePath(orgId: string | number): string {
  return `/orgs/${encodeURIComponent(String(orgId))}/balance`;
}

/**
 * Catalog price for the ranked-keywords endpoint (checked 2026-11-16): $0.012 per
 * request plus $0.00012 per returned keyword. Used only for the pre-run estimate;
 * the charge we record comes from the `X-Treg-Cost-Micro` response header.
 */
export const TREG_RANKED_PRICE = { perRequestMicro: 12_000, perKeywordMicro: 120 } as const;

/** Keyword Gap on treg: one ranked-keywords call for our domain and one per competitor. */
export function estimateKeywordGapMicro(competitors: number, keywordLimit: number): { calls: number; perCallMicro: number; totalMicro: number } {
  const calls = 1 + Math.max(0, competitors);
  const perCallMicro = TREG_RANKED_PRICE.perRequestMicro + TREG_RANKED_PRICE.perKeywordMicro * Math.max(0, keywordLimit);
  return { calls, perCallMicro, totalMicro: calls * perCallMicro };
}

export const TREG_KEYWORD_LIMITS = [100, 200, 500] as const;
export const TREG_DEFAULT_KEYWORD_LIMIT = 200;

/** DataForSEO location codes are 2000 + the ISO 3166 numeric country code. */
const LOCATION_CODES: Record<string, number> = {
  indonesia: 2360, id: 2360,
  'united states': 2840, usa: 2840, us: 2840,
  singapore: 2702, sg: 2702,
  malaysia: 2458, my: 2458,
};

export function tregRankedKeywordsBody(target: string, market: string, language: 'id' | 'en', limit: number) {
  const code = LOCATION_CODES[market.trim().toLowerCase()];
  const location = code ? { location_code: code } : { location_name: market.trim() };
  return [{
    target,
    ...location,
    language_code: language,
    limit,
    item_types: ['organic'],
    order_by: ['keyword_data.keyword_info.search_volume,desc'],
  }];
}
