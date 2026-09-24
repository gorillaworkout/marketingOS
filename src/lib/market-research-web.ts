import { createHash } from 'node:crypto';
import { COMPETITOR_BROKERS } from './article-market-news';
import {
  classifySourceOrigin,
  htmlToPlainText,
  isLikelyLoginWallHost,
  isPublicHttpUrl,
  jinaReaderUrl,
  resolveSearchApiKeys,
  searchSerper,
} from './ai-research-grounding';
import type { MarketBriefCategory, MarketNewsCandidate, MarketProductCategory } from './market-research';
import {
  categoryOfSymbol,
  classifySymbols,
  importanceCategoryOf,
  isRetailGoldHeadline,
  isSpeculativeMarketHeadline,
  limitIndonesianOrigin,
  MARKET_RESEARCH_GROUPS,
  researchLatestMarketNews,
  type MarketResearchFeed,
  type MarketResearchSourceResult,
} from './market-research-sources';
import { EmptyMarketResearchPoolError, type MarketResearchSourceStatus } from './market-research-status';

const MAX_QUERIES = 3;
const MAX_PAGE_READS = 6;
const MAX_WEB_CANDIDATES = 8;
const MAX_POOL = 12;
const MAX_BYTES = 400_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_SNIPPET = 40;
const FULL_TEXT_LIMIT = 4_500;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const MARKET_RESEARCH_OPEN_WEB_OUTLET = 'Open web';
export const MARKET_RESEARCH_SERPER_SKIPPED = 'SERPER_API_KEY is not set. Category feeds still run.';

export type MarketResearchGatherPhase = 'feeds' | 'search' | 'read' | 'skip';

export interface MarketResearchGatherResult extends MarketResearchSourceResult {
  themeCandidateCount: number;
}

export interface GatherMarketResearchOptions {
  feeds?: MarketResearchFeed[];
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
  serperApiKey?: string;
  enableJina?: boolean;
  now?: () => number;
  onProgress?: (phase: MarketResearchGatherPhase) => void;
}

type FetchLike = typeof fetch;

interface DatedPublication {
  publishedAt: string;
  timeKnown: boolean;
}

type PublicationDecision = DatedPublication | { reject: true } | { unknown: true };

const BRIEF_STOP = new Set([
  'prepare', 'morning', 'briefing', 'dupoin', 'marketing', 'please', 'focus', 'prioritize',
  'today', 'market', 'news', 'sector', 'with', 'from', 'that', 'this', 'have', 'will',
  'your', 'about', 'into', 'after', 'before', 'their', 'there', 'which', 'would', 'could',
  'should', 'untuk', 'yang', 'dari', 'dengan', 'pada', 'hari', 'ini', 'dan', 'atau',
  'adalah', 'para', 'bagi', 'saat', 'agar', 'serta', 'most', 'more', 'than', 'only',
  'also', 'such', 'team', 'note', 'desk', 'what', 'they', 'mean', 'means', 'confirmed',
  'official', 'statements', 'statement', 'developments', 'development', 'factual',
  'trading', 'sentiment', 'decisions', 'decision', 'economic', 'data', 'story', 'stories',
  'brief', 'research', 'latest', 'important', 'matters', 'matter', 'actions', 'action',
]);

const THEME_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'after', 'before', 'into', 'over', 'under', 'amid', 'says', 'said']);

const MONTH_PATTERN = 'jan(?:uary|uari)?|feb(?:ruary|ruari)?|mar(?:ch|et)?|apr(?:il)?|may|mei|jun(?:e|i)?|jul(?:y|i)?|aug(?:ust|ustus)?|sep(?:t(?:ember)?)?|o[ck]t(?:ober)?|nov(?:ember)?|de[sc](?:ember)?';

export function buildMarketResearchSearchQueries(brief: string, researchDate: string): string[] {
  const cleaned = brief.replace(/\s+/g, ' ').trim();
  const sentence = (cleaned.split(/[.!?\n]/)[0] || cleaned).trim();
  const topic = (sentence.length <= 140 ? sentence : sentence.slice(0, 140).replace(/\s+\S*$/, '')).trim();
  return uniqueQueries([
    `${topic} ${researchDate}`,
    `${topic} market news`,
    `${topic} sector`,
  ]);
}

export function marketResearchGroupCounts(candidates: MarketNewsCandidate[]): {
  groupCandidateCounts: Record<MarketProductCategory, number>;
  themeCandidateCount: number;
} {
  const groupCandidateCounts = Object.fromEntries(
    MARKET_RESEARCH_GROUPS.map(group => [group, candidates.filter(candidate => candidate.categories.includes(group)).length]),
  ) as Record<MarketProductCategory, number>;
  return {
    groupCandidateCounts,
    themeCandidateCount: candidates.filter(candidate => candidate.categories.includes('Theme')).length,
  };
}

