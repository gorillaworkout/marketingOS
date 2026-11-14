import type { CompetitorKeyword, OurKeyword } from './keyword-gap-bucket';

export const SEMRUSH_ENDPOINT = 'https://api.semrush.com/';
export const DATAFORSEO_RANKED = 'https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live';
export const DATAFORSEO_INTERSECTION = 'https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live';

export function semrushDatabase(market: string, language: 'id' | 'en'): string {
  const text = market.trim().toLowerCase();
  if (text === 'id' || text.includes('indonesia')) return 'id';
  if (text === 'us' || text === 'usa' || text.includes('united states') || text.includes('america')) return 'us';
  return language === 'id' ? 'id' : 'us';
}

export function semrushOrganicUrl(domain: string, database: string, key: string): string {
  const url = new URL(SEMRUSH_ENDPOINT);
  url.searchParams.set('type', 'domain_organic');
  url.searchParams.set('key', key);
  url.searchParams.set('domain', domain);
  url.searchParams.set('database', database);
  url.searchParams.set('display_limit', '200');
  url.searchParams.set('export_columns', 'Ph,Po,Nq');
  return url.toString();
}

/** Domain vs domain. `*|or|` is Semrush's intersection operator. */
export function semrushDomainVsDomainUrl(ourDomain: string, competitor: string, database: string, key: string): string {
  const url = new URL(SEMRUSH_ENDPOINT);
  url.searchParams.set('type', 'domain_domains');
  url.searchParams.set('key', key);
  url.searchParams.set('domains', `*|or|${ourDomain}|*|or|${competitor}`);
  url.searchParams.set('database', database);
  url.searchParams.set('display_limit', '200');
  url.searchParams.set('export_columns', 'Ph,P0,P1,Nq');
  return url.toString();
}

export function scrubProviderSecret(text: string, secret: string | null): string {
  if (!secret) return text.slice(0, 300);
  return text.split(secret).join('[redacted]').replace(/key=[^&\s]+/gi, 'key=[redacted]').slice(0, 300);
}

function splitTable(text: string): string[][] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const separator = lines[0].includes(';') ? ';' : ',';
  return lines.map(line => line.split(separator).map(cell => cell.trim()));
}

function headerIndex(header: string[], names: string[]): number {
  const cells = header.map(cell => cell.toLowerCase());
  return cells.findIndex(cell => names.includes(cell));
}

