/**
 * Search term analysis (read-only suggestions; nothing is sent to Google Ads):
 * - Negative keyword suggestions: search terms that spent at least a threshold
 *   with 0 conversions in the range, per account + campaign (negatives are
 *   usually added at campaign level).
 * - Keyword candidates: converting search terms that are not yet a keyword in
 *   that account (by normalized text) and not already marked ADDED/EXCLUDED.
 */
import { queryAll } from '@/lib/database';
import { SEARCH_TERMS } from './insights-config';
import { parseCustomerFilter, parseReportRange, searchTermRows, ReportInputError, type SearchTermRow } from './report';
import { normalizeKeyword, normalizeTerm } from './text';

export interface NegativeSuggestion {
  customerId: string; accountName: string; campaignName: string; term: string;
  cost: number; clicks: number; impressions: number; adGroups: number; matchTypes: string[];
}

export interface KeywordCandidate {
  customerId: string; accountName: string; term: string; campaigns: string[];
  conversions: number; cost: number; clicks: number; costPerConversion: number | null; matchTypes: string[];
}

type TermInput = Pick<SearchTermRow, 'customerId' | 'accountName' | 'campaignName' | 'adGroupName' | 'searchTerm' | 'matchType' | 'status' | 'cost' | 'clicks' | 'impressions' | 'conversions'>;

export function negativeSuggestions(rows: TermInput[], minCost: number): { rows: NegativeSuggestion[]; wastedSpend: number } {
  const groups = new Map<string, NegativeSuggestion & { conversions: number; adGroupSet: Set<string>; matchSet: Set<string> }>();
  for (const row of rows) {
    const term = normalizeTerm(row.searchTerm);
    if (!term || row.status === 'EXCLUDED') continue;
    const key = `${row.customerId}|${row.campaignName}|${term}`;
    const group = groups.get(key) ?? { customerId: row.customerId, accountName: row.accountName, campaignName: row.campaignName, term, cost: 0, clicks: 0, impressions: 0, conversions: 0, adGroups: 0, matchTypes: [], adGroupSet: new Set(), matchSet: new Set() };
    group.cost += row.cost; group.clicks += row.clicks; group.impressions += row.impressions; group.conversions += row.conversions;
    group.adGroupSet.add(row.adGroupName); if (row.matchType) group.matchSet.add(row.matchType);
    groups.set(key, group);
  }
  const result = [...groups.values()]
    .filter(group => group.conversions === 0 && group.cost >= minCost)
    .map(group => ({ customerId: group.customerId, accountName: group.accountName, campaignName: group.campaignName, term: group.term, cost: group.cost, clicks: group.clicks, impressions: group.impressions, adGroups: group.adGroupSet.size, matchTypes: [...group.matchSet].sort() }))
    .sort((left, right) => right.cost - left.cost || left.term.localeCompare(right.term));
  return { rows: result, wastedSpend: result.reduce((sum, row) => sum + row.cost, 0) };
}

export function keywordCandidates(rows: TermInput[], keywordTexts: Map<string, Set<string>>, minConversions: number): KeywordCandidate[] {
  const groups = new Map<string, KeywordCandidate & { campaignSet: Set<string>; matchSet: Set<string>; skip: boolean }>();
  for (const row of rows) {
    const term = normalizeTerm(row.searchTerm);
    if (!term) continue;
    const key = `${row.customerId}|${term}`;
    const group = groups.get(key) ?? { customerId: row.customerId, accountName: row.accountName, term, campaigns: [], conversions: 0, cost: 0, clicks: 0, costPerConversion: null, matchTypes: [], campaignSet: new Set(), matchSet: new Set(), skip: false };
    group.conversions += row.conversions; group.cost += row.cost; group.clicks += row.clicks;
    group.campaignSet.add(row.campaignName); if (row.matchType) group.matchSet.add(row.matchType);
    if (row.status === 'ADDED' || row.status === 'EXCLUDED' || row.status === 'ADDED_EXCLUDED') group.skip = true;
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter(group => !group.skip && group.conversions >= minConversions && !keywordTexts.get(group.customerId)?.has(group.term))
    .map(group => ({ customerId: group.customerId, accountName: group.accountName, term: group.term, conversions: group.conversions, cost: group.cost, clicks: group.clicks, campaigns: [...group.campaignSet].sort(), matchTypes: [...group.matchSet].sort(), costPerConversion: group.conversions ? group.cost / group.conversions : null }))
    .sort((left, right) => right.conversions - left.conversions || right.cost - left.cost || left.term.localeCompare(right.term));
}

/** Every keyword text an account has ever had in the synced data, normalized. */
export async function accountKeywordTexts(customerId: string | null): Promise<Map<string, Set<string>>> {
  const rows = await queryAll<{ customer_id: string; keyword_text: string }>(
    `SELECT DISTINCT customer_id, keyword_text FROM google_ads_keyword_daily${customerId ? ' WHERE customer_id = ?' : ''}`, customerId ? [customerId] : [],
  );
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = map.get(row.customer_id) ?? new Set<string>();
    set.add(normalizeKeyword(row.keyword_text));
    map.set(row.customer_id, set);
  }
  return map;
}

export function parseAmount(value: string | null, fallback: number, label: string): number {
  if (value == null || value === '') return fallback;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new ReportInputError(`${label} must be a number of 0 or more.`);
  return amount;
}

export interface SearchTermInsights {
  range: { start: string; end: string };
  minCost: number;
  minConversions: number;
  negatives: NegativeSuggestion[];
  negativeCount: number;
  wastedSpend: number;
  candidates: KeywordCandidate[];
  candidateCount: number;
  candidateConversions: number;
  limits: { rows: number };
}

export async function getSearchTermInsights(input: { start: string | null; end: string | null; account: string | null; minCost: string | null; minConversions: string | null; limit?: number }): Promise<SearchTermInsights> {
  const range = parseReportRange(input.start, input.end);
  const customerId = parseCustomerFilter(input.account);
  const minCost = parseAmount(input.minCost, SEARCH_TERMS.defaultNegativeMinCost, 'minCost');
  const minConversions = Math.max(0.01, parseAmount(input.minConversions, SEARCH_TERMS.defaultCandidateMinConversions, 'minConversions'));
  const [rows, keywords] = await Promise.all([searchTermRows(range.start, range.end, customerId), accountKeywordTexts(customerId)]);
  const negatives = negativeSuggestions(rows, minCost);
  const candidates = keywordCandidates(rows, keywords, minConversions);
  const limit = input.limit ?? SEARCH_TERMS.rowLimit;
  return {
    range: { start: range.start, end: range.end }, minCost, minConversions,
    negatives: negatives.rows.slice(0, limit), negativeCount: negatives.rows.length, wastedSpend: negatives.wastedSpend,
    candidates: candidates.slice(0, limit), candidateCount: candidates.length, candidateConversions: candidates.reduce((sum, row) => sum + row.conversions, 0),
    limits: { rows: limit },
  };
}
