import { inWindow, type NewsHit, type PageFacts } from './intel';
import { extractPageFacts } from './page-facts';
import {
  TREND_THEMES, brandNewsQuery, buildTrendSourceCatalog, buildTrendsPrompt, countByTheme, parseTrendsResponse, themeNewsQuery, trendWindow,
  type TrendTheme, type TrendWindowDays, type TrendsDigestResult,
} from './trends';

/** Everything the digest touches outside this module. Injected so tests run without network. */
export interface TrendsDeps {
  now(): Date;
  /** Google News RSS (English edition). */
  fetchNews(query: string): Promise<NewsHit[]>;
  /** Official newsroom/blog crawl through the hardened crawlSite. */
  crawlPages(startUrl: string): Promise<{ pages: Array<{ url: string; html: string }>; timedOut: boolean }>;
  /** Serper news search; null when no SERPER_API_KEY is configured. */
  searchNews(query: string): Promise<NewsHit[] | null>;
  complete(system: string, user: string): Promise<{ content: string; model: string | null }>;
  onProgress?(progress: number, message: string): Promise<void> | void;
}

export interface TrendBrandForDigest {
  name: string;
  website: string | null;
  newsroomUrl: string | null;
  searchTerms: string[];
}

const SERPER_QUERIES: Record<TrendTheme, string> = {
  sponsorships: 'forex broker sponsorship deal',
  affiliates: 'forex broker affiliate IB program launch',
  collaborations: 'forex broker brand partnership',
  promos: 'forex broker marketing campaign',
  product: 'forex broker app new feature',
  education: 'forex broker trading academy community',
  regulation: 'forex broker new licence regulator',
  channels: 'forex broker influencer ambassador campaign',
};

export async function buildTrendsDigest(
  brands: TrendBrandForDigest[],
  windowDays: TrendWindowDays,
  deps: TrendsDeps,
): Promise<{ result: TrendsDigestResult; model: string | null }> {
  const window = trendWindow(deps.now(), windowDays);
  const notes: string[] = [];
  let last = 0;
  const progress = async (value: number, message: string) => {
    last = Math.max(last, Math.round(value));
    await deps.onProgress?.(last, message);
  };
  const names = brands.map(brand => ({ name: brand.name, searchTerms: brand.searchTerms }));

  await progress(5, `Searching news for ${brands.length} brand(s).`);
  const brandNews: Array<{ brand: string; hits: NewsHit[] }> = [];
  let brandFailures = 0;
  for (const [index, brand] of brands.entries()) {
    try {
      brandNews.push({ brand: brand.name, hits: await deps.fetchNews(brandNewsQuery(brand, windowDays)) });
    } catch {
      brandFailures += 1;
    }
    await progress(5 + (25 * (index + 1)) / Math.max(1, brands.length), `News: ${brand.name}.`);
  }
  if (brandFailures) notes.push(`Brand news search failed for ${brandFailures} of ${brands.length} brand(s).`);

  const themeNews: Array<{ theme: TrendTheme; hits: NewsHit[] }> = [];
  let themeFailures = 0;
  for (const [index, theme] of TREND_THEMES.entries()) {
    try {
      themeNews.push({ theme, hits: await deps.fetchNews(themeNewsQuery(theme, windowDays)) });
    } catch {
      themeFailures += 1;
    }
    await progress(30 + (15 * (index + 1)) / TREND_THEMES.length, 'Searching theme news.');
  }
  if (themeFailures) notes.push(`Theme news search failed for ${themeFailures} of ${TREND_THEMES.length} theme(s).`);

  const pages: Array<{ brand: string; page: PageFacts }> = [];
  const withNewsroom = brands.filter(brand => brand.newsroomUrl);
  for (const brand of brands.filter(item => !item.newsroomUrl)) notes.push(`${brand.name}: no newsroom or blog URL on file, so only news was used.`);
  for (const [index, brand] of withNewsroom.entries()) {
    await progress(45 + (20 * index) / Math.max(1, withNewsroom.length), `Reading the ${brand.name} newsroom.`);
    try {
      const crawl = await deps.crawlPages(brand.newsroomUrl as string);
      const facts = crawl.pages.map(page => extractPageFacts(page.url, page.html));
      for (const page of facts) pages.push({ brand: brand.name, page });
      const dated = facts.filter(page => page.publishedAt && inWindow(page.publishedAt, window)).length;
      notes.push(`${brand.name}: newsroom read ${facts.length} page(s); ${dated} dated inside the window.${crawl.timedOut ? ' The crawl stopped at its time limit.' : ''}`);
    } catch {
      notes.push(`${brand.name}: the newsroom could not be read this time.`);
    }
  }

  await progress(66, 'Searching the web.');
  const web: NewsHit[] = [];
  let serperConfigured = true;
  for (const theme of TREND_THEMES) {
    try {
      const hits = await deps.searchNews(SERPER_QUERIES[theme]);
      if (hits === null) { serperConfigured = false; break; }
      web.push(...hits.slice(0, 5));
    } catch {
      notes.push(`Serper news search failed for ${theme}.`);
    }
  }
  if (!serperConfigured) notes.push('Serper skipped: no SERPER_API_KEY is configured. Google News and newsrooms were used.');

  const sources = buildTrendSourceCatalog({ brandNews, themeNews, pages, web }, window, names);
  const empty = (): TrendsDigestResult => ({
    kind: 'global-trends', windowDays, window, summary: '', items: [], topTrends: [], ideas: [], sources: [], notes, counts: countByTheme([]), brands: brands.map(brand => brand.name),
  });
  if (!sources.length) {
    if (brandFailures === brands.length && themeFailures === TREND_THEMES.length) notes.push('News search failed for every query.');
    notes.push('No sources were found in this window. Try the 90-day window or add newsroom URLs to the watchlist.');
    return { result: empty(), model: null };
  }

  await progress(72, `Summarizing ${sources.length} source(s).`);
  const prompt = buildTrendsPrompt(sources, window, names);
  const reply = await deps.complete(prompt.system, prompt.user);
  const parsed = parseTrendsResponse(reply.content, sources, window, names);
  if (parsed.dropped) notes.push(`${parsed.dropped} uncited or unsupported entr${parsed.dropped === 1 ? 'y was' : 'ies were'} removed.`);
  if (!parsed.items.length) notes.push('The model found no activity it could cite. Nothing uncited is shown.');
  const used = new Set(parsed.items.flatMap(item => item.sources.map(source => source.id)));
  await progress(95, 'Saving.');
  return {
    result: {
      ...empty(),
      summary: parsed.summary,
      items: parsed.items,
      topTrends: parsed.topTrends,
      ideas: parsed.ideas,
      sources: sources.filter(source => used.has(source.id)),
      counts: countByTheme(parsed.items),
    },
    model: reply.model,
  };
}
