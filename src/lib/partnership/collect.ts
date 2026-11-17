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
import {
  findBrandHubs, instagramEmbedUrl, instagramPostText, isInstagramPostUrl, canonicalInstagramPostUrl, parseInstagramEmbed, parseInstagramPostPage,
  parseZendeskArticles, zendeskArticlesUrl, type InstagramFeedPost, type InstagramPost,
} from './campaigns';
import type { SocialHandles } from './social';
import { parseYoutubeRss, youtubeChannelIdFromHandle, youtubeChannelIdFromPage, youtubeRssUrl, type SocialFeedPost } from './treg-social';

/** Everything the refresh touches outside this module. Injected so tests run without network. */
export interface CollectDeps {
  now(): Date;
  crawlPages(startUrl: string): Promise<{ pages: Array<{ url: string; html: string }>; timedOut: boolean }>;
  fetchNews(query: string): Promise<NewsHit[]>;
  /** Null when no free web-search key is configured. */
  searchWeb(query: string): Promise<WebHit[] | null>;
  complete(system: string, user: string): Promise<{ content: string; model: string | null }>;
  onProgress?(progress: number, message: string): Promise<void> | void;
  /**
   * One public GET with the SSRF guard (public hosts only, no login, no cookies).
   * Optional: without it brand hubs and Instagram post pages are skipped.
   */
  fetchPublic?(url: string, accept?: string): Promise<{ url: string; status: number; body: string } | null>;
  /**
   * Optional paid feed of the competitor's recent Instagram posts (treg). Null when
   * treg is not used for this run (no key, low balance, daily limit, not confirmed).
   * It must not throw: failures come back as { posts: [], note }.
   */
  instagramFeed?(handle: string): Promise<{ posts: InstagramFeedPost[]; note: string } | null>;
  /**
   * Optional paid multi-platform feeds (treg: Instagram, TikTok, Facebook, Meta Ad Library, X)
   * for a confirmed manual run. Must not throw; failures come back as notes.
   */
  socialFeeds?(): Promise<{ instagram: InstagramFeedPost[]; posts: SocialFeedPost[]; notes: string[] } | null>;
  /** Saves a caption read from a team-pasted link so the next refresh does not fetch it again. */
  saveEvidenceText?(evidenceId: string, text: string): Promise<void>;
}

export interface CompetitorForReport {
  name: string;
  region: string;
  website: string | null;
  instagramHandle?: string | null;
  socialHandles?: SocialHandles;
}

