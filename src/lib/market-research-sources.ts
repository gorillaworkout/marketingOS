import { createHash } from 'node:crypto';
import { COMPETITOR_BROKERS, normalizeResearchUrl } from './article-market-news';
import type { MarketNewsCandidate, MarketProductCategory } from './market-research';

export type MarketResearchOrigin = 'indonesia' | 'international';

export interface MarketResearchFeed {
  outlet: string;
  url: string;
  origin: MarketResearchOrigin;
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

export const MARKET_RESEARCH_GROUPS: MarketProductCategory[] = ['Forex', 'Commodity', 'US Indices', 'US Stocks'];

/** Sharpened instrument list. One article may only speak for one of these symbols. */
export const MARKET_RESEARCH_SYMBOLS = {
  Forex: ['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'NZD', 'USD', 'IDR'],
  Commodity: ['XAUUSD', 'WTI'],
  'US Indices': ['DJIA', 'SPX', 'NDX'],
  'US Stocks': ['US Stocks'],
} as const satisfies Record<MarketProductCategory, readonly string[]>;

export const MARKET_RESEARCH_FEEDS: MarketResearchFeed[] = [
  { outlet: 'Reuters Markets', url: 'https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best', origin: 'international' },
  { outlet: 'CNBC Economy', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258', origin: 'international' },
  { outlet: 'CNBC Markets', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', origin: 'international' },
  { outlet: 'MarketWatch Top Stories', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', origin: 'international' },
  { outlet: 'Federal Reserve Press', url: 'https://www.federalreserve.gov/feeds/press_all.xml', origin: 'international' },
  { outlet: 'Investing.com Economy', url: 'https://www.investing.com/rss/news_14.rss', origin: 'international' },
  { outlet: 'Investing.com Commodities', url: 'https://www.investing.com/rss/news_11.rss', origin: 'international' },
  { outlet: 'CNBC Indonesia', url: 'https://www.cnbcindonesia.com/market/rss', origin: 'indonesia' },
  { outlet: 'Detik Finance', url: 'https://finance.detik.com/rss', origin: 'indonesia' },
];

/**
 * Retail-gold pricing (Antam/Pegadaian) is a shop price list, not a market event.
 * It must never enter the XAUUSD stream.
 */
const RETAIL_GOLD_MARKERS = ['antam', 'pegadaian', 'logam mulia', 'butik emas', 'emas batangan'];

const SYMBOL_ALIASES: Record<string, string[]> = {
  AUD: ['aud', 'aussie dollar', 'australian dollar', 'audusd', 'rba'],
  CAD: ['cad', 'canadian dollar', 'usdcad', 'loonie', 'bank of canada'],
  CHF: ['chf', 'swiss franc', 'usdchf', 'snb'],
  EUR: ['eur', 'euro', 'eurusd', 'ecb', 'euro zone', 'eurozone'],
  GBP: ['gbp', 'sterling', 'pound', 'gbpusd', 'bank of england', 'boe'],
  JPY: ['jpy', 'yen', 'usdjpy', 'bank of japan', 'boj'],
  NZD: ['nzd', 'kiwi dollar', 'new zealand dollar', 'nzdusd', 'rbnz'],
  USD: ['usd', 'dollar', 'dollar index', 'dxy', 'greenback', 'federal reserve', 'fed', 'fomc', 'treasury'],
  IDR: ['idr', 'rupiah', 'usdidr', 'bank indonesia'],
  XAUUSD: ['xauusd', 'xau usd', 'xau', 'gold', 'bullion', 'emas'],
  WTI: ['wti', 'us oil', 'crude', 'crude oil', 'oil price', 'opec', 'minyak'],
  DJIA: ['djia', 'dow jones', 'dow'],
  SPX: ['spx', 's p 500', 'sp 500', 's and p 500'],
  NDX: ['ndx', 'nasdaq 100', 'nasdaq'],
  'US Stocks': ['us stocks', 'wall street', 'earnings', 'shares of', 'stock jumped', 'stock fell'],
};

/** High Importance economic categories the SOP accepts. */
const IMPORTANCE_CATEGORIES: Record<string, string[]> = {
  Employment: ['payroll', 'nonfarm', 'non farm', 'unemployment', 'jobless', 'employment', 'jobs report', 'hiring', 'layoff'],
  Growth: ['gdp', 'gross domestic product', 'growth', 'recession', 'industrial production', 'retail sales'],
  Inflation: ['inflation', 'cpi', 'ppi', 'pce', 'consumer price', 'producer price', 'deflation'],
  'Central Bank': ['fed', 'fomc', 'federal reserve', 'ecb', 'boj', 'bank of japan', 'boe', 'bank of england', 'rba', 'rbnz', 'snb', 'bank indonesia', 'bank of canada', 'interest rate', 'rate decision', 'rate cut', 'rate hike', 'monetary policy', 'suku bunga'],
  Bonds: ['bond', 'yield', 'treasury', 'auction', 'sovereign debt', 'obligasi'],
  Housing: ['housing', 'home sales', 'building permits', 'housing starts', 'mortgage'],
  'Consumer Surveys': ['consumer confidence', 'consumer sentiment', 'michigan sentiment', 'consumer survey'],
  'Business Surveys': ['pmi', 'ism', 'business confidence', 'manufacturing survey', 'services survey', 'business survey', 'tankan'],
  Speeches: ['speech', 'testimony', 'remarks', 'press conference', 'said in a speech', 'told lawmakers', 'powell', 'governor said'],
};

/** Speculation is not a confirmed high-impact development. */
const SPECULATION_MARKERS = ['predict', 'forecast to', 'could reach', 'may hit', 'analyst says', 'outlook for', 'prediksi', 'diperkirakan'];


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

/**
 * Map a headline to the exact instruments it speaks for.
 * Retail-gold price lists are dropped: they are not tradable-market events.
 */
export function classifySymbols(title: string): string[] {
  const headline = normalized(title);
  const isRetailGold = RETAIL_GOLD_MARKERS.some(marker => headline.includes(` ${normalized(marker).trim()} `));
  const matched: string[] = [];
  for (const [symbol, aliases] of Object.entries(SYMBOL_ALIASES)) {
    if (symbol === 'XAUUSD' && isRetailGold) continue;
    if (aliases.some(alias => headline.includes(` ${normalized(alias).trim()} `))) matched.push(symbol);
  }
  // Precedence: a specific instrument wins over the generic USD / "US Stocks"
  // buckets, so "Gold XAU/USD after CPI" is XAUUSD only — not XAUUSD + USD.
  const specific = matched.filter(symbol => symbol !== 'USD' && symbol !== 'US Stocks');
  return specific.length > 0 ? specific : matched;
}

export function importanceCategoryOf(title: string): string | null {
  const headline = normalized(title);
  if (SPECULATION_MARKERS.some(marker => headline.includes(` ${normalized(marker).trim()} `))) return null;
  for (const [category, keywords] of Object.entries(IMPORTANCE_CATEGORIES)) {
    if (keywords.some(keyword => headline.includes(` ${normalized(keyword).trim()} `))) return category;
  }
  return null;
}

export function isHighImportanceHeadline(title: string): boolean {
  return importanceCategoryOf(title) !== null;
}

/** At most ONE Indonesian-origin article may reach the selection pool. */
export function limitIndonesianOrigin<T extends { origin: MarketResearchOrigin }>(rows: T[]): T[] {
  let indonesian = 0;
  return rows.filter(row => {
    if (row.origin !== 'indonesia') return true;
    indonesian += 1;
    return indonesian === 1;
  });
}

export function categoryOfSymbol(symbol: string): MarketProductCategory | null {
  for (const [category, symbols] of Object.entries(MARKET_RESEARCH_SYMBOLS)) {
    if ((symbols as readonly string[]).includes(symbol)) return category as MarketProductCategory;
  }
  return null;
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

  const candidates: MarketNewsCandidate[] = [];
  const seen = new Set<string>();
  for (const item of parsedItems) {
    if (seen.has(item.url)) continue;
    // Headline-level gates: exact instrument AND High Importance category.
    const symbols = classifySymbols(item.title);
    if (symbols.length === 0) continue;
    const importanceCategory = importanceCategoryOf(item.title);
    if (!importanceCategory) continue;
    const categories = [...new Set(symbols.map(categoryOfSymbol).filter((value): value is MarketProductCategory => value !== null))];
    if (categories.length === 0) continue;
    seen.add(item.url);
    candidates.push({
      id: createHash('sha256').update(item.url).digest('hex').slice(0, 16),
      outlet: feed.outlet,
      title: item.title.slice(0, 300),
      url: item.url,
      publishedAt: item.publishedAt,
      updatedAt: item.updatedAt,
      categories,
      symbols,
      origin: feed.origin,
      importanceCategory,
      evidence: `Publisher RSS headline: ${item.title}. Publisher RSS summary: ${item.description || item.title}`.slice(0, 3_000),
      evidenceLevel: 'publisher-metadata',
    });
  }
  return candidates;
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
  const ranked = [...unique.values()]
    .sort((a, b) => (b.updatedAt || b.publishedAt).localeCompare(a.updatedAt || a.publishedAt));
  // One Indonesian-origin article maximum; the rest must come from foreign media.
  const candidates = limitIndonesianOrigin(ranked).slice(0, 60);
  if (candidates.length === 0) throw new Error('No relevant same-day high-importance market news was found across Forex, Commodity, US Indices, or US Stocks. Try again when publishers release a new factual update.');
  const groupCandidateCounts = Object.fromEntries(MARKET_RESEARCH_GROUPS.map(group => [group, candidates.filter(candidate => candidate.categories.includes(group)).length])) as Record<MarketProductCategory, number>;
  return { candidates, groupsSearched: [...MARKET_RESEARCH_GROUPS], groupCandidateCounts, sourceStatus };
}
