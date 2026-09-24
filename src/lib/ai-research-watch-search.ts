import {
  jinaReaderUrl,
  parseNewsRss,
  resolveSearchApiKeys,
  searchSerper,
  type SearchApiKeys,
} from './ai-research-grounding';
import {
  type ResearchWatchHit,
  type ResearchWatchProvider,
} from './ai-research-watches';

export type WatchSearchResult = {
  ok: boolean;
  provider: ResearchWatchProvider;
  hits: ResearchWatchHit[];
  warning?: string;
};

const WATCH_USER_AGENT = 'MarketingOS-ResearchWatch/1.0';

function hitsFromSources(sources: Array<{ title: string; url: string; snippet: string }>): ResearchWatchHit[] {
  return sources.map(source => ({
    title: source.title,
    url: source.url,
    snippet: source.snippet,
  }));
}

async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const response = await fetchImpl(url, { headers, redirect: 'follow', signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function hitsFromRss(xml: string): ResearchWatchHit[] {
  const direct = hitsFromSources(parseNewsRss(xml));
  if (direct.length) return direct;
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const hits: ResearchWatchHit[] = [];
  for (const item of items) {
    const title = decodeXml(item.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1] || '');
    const sourceUrl = decodeXml(item.match(/<source\b[^>]*url=["']([^"']+)["']/i)?.[1] || '');
    const snippet = decodeXml(item.match(/<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title || !/^https?:\/\//i.test(sourceUrl)) continue;
    hits.push({ title, url: sourceUrl, snippet });
    if (hits.length >= 8) break;
  }
  return hits;
}

async function enrichThinSnippet(
  hit: ResearchWatchHit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ResearchWatchHit> {
  if (hit.snippet.trim().length >= 40) return hit;
  const wrapped = jinaReaderUrl(hit.url);
  if (!wrapped) return hit;
  const text = await fetchText(fetchImpl, wrapped, timeoutMs, {
    Accept: 'text/plain',
    'User-Agent': WATCH_USER_AGENT,
  });
  if (!text) return hit;
  const snippet = text.replace(/!\[[^\]]*]\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
  if (snippet.length < 40) return hit;
  return { ...hit, snippet };
}

export async function searchWatchTopic(
  query: string,
  options: {
    fetchImpl?: typeof fetch;
    searchApiKeys?: SearchApiKeys;
    timeoutMs?: number;
    enrichThinSnippets?: boolean;
  } = {},
): Promise<WatchSearchResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const keys = resolveSearchApiKeys(options.searchApiKeys);
  let hits: ResearchWatchHit[] = [];
  let provider: ResearchWatchProvider = 'none';
  let warning: string | undefined;
  let serperFailed = false;

  if (keys.serper) {
    try {
      const attempt = await searchSerper(query, keys.serper, fetchImpl, 200_000, timeoutMs);
      if (attempt.sources.length) {
        hits = hitsFromSources(attempt.sources);
        provider = 'serper';
      } else if (attempt.exhausted) {
        serperFailed = true;
        warning = 'Serper quota is exhausted or was rejected. Using Google News RSS.';
      }
    } catch {
      serperFailed = true;
      warning = 'Serper search failed. Using Google News RSS.';
    }
  }

  if (!hits.length) {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`;
    const xml = await fetchText(fetchImpl, rssUrl, timeoutMs, {
      Accept: 'application/rss+xml, application/xml, text/xml',
      'User-Agent': WATCH_USER_AGENT,
    });
    const rssHits = xml ? hitsFromRss(xml) : [];
    if (rssHits.length) {
      hits = rssHits;
      provider = 'news-rss';
      if (!keys.serper) warning = 'SERPER_API_KEY is empty. Using Google News RSS.';
    } else if (!keys.serper) {
      warning = 'SERPER_API_KEY is empty and RSS returned no results.';
    } else if (serperFailed) {
      warning = warning || 'Search failed.';
    }
  }

  if (options.enrichThinSnippets !== false && hits[0]) {
    hits = [await enrichThinSnippet(hits[0], fetchImpl, Math.min(timeoutMs, 6_000)), ...hits.slice(1)];
  }

  const failed = provider === 'none' && hits.length === 0 && Boolean(warning);
  return { ok: !failed, provider, hits, warning };
}