/** Free web-search queries (Serper free tier when SERPER_API_KEY is set). */
export function webQueries(name: string, instagramHandle?: string | null): string[] {
  const n = name.replace(/"/g, '');
  return [
    `"${n}" campaign OR kampanye OR program`,
    `"${n}" hashtag instagram`,
    `site:instagram.com ${instagramHandle ? `"${instagramHandle}"` : `"${n}"`}`,
    `"${n}" promo bonus`,
    `"${n}" partnership kerja sama`,
    `"${n}" event sponsor webinar`,
  ];
}

/** Second Google News query aimed at named programs and campaigns. */
export function campaignNewsQuery(name: string): string {
  return `"${name.replace(/"/g, '')}" (kampanye OR campaign OR program OR luncurkan OR launch OR hashtag) when:90d`;
}

export const MAX_HUB_PAGES = 4;
export const MAX_IG_PAGE_FETCHES = 6;

/** Caption of a public Instagram post: preview tags first, then the official captioned embed. Never logs in. */
export async function readInstagramPost(url: string, fetchPublic: NonNullable<CollectDeps['fetchPublic']>): Promise<InstagramPost | null> {
  const canonical = canonicalInstagramPostUrl(url);
  if (!canonical) return null;
  const page = await fetchPublic(canonical).catch(() => null);
  const fromPage = page && page.status === 200 ? parseInstagramPostPage(canonical, page.body) : null;
  if (fromPage) return fromPage;
  const embedUrl = instagramEmbedUrl(url);
  const embed = embedUrl ? await fetchPublic(embedUrl).catch(() => null) : null;
  return embed && embed.status === 200 ? parseInstagramEmbed(canonical, embed.body) : null;
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
  let rawPages: Array<{ url: string; html: string }> = [];
  if (competitor.website) {
    await progress(10, `Reading ${competitor.website}.`);
    try {
      const crawl = await deps.crawlPages(competitor.website);
      rawPages = crawl.pages;
      const facts = crawl.pages.map(page => extractPageFacts(page.url, page.html));
      pages = facts.filter(page => isActivityPage(page, window));
      notes.push(`Website: read ${crawl.pages.length} page(s); ${pages.length} looked like recent activity.${crawl.timedOut ? ' The crawl stopped at its time limit.' : ''}`);
    } catch {
      notes.push('The website could not be read this time.');
    }
    if (deps.fetchPublic && rawPages.length) {
      // Program pages often live on sibling subdomains (support.brand.com, get.brand.com) that the same-host crawl skips.
      const hubs = findBrandHubs(rawPages, competitor.website);
      let hubPages = 0;
      for (const hub of hubs) {
        if (hubPages >= MAX_HUB_PAGES) break;
        try {
          if (hub.kind === 'help-center') {
            const api = zendeskArticlesUrl(hub.url);
            const answer = api ? await deps.fetchPublic(api, 'application/json') : null;
            if (!answer || answer.status !== 200) continue;
            const articles = parseZendeskArticles(answer.body, window);
            for (const article of articles) {
              const isNew = Boolean(article.createdAt && article.createdAt >= window.start);
              pages.push({ url: article.url, title: article.title, description: `Help-center article${article.createdAt ? `, created ${article.createdAt}` : ''}${article.updatedAt ? `, updated ${article.updatedAt}` : ''}`, publishedAt: isNew ? article.createdAt : null, excerpt: article.excerpt });
            }
            hubPages += 1;
            notes.push(`Help center ${new URL(hub.url).host}: ${articles.length} new or program article(s).`);
          } else {
            const answer = await deps.fetchPublic(hub.url);
            if (!answer || answer.status !== 200) continue;
            pages.push(extractPageFacts(answer.url, answer.body));
            hubPages += 1;
          }
        } catch {
          notes.push(`Could not read ${hub.url}.`);
        }
      }
    }
  } else {
    notes.push('No website on file, so no website was read. Add the official URL to include it.');
  }

  await progress(40, 'Searching news.');
  let news: NewsHit[] = [];
  try {
    const hits = await deps.fetchNews(newsQuery(competitor.name));
    let more: NewsHit[] = [];
    try { more = await deps.fetchNews(campaignNewsQuery(competitor.name)); } catch { more = []; }
    const all = [...hits, ...more.filter(hit => !hits.some(other => other.url === hit.url))];
    news = all.filter(hit => mentionsCompetitor(hit.title, competitor.name));
    notes.push(`News: ${all.length} Google News result(s); ${news.length} name ${competitor.name} in the headline.`);
  } catch {
    notes.push('News search failed this time.');
  }

  await progress(55, 'Searching the web.');
  const web: WebHit[] = [];
  let webConfigured = true;
  for (const query of webQueries(competitor.name, competitor.instagramHandle)) {
    try {
      const hits = await deps.searchWeb(query);
      if (hits === null) { webConfigured = false; break; }
      web.push(...hits);
    } catch {
      notes.push(`Web search failed for: ${query}`);
    }
  }
  if (!webConfigured) notes.push('Web search skipped: no free search key (SERPER_API_KEY) is configured. Website, news, and team evidence were used.');

  // Instagram: captions of public posts. Team links first, then posts found by web search, then the optional treg feed.
  await progress(62, 'Reading Instagram captions.');
  const instagram: InstagramFeedPost[] = [];
  const evidenceForCatalog = evidence.map(item => ({ ...item }));
  if (deps.fetchPublic) {
    let fetches = 0;
    let captured = 0;
    for (const item of evidenceForCatalog) {
      if (fetches >= MAX_IG_PAGE_FETCHES || item.extractedText || !isInstagramPostUrl(item.sourceUrl)) continue;
      fetches += 1;
      const post = await readInstagramPost(item.sourceUrl!, deps.fetchPublic).catch(() => null);
      if (!post) continue;
      captured += 1;
      item.extractedText = instagramPostText(post);
      await deps.saveEvidenceText?.(item.id, item.extractedText).catch(() => undefined);
    }
    const known = new Set(evidenceForCatalog.map(item => item.sourceUrl && canonicalInstagramPostUrl(item.sourceUrl)).filter(Boolean));
    for (const hit of web) {
      const canonical = canonicalInstagramPostUrl(hit.url);
      if (fetches >= MAX_IG_PAGE_FETCHES || !canonical || known.has(canonical)) continue;
      known.add(canonical);
      fetches += 1;
      const post = await readInstagramPost(canonical, deps.fetchPublic).catch(() => null);
      if (post) { instagram.push({ ...post, kind: null }); captured += 1; }
    }
    if (fetches) notes.push(`Instagram: read ${captured} of ${fetches} public post caption(s) without logging in.`);
  }
  if (competitor.instagramHandle && deps.instagramFeed) {
    const feed = await deps.instagramFeed(competitor.instagramHandle);
    if (feed) {
      const seen = new Set(instagram.map(post => post.url));
      instagram.push(...feed.posts.filter(post => !seen.has(post.url)));
      notes.push(feed.note);
    }
  }

  // YouTube: the channel's public RSS feed (free, no login).
  const social: SocialFeedPost[] = [];
  const youtube = competitor.socialHandles?.youtube;
  if (youtube && deps.fetchPublic) {
    await progress(65, 'Reading YouTube.');
    let channelId = youtubeChannelIdFromHandle(youtube);
    if (!channelId) {
      const page = await deps.fetchPublic(`https://www.youtube.com/${youtube}`).catch(() => null);
      channelId = page && page.status === 200 ? youtubeChannelIdFromPage(page.body) : null;
    }
    const feed = channelId ? await deps.fetchPublic(youtubeRssUrl(channelId), 'application/atom+xml, application/xml, text/xml').catch(() => null) : null;
    if (feed && feed.status === 200) {
      const videos = parseYoutubeRss(feed.body);
      social.push(...videos);
      notes.push(`YouTube: ${videos.length} recent video(s) from ${youtube} (public feed, free).`);
    } else {
      notes.push(`YouTube: could not read the public feed for ${youtube}.`);
    }
  }
  if (deps.socialFeeds) {
    await progress(67, 'Reading social feeds via treg.');
    const feeds = await deps.socialFeeds();
    if (feeds) {
      const seen = new Set(instagram.map(post => post.url));
      instagram.push(...feeds.instagram.filter(post => !seen.has(post.url)));
      social.push(...feeds.posts);
      notes.push(...feeds.notes);
    }
  }

  const sources = buildSourceCatalog({ pages, news, web: web.filter(hit => !isInstagramPostUrl(hit.url) || !instagram.some(post => post.url === canonicalInstagramPostUrl(hit.url))), evidence: evidenceForCatalog, instagram, social }, window);
  if (!sources.length) {
    notes.push('No sources were found. Add the website, or paste Instagram links and captions as evidence, then refresh.');
    return { result: { window, overview: '', campaigns: [], regularContent: [], items: [], opportunities: [], sources: [], notes, counts: countByCategory([]) }, model: null };
  }

  await progress(70, `Summarizing ${sources.length} source(s).`);
  const prompt = buildIntelPrompt(competitor, sources, window);
  const reply = await deps.complete(prompt.system, prompt.user);
  const parsed = parseIntelResponse(reply.content, sources, window);
  const usedIds = new Set([...parsed.items, ...parsed.opportunities, ...parsed.campaigns, ...parsed.regularContent].flatMap(item => item.sources.map(source => source.id)));
  if (!parsed.items.length && !parsed.campaigns.length && !parsed.regularContent.length) notes.push('The model found no activity it could cite. Nothing uncited is shown.');
  if (!parsed.campaigns.length) notes.push('No brand campaign (named idea with a tagline or hashtag) could be cited from these sources. Paste the campaign\'s Instagram post link as evidence to include it.');
  return {
    result: {
      window,
      overview: parsed.overview,
      campaigns: parsed.campaigns,
      regularContent: parsed.regularContent,
      items: parsed.items,
      opportunities: parsed.opportunities,
      sources: sources.map(source => ({ ...source, excerpt: usedIds.has(source.id) ? source.excerpt : source.excerpt.slice(0, 200) })),
      notes,
      counts: countByCategory(parsed.items),
    },
    model: reply.model,
  };
}