function numeric(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSemrushOrganic(text: string, domain: string): { ours: OurKeyword[]; competitor: CompetitorKeyword[] } {
  const table = splitTable(text);
  const header = table[0] ?? [];
  const phraseAt = headerIndex(header, ['ph', 'keyword']);
  const positionAt = headerIndex(header, ['po', 'p0', 'position']);
  const volumeAt = headerIndex(header, ['nq', 'search volume']);
  if (phraseAt < 0) return { ours: [], competitor: [] };
  const ours: OurKeyword[] = [];
  const competitor: CompetitorKeyword[] = [];
  for (const row of table.slice(1)) {
    const keyword = row[phraseAt] || '';
    if (!keyword || keyword.startsWith('ERROR')) continue;
    const position = positionAt >= 0 ? numeric(row[positionAt]) : null;
    const volume = volumeAt >= 0 ? numeric(row[volumeAt]) : null;
    ours.push({ query: keyword, clicks: 0, impressions: volume ?? 0, ctr: null, position });
    competitor.push({ keyword, domain, position, volume });
  }
  return { ours, competitor };
}

export function parseSemrushIntersection(text: string, ourDomain: string, competitor: string): { ours: OurKeyword[]; competitor: CompetitorKeyword[] } {
  const table = splitTable(text);
  const header = table[0] ?? [];
  const phraseAt = headerIndex(header, ['ph', 'keyword']);
  const oursAt = headerIndex(header, ['p0']);
  const theirsAt = headerIndex(header, ['p1']);
  const volumeAt = headerIndex(header, ['nq', 'search volume']);
  if (phraseAt < 0) return { ours: [], competitor: [] };
  const ours: OurKeyword[] = [];
  const competitorRows: CompetitorKeyword[] = [];
  for (const row of table.slice(1)) {
    const keyword = row[phraseAt] || '';
    if (!keyword || keyword.startsWith('ERROR')) continue;
    const ourPosition = oursAt >= 0 ? numeric(row[oursAt]) : null;
    const theirPosition = theirsAt >= 0 ? numeric(row[theirsAt]) : null;
    const volume = volumeAt >= 0 ? numeric(row[volumeAt]) : null;
    if (ourPosition) ours.push({ query: keyword, clicks: 0, impressions: volume ?? 0, ctr: null, position: ourPosition });
    if (theirPosition) competitorRows.push({ keyword, domain: competitor, position: theirPosition, volume });
    void ourDomain;
  }
  return { ours, competitor: competitorRows };
}

export function dataForSeoRankedBody(domain: string, market: string, language: 'id' | 'en') {
  return [{ target: domain, location_name: market, language_code: language, limit: 200, item_types: ['organic'] }];
}

export function dataForSeoIntersectionBody(ourDomain: string, competitor: string, market: string, language: 'id' | 'en') {
  return [{ target1: ourDomain, target2: competitor, location_name: market, language_code: language, limit: 200 }];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function dataForSeoError(body: unknown): string | null {
  const root = asRecord(body);
  const tasks = Array.isArray(root?.tasks) ? root.tasks : [];
  const task = asRecord(tasks[0]);
  const code = task?.status_code;
  if (typeof code === 'number' && code !== 20000) return String(task?.status_message || 'DataForSEO request failed').slice(0, 300);
  return null;
}

function itemsOf(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body);
  const tasks = Array.isArray(root?.tasks) ? root.tasks : [];
  const task = asRecord(tasks[0]);
  const result = Array.isArray(task?.result) ? task.result : [];
  const first = asRecord(result[0]);
  const items = Array.isArray(first?.items) ? first.items : [];
  return items.map(asRecord).filter((item): item is Record<string, unknown> => !!item);
}

function keywordOf(item: Record<string, unknown>): string {
  const data = asRecord(item.keyword_data);
  if (typeof data?.keyword === 'string') return data.keyword;
  if (typeof item.keyword === 'string') return item.keyword;
  return '';
}

function volumeOf(item: Record<string, unknown>): number | null {
  const data = asRecord(item.keyword_data);
  const info = asRecord(data?.keyword_info);
  const volume = info?.search_volume;
  return typeof volume === 'number' ? volume : null;
}

function rankOf(value: unknown): number | null {
  const record = asRecord(value);
  const serp = asRecord(record?.serp_item) ?? record;
  const rank = serp?.rank_group ?? serp?.rank_absolute;
  return typeof rank === 'number' ? rank : null;
}

export function parseDataForSeoRanked(body: unknown, domain: string): { ours: OurKeyword[]; competitor: CompetitorKeyword[] } {
  const ours: OurKeyword[] = [];
  const competitor: CompetitorKeyword[] = [];
  for (const item of itemsOf(body)) {
    const keyword = keywordOf(item);
    if (!keyword) continue;
    const ranked = asRecord(item.ranked_serp_element);
    const position = rankOf(ranked);
    const volume = volumeOf(item);
    ours.push({ query: keyword, clicks: 0, impressions: volume ?? 0, ctr: null, position });
    competitor.push({ keyword, domain, position, volume });
  }
  return { ours, competitor };
}

export function parseDataForSeoIntersection(body: unknown, competitor: string): { ours: OurKeyword[]; competitor: CompetitorKeyword[] } {
  const ours: OurKeyword[] = [];
  const competitorRows: CompetitorKeyword[] = [];
  for (const item of itemsOf(body)) {
    const keyword = keywordOf(item);
    if (!keyword) continue;
    const volume = volumeOf(item);
    const ourPosition = rankOf(item.first_domain_serp_element);
    const theirPosition = rankOf(item.second_domain_serp_element);
    if (ourPosition) ours.push({ query: keyword, clicks: 0, impressions: volume ?? 0, ctr: null, position: ourPosition });
    if (theirPosition) competitorRows.push({ keyword, domain: competitor, position: theirPosition, volume });
  }
  return { ours, competitor: competitorRows };
}