export async function gatherMarketResearch(
  brief: string,
  researchDate: string,
  options: GatherMarketResearchOptions = {},
): Promise<MarketResearchGatherResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes || MAX_BYTES;
  const enableJina = options.enableJina !== false;
  const now = options.now?.() ?? Date.now();
  options.onProgress?.('feeds');

  const rss = await loadPublisherFeeds(researchDate, options);
  const publisherCandidates = rss.candidates.map(candidate => ({ ...candidate, gatheredVia: 'publisher-feed' as const }));
  const serperKey = options.serperApiKey !== undefined ? options.serperApiKey.trim() : resolveSearchApiKeys().serper;

  let webCandidates: MarketNewsCandidate[] = [];
  let webStatus: MarketResearchSourceStatus;
  const snippets = new Map<string, string>();
  if (!serperKey) {
    options.onProgress?.('skip');
    webStatus = { outlet: MARKET_RESEARCH_OPEN_WEB_OUTLET, status: 'error', candidateCount: 0, sameDayCount: 0, error: MARKET_RESEARCH_SERPER_SKIPPED };
  } else {
    options.onProgress?.('search');
    const searched = await searchOpenWeb(brief, researchDate, serperKey, fetchImpl, maxBytes, timeoutMs, now);
    webCandidates = searched.candidates;
    for (const [url, snippet] of searched.snippets) snippets.set(url, snippet);
    webStatus = {
      outlet: MARKET_RESEARCH_OPEN_WEB_OUTLET,
      status: searched.failed ? 'error' : 'ok',
      candidateCount: 0,
      sameDayCount: searched.sameDayCount,
      error: searched.failed ? searched.error : undefined,
    };
  }

  let merged = mergeByUrl([...publisherCandidates, ...webCandidates]);
  if (merged.length > 0) {
    options.onProgress?.('read');
    const documents = await readCandidatePages(merged, fetchImpl, timeoutMs, maxBytes, enableJina);
    merged = merged.flatMap(candidate => {
      const text = documents.get(candidate.url);
      if (!text) {
        if (candidate.gatheredVia === 'open-web' && !snippetUsable(snippets.get(candidate.url) || '')) return [];
        return [candidate];
      }
      const updated = applyPageText(candidate, text, snippets.get(candidate.url) || '', researchDate, now);
      return updated ? [updated] : [];
    });
  }

  const ranked = assignThemeSymbols(capPool(limitIndonesianOrigin(
    merged.sort((a, b) => (b.updatedAt || b.publishedAt).localeCompare(a.updatedAt || a.publishedAt)),
  )));
  const keptWeb = ranked.filter(candidate => candidate.gatheredVia === 'open-web').length;
  webStatus = { ...webStatus, candidateCount: keptWeb };
  const sourceStatus = [...rss.sourceStatus, webStatus];
  if (ranked.length === 0) throw new EmptyMarketResearchPoolError(sourceStatus);
  const counts = marketResearchGroupCounts(ranked);
  return {
    candidates: ranked,
    groupsSearched: [...MARKET_RESEARCH_GROUPS],
    groupCandidateCounts: counts.groupCandidateCounts,
    sourceStatus,
    themeCandidateCount: counts.themeCandidateCount,
  };
}

