import { COMPETITOR_BROKERS, normalizeResearchUrl, type ArticleSourceInput } from './article-market-news';

export interface ResearchFeed {
  outlet: string;
  url: string;
}

export interface ArticleResearchOptions {
  feeds?: ResearchFeed[];
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}

export const ARTICLE_RESEARCH_FEEDS: ResearchFeed[] = [
  { outlet: 'CNBC Indonesia', url: 'https://www.cnbcindonesia.com/market/rss' },
  { outlet: 'Detik Finance', url: 'https://finance.detik.com/rss' },
  { outlet: 'ANTARA', url: 'https://www.antaranews.com/rss/ekonomi.xml' },
];

const DEFAULT_MAX_BYTES = 400_000;
const DEFAULT_TIMEOUT_MS = 12_000;

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

function isRelevant(keyword: string, title: string): boolean {
  const headline = normalized(title);
  return keywordTokens(keyword).some(token => headline.includes(token));
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

async function fetchFeed(feed: ResearchFeed, fetchImpl: typeof fetch, maxBytes: number, timeoutMs: number): Promise<string> {
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

export async function researchArticleMarketNews(
  keyword: string,
  researchDate: string,
  options: ArticleResearchOptions = {},
): Promise<ArticleSourceInput[]> {
  const feeds = options.feeds || ARTICLE_RESEARCH_FEEDS;
  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
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
  const sources = [...unique.values()].slice(0, 5);
  if (sources.length === 0) {
    throw new Error('No relevant same-day publisher research was found. Try a more specific eligible keyword or generate again when new market coverage is available.');
  }
  return sources;
}
