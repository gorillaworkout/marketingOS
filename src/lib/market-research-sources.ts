import { createHash } from 'node:crypto';
import { COMPETITOR_BROKERS, normalizeResearchUrl } from './article-market-news';
import type { MarketNewsCandidate, MarketProductCategory } from './market-research';

export interface MarketResearchFeed {
  outlet: string;
  url: string;
}

export interface MarketResearchSourceOptions {
  feeds?: MarketResearchFeed[];
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}

export interface MarketResearchSourceResult {
  candidates: MarketNewsCandidate[];
  groupsSearched: MarketProductCategory[];
  groupCandidateCounts: Record<MarketProductCategory, number>;
  sourceStatus: Array<{ outlet: string; status: 'ok' | 'error'; candidateCount: number; error?: string }>;
}

export const MARKET_RESEARCH_GROUPS: MarketProductCategory[] = ['Forex', 'Gold', 'Oil', 'US Indices'];
export const MARKET_RESEARCH_FEEDS: MarketResearchFeed[] = [
  { outlet: 'CNBC Indonesia', url: 'https://www.cnbcindonesia.com/market/rss' },
  { outlet: 'Detik Finance', url: 'https://finance.detik.com/rss' },
  { outlet: 'ANTARA', url: 'https://www.antaranews.com/rss/ekonomi.xml' },
];

const GROUP_ALIASES: Record<MarketProductCategory, string[]> = {
  Forex: ['aud', 'cad', 'chf', 'cny', 'eur', 'gbp', 'jpy', 'nzd', 'usd', 'rupiah', 'usd idr', 'us dollar', 'dolar as'],
  Gold: ['gold', 'gold price', 'xauusd', 'xau usd', 'emas', 'harga emas'],
  Oil: ['oil', 'crude oil', 'oil price', 'wti', 'brent', 'minyak', 'harga minyak'],
  'US Indices': ['wall street', 'dow jones', 'djia', 's p 500', 'nasdaq', 'us stock index', 'indeks saham as'],
};

const DEFAULT_MAX_BYTES = 400_000;
const DEFAULT_TIMEOUT_MS = 12_000;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/\s+/g, ' ').trim();
}

function xmlField(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeXml(match?.[1] || '');
}

function normalized(value: string): string {
  return ` ${value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

function headlineMatchesGroup(title: string, group: MarketProductCategory): boolean {
  const headline = normalized(title);
  return GROUP_ALIASES[group].some(alias => headline.includes(` ${normalized(alias).trim()} `));
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
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('Publisher RSS exceeds the size limit.');
  if (!response.body) throw new Error('Publisher RSS has no response body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Publisher RSS exceeds the size limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function fetchFeed(feed: MarketResearchFeed, fetchImpl: typeof fetch, maxBytes: number, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(feed.url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'MarketingOS/1.0' },
      redirect: 'error', cache: 'no-store', signal: controller.signal,
    });
    return await readBoundedXml(response, maxBytes);
  } finally {
    clearTimeout(timer);
  }
}

function parseFeed(feed: MarketResearchFeed, xml: string, researchDate: string): MarketNewsCandidate[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const parsedItems = items.slice(0, 100).flatMap(item => {
    const title = xmlField(item, 'title');
    const description = xmlField(item, 'description') || xmlField(item, 'content:encoded');
    const link = xmlField(item, 'link') || xmlField(item, 'guid');
    const publishedAt = wibTimestamp(xmlField(item, 'pubDate') || xmlField(item, 'dc:date'));
    const rawUpdated = xmlField(item, 'updated') || xmlField(item, 'atom:updated') || xmlField(item, 'lastBuildDate');
    const parsedUpdated = rawUpdated ? wibTimestamp(rawUpdated) : null;
    const updatedAt = parsedUpdated?.slice(0, 10) === researchDate ? parsedUpdated : null;
    if (!title || !link || !publishedAt || publishedAt.slice(0, 10) !== researchDate) return [];
    if (mentionsCompetitor(`${title} ${description}`)) return [];
    try {
      const url = normalizeResearchUrl(link);
      return [{ title, description, publishedAt, updatedAt, url }];
    } catch {
      return [];
    }
  });
  const candidates = new Map<string, MarketNewsCandidate>();
  for (const group of MARKET_RESEARCH_GROUPS) {
    for (const item of parsedItems) {
      if (!headlineMatchesGroup(item.title, group)) continue;
      const existing = candidates.get(item.url);
      if (existing) {
        if (!existing.categories.includes(group)) existing.categories.push(group);
        continue;
      }
      candidates.set(item.url, {
        id: createHash('sha256').update(item.url).digest('hex').slice(0, 16),
        outlet: feed.outlet,
        title: item.title.slice(0, 300),
        url: item.url,
        publishedAt: item.publishedAt,
        updatedAt: item.updatedAt,
        categories: [group],
        evidence: `Publisher RSS headline: ${item.title}. Publisher RSS summary: ${item.description || item.title}`.slice(0, 3_000),
        evidenceLevel: 'publisher-metadata',
      });
    }
  }
  return [...candidates.values()];
}

export async function researchLatestMarketNews(researchDate: string, options: MarketResearchSourceOptions = {}): Promise<MarketResearchSourceResult> {
  const feeds = options.feeds || MARKET_RESEARCH_FEEDS;
  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const settled = await Promise.allSettled(feeds.map(async feed => parseFeed(feed, await fetchFeed(feed, fetchImpl, maxBytes, timeoutMs), researchDate)));
  const sourceStatus = settled.map((result, index) => result.status === 'fulfilled'
    ? { outlet: feeds[index].outlet, status: 'ok' as const, candidateCount: result.value.length }
    : { outlet: feeds[index].outlet, status: 'error' as const, candidateCount: 0, error: result.reason instanceof Error ? result.reason.message : 'Publisher feed failed.' });
  const unique = new Map<string, MarketNewsCandidate>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const candidate of result.value) if (!unique.has(candidate.url)) unique.set(candidate.url, candidate);
  }
  const candidates = [...unique.values()]
    .sort((a, b) => (b.updatedAt || b.publishedAt).localeCompare(a.updatedAt || a.publishedAt))
    .slice(0, 40);
  if (candidates.length === 0) throw new Error('No relevant same-day market news was found across Forex, Gold, Oil, or US Indices. Try again when publishers release a new factual update.');
  const groupCandidateCounts = Object.fromEntries(MARKET_RESEARCH_GROUPS.map(group => [group, candidates.filter(candidate => candidate.categories.includes(group)).length])) as Record<MarketProductCategory, number>;
  return { candidates, groupsSearched: [...MARKET_RESEARCH_GROUPS], groupCandidateCounts, sourceStatus };
}