async function loadPublisherFeeds(researchDate: string, options: GatherMarketResearchOptions): Promise<MarketResearchSourceResult> {
  try {
    return await researchLatestMarketNews(researchDate, {
      feeds: options.feeds,
      fetchImpl: options.fetchImpl,
      maxBytes: options.maxBytes,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    if (!(error instanceof EmptyMarketResearchPoolError)) throw error;
    const groupCandidateCounts = Object.fromEntries(MARKET_RESEARCH_GROUPS.map(group => [group, 0])) as Record<MarketProductCategory, number>;
    return { candidates: [], groupsSearched: [...MARKET_RESEARCH_GROUPS], groupCandidateCounts, sourceStatus: error.sourceStatus };
  }
}

async function searchOpenWeb(
  brief: string,
  researchDate: string,
  serperKey: string,
  fetchImpl: FetchLike,
  maxBytes: number,
  timeoutMs: number,
  now: number,
): Promise<{ candidates: MarketNewsCandidate[]; snippets: Map<string, string>; sameDayCount: number; failed: boolean; error?: string }> {
  const queries = buildMarketResearchSearchQueries(brief, researchDate);
  const settled = await Promise.allSettled(queries.map(query => searchSerper(query, serperKey, fetchImpl, maxBytes, timeoutMs)));
  const snippets = new Map<string, string>();
  const found: MarketNewsCandidate[] = [];
  let examined = 0;
  let rejectedDate = 0;
  let exhausted = false;
  let sawSuccess = false;
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    sawSuccess = true;
    exhausted = exhausted || result.value.exhausted;
    for (const source of result.value.sources) {
      if (!isPublicHttpUrl(source.url) || isLikelyLoginWallHost(source.url) || snippets.has(source.url)) continue;
      examined += 1;
      const candidate = buildWebCandidate(brief, researchDate, source.title, source.url, source.snippet, now);
      if (!candidate) {
        if (publicationRejected(source.snippet, researchDate, now)) rejectedDate += 1;
        continue;
      }
      snippets.set(candidate.url, source.snippet);
      found.push(candidate);
      if (found.length >= MAX_WEB_CANDIDATES) break;
    }
    if (found.length >= MAX_WEB_CANDIDATES) break;
  }
  const failed = !sawSuccess || (exhausted && found.length === 0);
  return {
    candidates: found,
    snippets,
    sameDayCount: Math.max(0, examined - rejectedDate),
    failed,
    error: failed ? 'Serper returned no usable hits or was rate-limited. Category feeds still run.' : undefined,
  };
}

function buildWebCandidate(
  brief: string,
  researchDate: string,
  title: string,
  rawUrl: string,
  snippet: string,
  now: number,
): MarketNewsCandidate | null {
  let url: string;
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    url = parsed.toString();
  } catch {
    return null;
  }
  if (!isPublicHttpUrl(url) || isLikelyLoginWallHost(url)) return null;
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  if (!cleanTitle || isRetailGoldHeadline(cleanTitle) || isSpeculativeMarketHeadline(cleanTitle)) return null;
  if (mentionsCompetitor(`${cleanTitle} ${snippet}`)) return null;
  const publication = resolvePublication(snippet, null, researchDate, now);
  if ('reject' in publication) return null;
  const symbols = classifySymbols(cleanTitle);
  const importance = importanceCategoryOf(cleanTitle, snippet);
  const instrument = symbols.length > 0 && Boolean(importance);
  if (!instrument && !relevantToBrief(brief, cleanTitle, snippet)) return null;
  const categories: MarketBriefCategory[] = instrument
    ? [...new Set(symbols.map(categoryOfSymbol).filter((value): value is MarketProductCategory => value !== null))]
    : ['Theme'];
  if (categories.length === 0) return null;
  const theme = categories.includes('Theme');
  return {
    id: createHash('sha256').update(url).digest('hex').slice(0, 16),
    outlet: outletFromUrl(url),
    title: cleanTitle.slice(0, 300),
    url,
    publishedAt: 'publishedAt' in publication ? publication.publishedAt : `${researchDate}T00:00`,
    updatedAt: null,
    categories,
    symbols: theme ? [] : symbols,
    origin: classifySourceOrigin(url),
    importanceCategory: importance || 'Sector',
    evidence: `Open-web snippet: ${cleanTitle}. ${snippet}`.replace(/\s+/g, ' ').trim().slice(0, 3_000),
    evidenceLevel: 'search-snippet',
    publicationTimeKnown: 'publishedAt' in publication ? publication.timeKnown : false,
    gatheredVia: 'open-web',
  };
}

function applyPageText(
  candidate: MarketNewsCandidate,
  text: string,
  snippet: string,
  researchDate: string,
  now: number,
): MarketNewsCandidate | null {
  let next = candidate;
  if (candidate.gatheredVia === 'open-web') {
    const publication = resolvePublication(snippet, text, researchDate, now);
    if ('reject' in publication) return null;
    if ('publishedAt' in publication) {
      next = { ...candidate, publishedAt: publication.publishedAt, publicationTimeKnown: publication.timeKnown };
    }
  }
  const plain = htmlToPlainText(text).replace(/\s+/g, ' ').trim();
  if (plain.length < 80) return next;
  return {
    ...next,
    evidence: `Full page text: ${plain}`.slice(0, FULL_TEXT_LIMIT),
    evidenceLevel: 'full-text',
  };
}

function publicationRejected(snippet: string, researchDate: string, now: number): boolean {
  const decision = resolvePublication(snippet, null, researchDate, now);
  return 'reject' in decision;
}

