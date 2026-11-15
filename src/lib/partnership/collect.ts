import {
  activityWindow,
  buildIntelPrompt,
  buildSourceCatalog,
  countByCategory,
  mentionsCompetitor,
  newsQuery,
  parseIntelResponse,
  type EvidenceForPrompt,
  type IntelReportResult,
  type NewsHit,
  type PageFacts,
  type WebHit,
} from './intel';
import { extractPageFacts, isActivityPage } from './page-facts';

/** Everything the refresh touches outside this module. Injected so tests run without network. */
export interface CollectDeps {
  now(): Date;
  crawlPages(startUrl: string): Promise<{ pages: Array<{ url: string; html: string }>; timedOut: boolean }>;
  fetchNews(query: string): Promise<NewsHit[]>;
  /** Null when no free web-search key is configured. */
  searchWeb(query: string): Promise<WebHit[] | null>;
  complete(system: string, user: string): Promise<{ content: string; model: string | null }>;
  onProgress?(progress: number, message: string): Promise<void> | void;
}

export interface CompetitorForReport {
  name: string;
  region: string;
  website: string | null;
}

export function webQueries(name: string): string[] {
  return [`"${name}" promo bonus`, `"${name}" partnership kerja sama`, `"${name}" event sponsor webinar`];
}

export async function buildCompetitorReport(
  competitor: CompetitorForReport,
  evidence: EvidenceForPrompt[],
  deps: CollectDeps,
): Promise<{ result: IntelReportResult; model: string | null }> {
  const window = activityWindow(deps.now());
  const notes: string[] = [];
  const progress = async (value: number, message: string) => { await deps.onProgress?.(value, message); };

  let pages: PageFacts[] = [];
  if (competitor.website) {
    await progress(10, `Reading ${competitor.website}.`);
    try {
      const crawl = await deps.crawlPages(competitor.website);
      const facts = crawl.pages.map(page => extractPageFacts(page.url, page.html));
      pages = facts.filter(page => isActivityPage(page, window));
      notes.push(`Website: read ${crawl.pages.length} page(s); ${pages.length} looked like recent activity.${crawl.timedOut ? ' The crawl stopped at its time limit.' : ''}`);
    } catch {
      notes.push('The website could not be read this time.');
    }
  } else {
    notes.push('No website on file, so no website was read. Add the official URL to include it.');
  }

  await progress(40, 'Searching news.');
  let news: NewsHit[] = [];
  try {
    const hits = await deps.fetchNews(newsQuery(competitor.name));
    news = hits.filter(hit => mentionsCompetitor(hit.title, competitor.name));
    notes.push(`News: ${hits.length} Google News result(s); ${news.length} name ${competitor.name} in the headline.`);
  } catch {
    notes.push('News search failed this time.');
  }

  await progress(55, 'Searching the web.');
  const web: WebHit[] = [];
  let webConfigured = true;
  for (const query of webQueries(competitor.name)) {
    try {
      const hits = await deps.searchWeb(query);
      if (hits === null) { webConfigured = false; break; }
      web.push(...hits);
    } catch {
      notes.push(`Web search failed for: ${query}`);
    }
  }
  if (!webConfigured) notes.push('Web search skipped: no free search key (SERPER_API_KEY) is configured. Website, news, and team evidence were used.');

  const sources = buildSourceCatalog({ pages, news, web, evidence }, window);
  if (!sources.length) {
    notes.push('No sources were found. Add the website, or paste Instagram links and captions as evidence, then refresh.');
    return { result: { window, overview: '', items: [], opportunities: [], sources: [], notes, counts: countByCategory([]) }, model: null };
  }

  await progress(70, `Summarizing ${sources.length} source(s).`);
  const prompt = buildIntelPrompt(competitor, sources, window);
  const reply = await deps.complete(prompt.system, prompt.user);
  const parsed = parseIntelResponse(reply.content, sources, window);
  const usedIds = new Set([...parsed.items, ...parsed.opportunities].flatMap(item => item.sources.map(source => source.id)));
  if (!parsed.items.length) notes.push('The model found no activity it could cite. Nothing uncited is shown.');
  return {
    result: {
      window,
      overview: parsed.overview,
      items: parsed.items,
      opportunities: parsed.opportunities,
      sources: sources.map(source => ({ ...source, excerpt: usedIds.has(source.id) ? source.excerpt : source.excerpt.slice(0, 200) })),
      notes,
      counts: countByCategory(parsed.items),
    },
    model: reply.model,
  };
}
