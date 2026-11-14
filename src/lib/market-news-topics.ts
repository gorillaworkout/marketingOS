/**
 * Article Market News topics and the symbols the existing market-news catalog can match.
 * The catalog list mirrors MARKET_RESEARCH_SYMBOLS. A topic whose symbol is absent
 * uses the article feature's web and news research with the research-tier model.
 */

export const MARKET_NEWS_CATALOG_SYMBOLS = [
  'AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'NZD', 'USD', 'IDR',
  'XAUUSD', 'WTI',
  'DJIA', 'SPX', 'NDX',
  'US Stocks',
] as const;

export const MARKET_NEWS_CATEGORIES = ['Metals', 'Stocks', 'Stock Indices', 'Forex', 'Existing'] as const;
export type MarketNewsCategory = (typeof MARKET_NEWS_CATEGORIES)[number];
export type MarketNewsCoverage = 'catalog' | 'research-fallback';

export type MarketNewsTopic = {
  id: string;
  category: MarketNewsCategory;
  label: string;
  instrumentName: string;
  keyword: string;
  symbols: readonly string[];
  aliases: readonly string[];
  promptContext: string;
};

export const MARKET_NEWS_TOPICS: readonly MarketNewsTopic[] = [
  {
    id: 'gold',
    category: 'Metals',
    label: 'Gold',
    instrumentName: 'XAU/USD (gold)',
    keyword: 'harga emas',
    symbols: ['XAUUSD'],
    aliases: ['emas', 'harga emas', 'xauusd', 'xau/usd', 'gold'],
    promptContext: 'Explain the move through safe-haven demand, real yields, and the US dollar. Do not describe Antam, Pegadaian, or other retail shop prices.',
  },
  {
    id: 'silver',
    category: 'Metals',
    label: 'Silver',
    instrumentName: 'XAG/USD (silver)',
    keyword: 'harga perak',
    symbols: ['XAGUSD'],
    aliases: ['perak', 'harga perak', 'xagusd', 'xag/usd', 'silver'],
    promptContext: 'Explain the move through industrial demand and how silver is trading against gold. Do not invent a live quote.',
  },
  {
    id: 'tesla',
    category: 'Stocks',
    label: 'Tesla',
    instrumentName: 'Tesla (TSLA)',
    keyword: 'Tesla (TSLA)',
    symbols: ['TSLA'],
    aliases: ['tesla', 'tsla'],
    promptContext: 'Focus on earnings, deliveries, and guidance. Name the company Tesla and the ticker TSLA.',
  },
  {
    id: 'apple',
    category: 'Stocks',
    label: 'Apple',
    instrumentName: 'Apple (AAPL)',
    keyword: 'Apple (AAPL)',
    symbols: ['AAPL'],
    aliases: ['apple', 'aapl'],
    promptContext: 'Focus on earnings, product demand, and guidance. Name the company Apple and the ticker AAPL.',
  },
  {
    id: 'microsoft',
    category: 'Stocks',
    label: 'Microsoft',
    instrumentName: 'Microsoft (MSFT)',
    keyword: 'Microsoft (MSFT)',
    symbols: ['MSFT'],
    aliases: ['microsoft', 'msft'],
    promptContext: 'Focus on earnings, cloud demand, and guidance. Name the company Microsoft and the ticker MSFT.',
  },
  {
    id: 'nvidia',
    category: 'Stocks',
    label: 'Nvidia',
    instrumentName: 'Nvidia (NVDA)',
    keyword: 'Nvidia (NVDA)',
    symbols: ['NVDA'],
    aliases: ['nvidia', 'nvda'],
    promptContext: 'Focus on earnings, data-center demand, and guidance. Name the company Nvidia and the ticker NVDA.',
  },
  {
    id: 'amazon',
    category: 'Stocks',
    label: 'Amazon',
    instrumentName: 'Amazon (AMZN)',
    keyword: 'Amazon (AMZN)',
    symbols: ['AMZN'],
    aliases: ['amazon', 'amzn'],
    promptContext: 'Focus on earnings, retail and cloud demand, and guidance. Name the company Amazon and the ticker AMZN.',
  },
  {
    id: 'meta',
    category: 'Stocks',
    label: 'Meta',
    instrumentName: 'Meta Platforms (META)',
    keyword: 'Meta Platforms (META)',
    symbols: ['META'],
    aliases: ['meta platforms', 'meta (meta)', 'ticker meta'],
    promptContext: 'Focus on earnings, advertising demand, and guidance. Name the company Meta Platforms and the ticker META.',
  },
  {
    id: 'alphabet',
    category: 'Stocks',
    label: 'Alphabet',
    instrumentName: 'Alphabet (GOOGL)',
    keyword: 'Alphabet (GOOGL)',
    symbols: ['GOOGL'],
    aliases: ['alphabet', 'googl', 'google'],
    promptContext: 'Focus on earnings, advertising and cloud demand, and guidance. Name the company Alphabet and the ticker GOOGL.',
  },
  {
    id: 'spx',
    category: 'Stock Indices',
    label: 'S&P 500',
    instrumentName: 'S&P 500 (SPX)',
    keyword: 'S&P 500',
    symbols: ['SPX'],
    aliases: ['s&p 500', 'spx', 's p 500', 'sp 500'],
    promptContext: 'Explain the index move through broad US equity risk sentiment. Name it S&P 500, not a single stock.',
  },
  {
    id: 'nasdaq',
    category: 'Stock Indices',
    label: 'NASDAQ',
    instrumentName: 'NASDAQ (NDX)',
    keyword: 'NASDAQ',
    symbols: ['NDX'],
    aliases: ['nasdaq', 'ndx', 'nasdaq 100'],
    promptContext: 'Explain the index move through large-cap technology risk sentiment. Name it NASDAQ, not a single stock.',
  },
  {
    id: 'dow',
    category: 'Stock Indices',
    label: 'Dow Jones',
    instrumentName: 'Dow Jones Industrial Average (DJIA)',
    keyword: 'Dow Jones',
    symbols: ['DJIA'],
    aliases: ['dow jones', 'djia'],
    promptContext: 'Explain the index move through blue-chip US equity risk sentiment. Name it Dow Jones, not a single stock.',
  },
  {
    id: 'usdjpy',
    category: 'Forex',
    label: 'USD/JPY',
    instrumentName: 'USD/JPY',
    keyword: 'USD/JPY',
    symbols: ['USD', 'JPY'],
    aliases: ['usd/jpy', 'usdjpy', 'dollar yen'],
    promptContext: 'Explain the pair through Federal Reserve and Bank of Japan policy. Name the instrument USD/JPY.',
  },
  {
    id: 'gbpusd',
    category: 'Forex',
    label: 'GBP/USD',
    instrumentName: 'GBP/USD',
    keyword: 'GBP/USD',
    symbols: ['GBP', 'USD'],
    aliases: ['gbp/usd', 'gbpusd', 'sterling dollar'],
    promptContext: 'Explain the pair through Bank of England and Federal Reserve policy. Name the instrument GBP/USD.',
  },
  {
    id: 'eurusd',
    category: 'Forex',
    label: 'EUR/USD',
    instrumentName: 'EUR/USD',
    keyword: 'EUR/USD',
    symbols: ['EUR', 'USD'],
    aliases: ['eur/usd', 'eurusd', 'euro dollar'],
    promptContext: 'Explain the pair through European Central Bank and Federal Reserve policy. Name the instrument EUR/USD.',
  },
  {
    id: 'audusd',
    category: 'Forex',
    label: 'AUD/USD',
    instrumentName: 'AUD/USD',
    keyword: 'AUD/USD',
    symbols: ['AUD', 'USD'],
    aliases: ['aud/usd', 'audusd', 'aussie dollar'],
    promptContext: 'Explain the pair through Reserve Bank of Australia and Federal Reserve policy. Name the instrument AUD/USD.',
  },
  {
    id: 'usdidr',
    category: 'Forex',
    label: 'USD/IDR',
    instrumentName: 'USD/IDR',
    keyword: 'USD/IDR',
    symbols: ['USD', 'IDR'],
    aliases: ['usd/idr', 'usdidr'],
    promptContext: 'Explain the pair through Bank Indonesia and Federal Reserve policy. Name the instrument USD/IDR.',
  },
  {
    id: 'oil',
    category: 'Existing',
    label: 'Oil',
    instrumentName: 'WTI crude oil',
    keyword: 'harga minyak',
    symbols: ['WTI'],
    aliases: ['minyak', 'harga minyak', 'wti', 'crude oil'],
    promptContext: 'Explain the move through OPEC supply and inventories. Name the instrument WTI crude oil.',
  },
  {
    id: 'rupiah',
    category: 'Existing',
    label: 'Rupiah',
    instrumentName: 'USD/IDR (rupiah)',
    keyword: 'rupiah',
    symbols: ['IDR'],
    aliases: ['rupiah'],
    promptContext: 'Explain rupiah moves through Bank Indonesia policy and the US dollar. Name the instrument USD/IDR when a pair is discussed.',
  },
  {
    id: 'dollar',
    category: 'Existing',
    label: 'US dollar',
    instrumentName: 'US dollar (USD)',
    keyword: 'dolar',
    symbols: ['USD'],
    aliases: ['dollar', 'dolar', 'dolar as'],
    promptContext: 'Explain the dollar through Federal Reserve policy. Name it the US dollar, not a single stock.',
  },
  {
    id: 'wall-street',
    category: 'Existing',
    label: 'Wall Street',
    instrumentName: 'Wall Street (US stocks)',
    keyword: 'wall street',
    symbols: ['US Stocks'],
    aliases: ['wall street'],
    promptContext: 'Explain the session through broad US equity risk sentiment. Do not turn the article into one company earnings note unless the sources do.',
  },
];

