import {
  extractFetchedContent,
  htmlToPlainText,
  isDuckDuckGoAnomalyPage,
  isLikelyLoginWallHost,
  isPublicHttpUrl,
  jinaReaderUrl,
  parseDuckDuckGoResults,
  resolveSearchApiKeys,
  searchSerper,
} from './ai-research-grounding';
import { COMPETITOR_BROKERS, normalizeResearchUrl, type ArticleSourceInput } from './article-market-news';

/**
 * Article Market News gather: same-day publisher RSS, plus open-web Serper
 * (DuckDuckGo HTML if Serper is missing or empty) and full-page reads
 * (direct fetch, then Jina Reader). Live Serper calls need SERPER_API_KEY.
 * Unit tests mock fetch and do not need a local .env.
 */

export interface ResearchFeed {
  outlet: string;
  url: string;
}

export interface ArticleResearchOptions {
  feeds?: ResearchFeed[];
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
  angle?: string;
  serperApiKey?: string;
  enableJina?: boolean;
  /** Publisher RSS only. Default is RSS plus open-web gather. */
  enableOpenWeb?: boolean;
  onProgress?: (message: string) => void;
}

export const ARTICLE_RESEARCH_FEEDS: ResearchFeed[] = [
  { outlet: 'CNBC Indonesia', url: 'https://www.cnbcindonesia.com/market/rss' },
  { outlet: 'Detik Finance', url: 'https://finance.detik.com/rss' },
  { outlet: 'ANTARA', url: 'https://www.antaranews.com/rss/ekonomi.xml' },
];

export const OPEN_WEB_PAGE_EVIDENCE_PREFIX = 'Open-web full-page excerpt';
export const OPEN_WEB_SNIPPET_EVIDENCE_PREFIX = 'Open-web search snippet';

export const ARTICLE_RESEARCH_EMPTY_MESSAGE =
  'No grounded market research was found in publisher feeds or on the open web. Try a more specific eligible keyword, or add an optional reference you have already checked.';

const RSS_ONLY_EMPTY_MESSAGE =
  'No relevant same-day publisher research was found. Try a more specific eligible keyword or generate again when new market coverage is available.';

const DEFAULT_MAX_BYTES = 400_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const OPEN_WEB_TIMEOUT_MS = 8_000;
const MAX_SOURCES = 5;
const MAX_QUERIES = 3;
const MAX_PAGE_FETCHES = 3;
const MIN_SNIPPET = 40;
const RSS_RICH_COUNT = 2;
const MAX_EXCERPT = 4_500;

const PAGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type FetchLike = typeof fetch;

type WebCandidate = {
  url: string;
  title: string;
  snippet: string;
  query: string;
};

export function buildArticleMarketNewsSearchQueries(input: {
  keyword: string;
  researchDate: string;
  angle?: string;
}): string[] {
  const keyword = input.keyword.replace(/\s+/g, ' ').trim();
  if (keyword.length < 2) return [];
  const angle = (input.angle || '').replace(/\s+/g, ' ').trim();
  const angleTopic = angle.split(/[.!?\n]/)[0]?.trim().slice(0, 120) || '';
  const queries = [
    `${keyword} ${input.researchDate}`.trim(),
    angleTopic ? `${keyword} ${angleTopic}` : `${keyword} berita pasar`,
    `${keyword} harga pasar Indonesia`,
  ];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const query of queries) {
    const cleaned = query.replace(/\s+/g, ' ').trim().slice(0, 180);
    const key = cleaned.toLowerCase();
    if (cleaned.length < 3 || seen.has(key)) continue;
    seen.add(key);
    unique.push(cleaned);
  }
  return unique.slice(0, MAX_QUERIES);
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlField(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeXml(match?.[1] || '');
}

function normalized(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function keywordTokens(keyword: string): string[] {
  const stopWords = new Set(['harga', 'hari', 'ini', 'terbaru', 'market', 'pasar']);
  const tokens = normalized(keyword).split(' ').filter(token => token.length >= 2 && !stopWords.has(token));
  return tokens.length > 0 ? tokens : normalized(keyword).split(' ').filter(Boolean);
}

function isRelevant(keyword: string, text: string): boolean {
  const haystack = normalized(text);
  return keywordTokens(keyword).some(token => haystack.includes(token));
}

function mentionsCompetitor(value: string): boolean {
  const haystack = normalized(value).replaceAll(' ', '');
  return COMPETITOR_BROKERS.some(broker => haystack.includes(normalized(broker).replaceAll(' ', '')));
}

function wibTimestamp(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function citationTimestamp(raw: string, researchDate: string): string {
  const candidates = [
    raw.match(/Published Time:\s*([^\n\r]+)/i)?.[1],
    raw.match(/article:published_time["'][^>]*content=["']([^"']+)/i)?.[1]
      || raw.match(/content=["']([^"']+)["'][^>]*article:published_time/i)?.[1],
    raw.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1],
  ];
  for (const value of candidates) {
    if (!value) continue;
    const timestamp = wibTimestamp(value.trim());
    if (timestamp) return timestamp;
  }
  return `${researchDate}T00:00`;
}