function resolvePublication(snippet: string, pageText: string | null, researchDate: string, now: number): PublicationDecision {
  const publishedLine = pageText?.match(/published time:\s*([^\n]+)/i)?.[1]?.trim() || '';
  if (publishedLine) {
    const parsed = Date.parse(publishedLine);
    if (!Number.isNaN(parsed)) return matchResearchDay(new Date(parsed), researchDate, true);
  }
  const fromSnippet = explicitDate(snippet);
  if (fromSnippet) return matchResearchDay(fromSnippet.date, researchDate, fromSnippet.timeKnown);
  const relativeSnippet = relativeDate(snippet, now);
  if (relativeSnippet) return matchResearchDay(relativeSnippet, researchDate, true);
  const head = pageText?.slice(0, 700) || '';
  const fromPage = head ? explicitDate(head) : null;
  if (fromPage) return matchResearchDay(fromPage.date, researchDate, fromPage.timeKnown);
  const relativePage = head ? relativeDate(head, now) : null;
  if (relativePage) return matchResearchDay(relativePage, researchDate, true);
  return { unknown: true };
}

function matchResearchDay(date: Date, researchDate: string, timeKnown: boolean): PublicationDecision {
  const stamp = wibStamp(date);
  if (!stamp || stamp.slice(0, 10) !== researchDate) return { reject: true };
  if (!timeKnown) return { publishedAt: `${researchDate}T00:00`, timeKnown: false };
  return { publishedAt: stamp, timeKnown: true };
}

function explicitDate(text: string): { date: Date; timeKnown: boolean } | null {
  const source = text.slice(0, 1_200);
  const iso = source.match(/\b(20\d{2})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})?)?/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (iso[4]) {
      const zone = iso[6] || '+07:00';
      const parsed = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:00${zone === 'Z' ? 'Z' : zone}`);
      if (!Number.isNaN(parsed.getTime())) return { date: parsed, timeKnown: true };
    }
    const date = dateOnly(year, month, day);
    if (date) return { date, timeKnown: false };
  }
  const monthName = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'i');
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\s+(20\\d{2})\\b`, 'i');
  const monthFirst = source.match(monthName);
  if (monthFirst) {
    const date = dateOnly(Number(monthFirst[3]), monthNumber(monthFirst[1]), Number(monthFirst[2]));
    if (date) return { date, timeKnown: false };
  }
  const dayFirst = source.match(dayMonth);
  if (dayFirst) {
    const date = dateOnly(Number(dayFirst[3]), monthNumber(dayFirst[2]), Number(dayFirst[1]));
    if (date) return { date, timeKnown: false };
  }
  return null;
}

function relativeDate(text: string, now: number): Date | null {
  const head = text.slice(0, 500).toLowerCase();
  const hours = head.match(/\b(\d{1,2})\s+hours?\s+ago\b/);
  if (hours) return new Date(now - Number(hours[1]) * 3_600_000);
  const minutes = head.match(/\b(\d{1,3})\s+minutes?\s+ago\b/);
  if (minutes) return new Date(now - Number(minutes[1]) * 60_000);
  return null;
}

function dateOnly(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthNumber(token: string): number {
  const value = token.toLowerCase();
  if (value.startsWith('mei')) return 5;
  if (value.startsWith('okt')) return 10;
  if (value.startsWith('des')) return 12;
  if (value.startsWith('sep')) return 9;
  const key = value.slice(0, 3);
  const map: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, oct: 10, nov: 11, dec: 12 };
  return map[key] || 0;
}