export function marketNewsCoverage(topic: MarketNewsTopic): MarketNewsCoverage {
  if (topic.symbols.length === 0) return 'research-fallback';
  const catalog = new Set<string>(MARKET_NEWS_CATALOG_SYMBOLS);
  return topic.symbols.every(symbol => catalog.has(symbol)) ? 'catalog' : 'research-fallback';
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function longestAlias(topic: MarketNewsTopic, haystack: string): number {
  return [topic.keyword, ...topic.aliases].reduce((best, alias) => {
    const key = normalized(alias);
    return haystack.includes(key) ? Math.max(best, key.length) : best;
  }, 0);
}

export function topicForKeyword(keyword: string): MarketNewsTopic | null {
  const haystack = normalized(keyword);
  if (!haystack) return null;
  const hits = MARKET_NEWS_TOPICS.filter(topic => longestAlias(topic, haystack) > 0);
  hits.sort((left, right) => longestAlias(right, haystack) - longestAlias(left, haystack));
  return hits[0] || null;
}

export function filterMarketNewsTopics(query: string): MarketNewsTopic[] {
  const needle = normalized(query);
  if (!needle) return [...MARKET_NEWS_TOPICS];
  return MARKET_NEWS_TOPICS.filter(topic => normalized(`${topic.category} ${topic.label} ${topic.instrumentName} ${topic.keyword} ${topic.symbols.join(' ')}`).includes(needle));
}

export function groupMarketNewsTopics(topics: readonly MarketNewsTopic[]): Array<{ category: MarketNewsCategory; topics: MarketNewsTopic[] }> {
  return MARKET_NEWS_CATEGORIES.flatMap(category => {
    const rows = topics.filter(topic => topic.category === category);
    return rows.length ? [{ category, topics: rows }] : [];
  });
}

export function marketNewsTopicContext(keyword: string): string {
  const topic = topicForKeyword(keyword);
  if (!topic) return '';
  const coverage = marketNewsCoverage(topic);
  const source = coverage === 'catalog'
    ? `The existing market-news catalog can match ${topic.symbols.join(', ')}. Still use only numbers present in the supplied sources.`
    : 'This symbol is not in the existing market-news catalog. Use only the web and news research already supplied. Do not invent a live quote.';
  return `INSTRUMENT NAME (required): ${topic.instrumentName}\nTOPIC CONTEXT: ${topic.promptContext}\nDATA COVERAGE: ${source}`;
}

export const ELIGIBLE_MARKET_NEWS_KEYWORDS = [...new Set(MARKET_NEWS_TOPICS.flatMap(topic => [topic.keyword, ...topic.aliases]))];