async function readBoundedXml(response: Response, maxBytes: number): Promise<string> {
  if (!response.ok) throw new Error(`Publisher RSS returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (!contentType.includes('xml') && !contentType.includes('rss')) throw new Error('Publisher response is not XML/RSS.');
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > maxBytes) throw new Error('Publisher RSS response exceeds the size limit.');
  if (!response.body) throw new Error('Publisher RSS response has no body.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Publisher RSS response exceeds the size limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchFeed(feed: ResearchFeed, fetchImpl: FetchLike, maxBytes: number, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(feed.url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'MarketingOS/1.0' },
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    });
    return await readBoundedXml(response, maxBytes);
  } finally {
    clearTimeout(timer);
  }
}

function parseFeed(feed: ResearchFeed, xml: string, keyword: string, researchDate: string): ArticleSourceInput[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const sources: ArticleSourceInput[] = [];
  for (const item of items.slice(0, 80)) {
    const title = xmlField(item, 'title');
    const description = xmlField(item, 'description') || xmlField(item, 'content:encoded');
    const link = xmlField(item, 'link') || xmlField(item, 'guid');
    const publishedAt = wibTimestamp(xmlField(item, 'pubDate'));
    if (!title || !link || !publishedAt || publishedAt.slice(0, 10) !== researchDate) continue;
    if (!isRelevant(keyword, title) || mentionsCompetitor(`${title} ${description}`)) continue;
    try {
      sources.push({
        outlet: feed.outlet,
        title: title.slice(0, 300),
        url: normalizeResearchUrl(link),
        publishedAt,
        verifiedFacts: `Publisher RSS headline: ${title}. Publisher RSS summary: ${description || title}`.slice(0, 5_000),
        provenance: 'automated',
      });
    } catch {
      // Skip malformed publisher links; feed endpoints themselves remain fixed and allowlisted.
    }
  }
  return sources;
}

async function gatherPublisherFeeds(
  keyword: string,
  researchDate: string,
  feeds: ResearchFeed[],
  fetchImpl: FetchLike,
  maxBytes: number,
  timeoutMs: number,
): Promise<ArticleSourceInput[]> {
  const results = await Promise.allSettled(feeds.map(async feed => parseFeed(
    feed,
    await fetchFeed(feed, fetchImpl, maxBytes, timeoutMs),
    keyword,
    researchDate,
  )));
  const unique = new Map<string, ArticleSourceInput>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const source of result.value) if (!unique.has(source.url)) unique.set(source.url, source);
  }
  return [...unique.values()];
}

function isSearchEngineHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'serper.dev' || host.endsWith('.serper.dev')
      || host === 'jina.ai' || host.endsWith('.jina.ai')
      || host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')
      || host === 'google.com' || host.endsWith('.google.com')
      || host === 'bing.com' || host.endsWith('.bing.com');
  } catch {
    return true;
  }
}

function outletFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').slice(0, 120);
  } catch {
    return 'Open web';
  }
}

async function readLimitedPublicBody(
  response: Response,
  requestedUrl: string,
  maxBytes: number,
): Promise<string | null> {
  const finalUrl = response.url || requestedUrl;
  if (!isPublicHttpUrl(finalUrl)) return null;
  if (!response.ok) return null;
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return (await response.text()).slice(0, maxBytes);
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

async function fetchPublicText(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxBytes: number,
  headers: HeadersInit,
): Promise<string | null> {
  if (!isPublicHttpUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const response = await fetchImpl(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    });
    return await readLimitedPublicBody(response, url, maxBytes);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function usablePage(text: string): boolean {
  const plain = htmlToPlainText(text);
  if (plain.length < 80) return false;
  return !/just a moment|cf-browser-verification|challenge-platform|access denied|target url returned error/i.test(plain.slice(0, 500));
}

async function fetchPublicDocument(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxBytes: number,
  enableJina: boolean,
): Promise<string | null> {
  if (!isPublicHttpUrl(url) || isLikelyLoginWallHost(url) || isSearchEngineHost(url)) return null;
  const direct = await fetchPublicText(url, fetchImpl, timeoutMs, maxBytes, {
    Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    'User-Agent': PAGE_USER_AGENT,
  });
  if (direct && usablePage(direct)) return direct;
  if (!enableJina) return null;
  const wrapped = jinaReaderUrl(url);
  if (!wrapped) return null;
  const viaJina = await fetchPublicText(wrapped, fetchImpl, timeoutMs, maxBytes, { Accept: 'text/plain' });
  if (viaJina && usablePage(viaJina)) return viaJina;
  return null;
}

function acceptWebCandidate(candidate: WebCandidate): WebCandidate | null {
  if (!isPublicHttpUrl(candidate.url) || isLikelyLoginWallHost(candidate.url) || isSearchEngineHost(candidate.url)) return null;
  try {
    return { ...candidate, url: normalizeResearchUrl(candidate.url) };
  } catch {
    return null;
  }
}

async function serperCandidates(
  queries: string[],
  fetchImpl: FetchLike,
  serperKey: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<WebCandidate[]> {
  const found: WebCandidate[] = [];
  const seen = new Set<string>();
  const settled = await Promise.allSettled(
    queries.map(query => searchSerper(query, serperKey, fetchImpl, maxBytes, timeoutMs)),
  );
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    for (const source of result.value.sources) {
      const candidate = acceptWebCandidate({
        url: source.url,
        title: source.title,
        snippet: source.snippet,
        query: queries[index] || queries[0] || '',
      });
      if (!candidate || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      found.push(candidate);
    }
  });
  return found;
}

async function duckDuckGoCandidates(
  queries: string[],
  fetchImpl: FetchLike,
  maxBytes: number,
  timeoutMs: number,
): Promise<WebCandidate[]> {
  const found: WebCandidate[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchPublicText(url, fetchImpl, timeoutMs, maxBytes, {
      Accept: 'text/html',
      'User-Agent': PAGE_USER_AGENT,
    });
    if (!html || isDuckDuckGoAnomalyPage(html)) continue;
    for (const result of parseDuckDuckGoResults(html)) {
      const candidate = acceptWebCandidate({
        url: result.url,
        title: result.title,
        snippet: result.snippet,
        query,
      });
      if (!candidate || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      found.push(candidate);
    }
    if (found.length >= MAX_SOURCES) break;
  }
  return found;
}

function relevantCandidates(keyword: string, candidates: WebCandidate[]): WebCandidate[] {
  return candidates.filter(candidate => {
    const haystack = `${candidate.url} ${candidate.title} ${candidate.snippet}`;
    return isRelevant(keyword, `${candidate.title} ${candidate.snippet}`) && !mentionsCompetitor(haystack);
  });
}

function openWebSource(
  candidate: WebCandidate,
  keyword: string,
  researchDate: string,
  raw: string | null,
): ArticleSourceInput | null {
  const extracted = raw ? extractFetchedContent(raw, candidate.query || keyword) : { title: '', snippet: '' };
  const pageExcerpt = extracted.snippet.replace(/\s+/g, ' ').trim();
  const searchExcerpt = candidate.snippet.replace(/\s+/g, ' ').trim();
  const pageRead = pageExcerpt.length >= MIN_SNIPPET;
  const excerpt = (pageRead ? pageExcerpt : searchExcerpt).slice(0, MAX_EXCERPT);
  const title = (extracted.title || candidate.title || candidate.url).replace(/\s+/g, ' ').trim().slice(0, 300);
  const haystack = `${title} ${excerpt}`;
  if (excerpt.length < MIN_SNIPPET) return null;
  if (!isRelevant(keyword, haystack) || mentionsCompetitor(`${candidate.url} ${haystack}`)) return null;
  let url = candidate.url;
  try {
    url = normalizeResearchUrl(candidate.url);
  } catch {
    return null;
  }
  const publishedAt = pageRead && raw ? citationTimestamp(raw, researchDate) : `${researchDate}T00:00`;
  const publicationNote = pageRead && publishedAt !== `${researchDate}T00:00`
    ? 'Publication time was taken from the page.'
    : 'Publication time was not stated on the page. Cite the research date as the gather date and do not invent a clock time.';
  const prefix = pageRead ? OPEN_WEB_PAGE_EVIDENCE_PREFIX : OPEN_WEB_SNIPPET_EVIDENCE_PREFIX;
  const outlet = outletFromUrl(url);
  return {
    outlet,
    title: title || outlet,
    url,
    publishedAt,
    verifiedFacts: `${prefix} from ${outlet}. ${publicationNote} ${excerpt}`.replace(/\s+/g, ' ').trim().slice(0, 5_000),
    provenance: 'automated',
  };
}

async function gatherOpenWeb(input: {
  keyword: string;
  researchDate: string;
  angle?: string;
  fetchImpl: FetchLike;
  serperKey: string;
  maxBytes: number;
  timeoutMs: number;
  enableJina: boolean;
  onProgress?: (message: string) => void;
}): Promise<ArticleSourceInput[]> {
  const queries = buildArticleMarketNewsSearchQueries(input);
  if (!queries.length) return [];
  let candidates: WebCandidate[] = [];
  if (input.serperKey) {
    candidates = relevantCandidates(
      input.keyword,
      await serperCandidates(queries, input.fetchImpl, input.serperKey, input.maxBytes, input.timeoutMs),
    );
  }
  if (!candidates.length) {
    candidates = relevantCandidates(
      input.keyword,
      await duckDuckGoCandidates(queries, input.fetchImpl, input.maxBytes, input.timeoutMs),
    );
  }
  if (!candidates.length) return [];

  input.onProgress?.('Reading source pages...');
  const toRead = candidates.slice(0, MAX_PAGE_FETCHES);
  const documents = new Map<string, string>();
  await Promise.all(toRead.map(async candidate => {
    const text = await fetchPublicDocument(candidate.url, input.fetchImpl, input.timeoutMs, input.maxBytes, input.enableJina);
    if (text) documents.set(candidate.url, text);
  }));

  const sources: ArticleSourceInput[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const source = openWebSource(candidate, input.keyword, input.researchDate, documents.get(candidate.url) || null);
    if (!source || seen.has(source.url)) continue;
    seen.add(source.url);
    sources.push(source);
  }
  return sources;
}

function mergeSources(rssSources: ArticleSourceInput[], webSources: ArticleSourceInput[]): ArticleSourceInput[] {
  const pageReads = webSources.filter(source => source.verifiedFacts.startsWith(OPEN_WEB_PAGE_EVIDENCE_PREFIX));
  const snippets = webSources.filter(source => source.verifiedFacts.startsWith(OPEN_WEB_SNIPPET_EVIDENCE_PREFIX));
  const picked: ArticleSourceInput[] = [];
  const seen = new Set<string>();
  const push = (source: ArticleSourceInput) => {
    if (seen.has(source.url) || picked.length >= MAX_SOURCES) return;
    seen.add(source.url);
    picked.push(source);
  };
  for (const source of pageReads) push(source);
  for (const source of rssSources) push(source);
  for (const source of snippets) push(source);
  return picked;
}

export async function researchArticleMarketNews(
  keyword: string,
  researchDate: string,
  options: ArticleResearchOptions = {},
): Promise<ArticleSourceInput[]> {
  const feeds = options.feeds || ARTICLE_RESEARCH_FEEDS;
  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const enableOpenWeb = options.enableOpenWeb !== false;
  const enableJina = options.enableJina !== false;
  const serperKey = options.serperApiKey !== undefined ? options.serperApiKey.trim() : resolveSearchApiKeys().serper;
  const openWebTimeout = Math.min(timeoutMs, OPEN_WEB_TIMEOUT_MS);

  options.onProgress?.('Searching publisher feeds...');
  const rssPromise = gatherPublisherFeeds(keyword, researchDate, feeds, fetchImpl, maxBytes, timeoutMs);
  if (enableOpenWeb && serperKey) options.onProgress?.('Searching the open web for sources...');
  const webPromise = enableOpenWeb && serperKey
    ? gatherOpenWeb({
      keyword,
      researchDate,
      angle: options.angle,
      fetchImpl,
      serperKey,
      maxBytes,
      timeoutMs: openWebTimeout,
      enableJina,
      onProgress: options.onProgress,
    })
    : Promise.resolve([]);

  const rssSources = await rssPromise;
  let webSources = await webPromise;
  if (enableOpenWeb && !serperKey && rssSources.length < RSS_RICH_COUNT) {
    options.onProgress?.('Searching the open web for sources...');
    webSources = await gatherOpenWeb({
      keyword,
      researchDate,
      angle: options.angle,
      fetchImpl,
      serperKey: '',
      maxBytes,
      timeoutMs: openWebTimeout,
      enableJina,
      onProgress: options.onProgress,
    });
  }

  const sources = mergeSources(rssSources, webSources);
  if (sources.length === 0) {
    if (!enableOpenWeb) throw new Error(RSS_ONLY_EMPTY_MESSAGE);
    if (!serperKey) {
      throw new Error(`${ARTICLE_RESEARCH_EMPTY_MESSAGE} SERPER_API_KEY is not set, so open-web search used public pages only.`);
    }
    throw new Error(ARTICLE_RESEARCH_EMPTY_MESSAGE);
  }
  return sources;
}