function wibStamp(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function relevantToBrief(brief: string, title: string, snippet: string): boolean {
  const tokens = rareTokens(brief);
  if (tokens.length === 0) return false;
  const titleHay = normalizeWords(title);
  const snippetHay = normalizeWords(snippet);
  if (tokens.some(token => hasWord(titleHay, token))) return true;
  return tokens.filter(token => hasWord(snippetHay, token)).length >= 2;
}

function rareTokens(brief: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of normalizeWords(brief).split(' ')) {
    if (token.length < 4 || BRIEF_STOP.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function hasWord(haystack: string, token: string): boolean {
  return ` ${haystack} `.includes(` ${token} `);
}

function normalizeWords(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function assignThemeSymbols(candidates: MarketNewsCandidate[]): MarketNewsCandidate[] {
  const used = new Set(candidates.flatMap(candidate => candidate.categories.includes('Theme') ? [] : candidate.symbols));
  return candidates.map(candidate => {
    if (!candidate.categories.includes('Theme')) return candidate;
    return { ...candidate, symbols: [themeSymbol(candidate.title, used)] };
  });
}

function themeSymbol(title: string, used: Set<string>): string {
  const words = title.replace(/[^A-Za-z0-9]+/g, ' ').split(' ').filter(word => word.length > 2 && !THEME_STOP.has(word.toLowerCase()));
  const base = (words.slice(0, 4).join(' ') || 'Theme').slice(0, 48);
  let symbol = base;
  let n = 2;
  while (used.has(symbol)) {
    const suffix = ` ${n}`;
    symbol = `${base.slice(0, Math.max(1, 48 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(symbol);
  return symbol;
}

function mentionsCompetitor(value: string): boolean {
  const haystack = value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  return COMPETITOR_BROKERS.some(broker => haystack.includes(broker.toLowerCase().replace(/[^a-z0-9]+/g, '')));
}

function outletFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return MARKET_RESEARCH_OPEN_WEB_OUTLET;
  }
}

function snippetUsable(snippet: string): boolean {
  return snippet.replace(/\s+/g, ' ').trim().length >= MIN_SNIPPET;
}

function mergeByUrl(rows: MarketNewsCandidate[]): MarketNewsCandidate[] {
  const map = new Map<string, MarketNewsCandidate>();
  for (const row of rows) {
    const key = row.url.replace(/\/$/, '');
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const primary = existing.gatheredVia !== 'open-web' ? existing : row.gatheredVia !== 'open-web' ? row : existing;
    map.set(key, primary);
  }
  return [...map.values()];
}

function capPool(candidates: MarketNewsCandidate[]): MarketNewsCandidate[] {
  const web = candidates.filter(candidate => candidate.gatheredVia === 'open-web').slice(0, MAX_WEB_CANDIDATES);
  const feeds = candidates.filter(candidate => candidate.gatheredVia !== 'open-web').slice(0, Math.max(0, MAX_POOL - web.length));
  const keep = new Set([...web, ...feeds].map(candidate => candidate.id));
  return candidates.filter(candidate => keep.has(candidate.id));
}

function uniqueQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const cleaned = query.replace(/\s+/g, ' ').trim().slice(0, 180);
    const key = cleaned.toLowerCase();
    if (cleaned.length < 3 || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result.slice(0, MAX_QUERIES);
}

function usablePage(text: string): boolean {
  const plain = htmlToPlainText(text);
  if (plain.length < 80) return false;
  return !/just a moment|cf-browser-verification|challenge-platform|access denied|target url returned error/i.test(plain.slice(0, 500));
}

async function readLimited(response: Response, requestedUrl: string, maxBytes: number): Promise<string | null> {
  const finalUrl = response.url || requestedUrl;
  if (!isPublicHttpUrl(finalUrl) || !response.ok || !response.body) return null;
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const next = chunk.byteLength + offset > bytes.byteLength ? chunk.subarray(0, bytes.byteLength - offset) : chunk;
    bytes.set(next, offset);
    offset += next.byteLength;
    if (offset >= bytes.byteLength) break;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchPublicText(url: string, fetchImpl: FetchLike, timeoutMs: number, maxBytes: number, headers: HeadersInit): Promise<string | null> {
  if (!isPublicHttpUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const response = await fetchImpl(url, { headers, redirect: 'follow', signal: controller.signal, cache: 'no-store' });
    return await readLimited(response, url, maxBytes);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPublicDocument(url: string, fetchImpl: FetchLike, timeoutMs: number, maxBytes: number, enableJina: boolean): Promise<string | null> {
  if (!isPublicHttpUrl(url) || isLikelyLoginWallHost(url)) return null;
  const direct = await fetchPublicText(url, fetchImpl, timeoutMs, maxBytes, {
    Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    'User-Agent': USER_AGENT,
  });
  if (direct && usablePage(direct)) return direct;
  if (!enableJina) return null;
  const wrapped = jinaReaderUrl(url);
  if (!wrapped) return null;
  const viaJina = await fetchPublicText(wrapped, fetchImpl, timeoutMs, maxBytes, { Accept: 'text/plain' });
  if (viaJina && usablePage(viaJina)) return viaJina;
  return null;
}

async function readCandidatePages(
  candidates: MarketNewsCandidate[],
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxBytes: number,
  enableJina: boolean,
): Promise<Map<string, string>> {
  const ordered = [...candidates].sort((a, b) => Number(a.gatheredVia !== 'open-web') - Number(b.gatheredVia !== 'open-web'));
  const documents = new Map<string, string>();
  await Promise.all(ordered.slice(0, MAX_PAGE_READS).map(async candidate => {
    const text = await fetchPublicDocument(candidate.url, fetchImpl, timeoutMs, maxBytes, enableJina);
    if (text) documents.set(candidate.url, text);
  }));
  return documents;
}
