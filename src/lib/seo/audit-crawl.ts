import { analyzeHtml, type PageFacts } from './audit-page';
import { parseRobots, pathAllowed } from './audit-robots';
import { AUDIT_CONCURRENCY, AUDIT_TIMEOUT_MS, AUDIT_USER_AGENT, isPublicHost, normalizeAuditUrl, sameHost } from './audit-url';
import type { CrawledPage } from './audit-types';

export interface AuditResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  location: string | null;
}

export type AuditFetch = (url: string, timeoutMs: number) => Promise<AuditResponse>;

const ASSET = /\.(png|jpe?g|gif|webp|svg|pdf|zip|css|js|mp4|webm|woff2?)$/i;
const MAX_REDIRECTS = 5;
const BODY_CAP = 1_500_000;

export function createAuditFetch(): AuditFetch {
  return async (url, timeout) => {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
      headers: { 'user-agent': AUDIT_USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    const length = Number(response.headers.get('content-length') || 0);
    const body = length > BODY_CAP ? '' : (await response.text()).slice(0, BODY_CAP);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    return { status: response.status, headers, body, location: response.headers.get('location') };
  };
}

function header(headers: Record<string, string>, name: string): string {
  return headers[name.toLowerCase()] || '';
}

function isHtml(headers: Record<string, string>, body: string): boolean {
  const type = header(headers, 'content-type').toLowerCase();
  if (type.includes('text/html') || type.includes('application/xhtml')) return true;
  if (type && !type.includes('text/plain')) return false;
  return /<html[\s>]/i.test(body.slice(0, 500));
}

async function follow(url: string, fetchPage: AuditFetch, timeoutMs: number): Promise<{ finalUrl: string; status: number; hops: number; headers: Record<string, string>; body: string; bytes: number; error: boolean }> {
  let current = url;
  let hops = 0;
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    let response: AuditResponse;
    try {
      response = await fetchPage(current, timeoutMs);
    } catch {
      return { finalUrl: current, status: 0, hops, headers: {}, body: '', bytes: 0, error: true };
    }
    const declared = Number(header(response.headers, 'content-length') || 0);
    const bytes = Math.max(declared, Buffer.byteLength(response.body));
    if (response.status >= 300 && response.status < 400 && response.location && hops < MAX_REDIRECTS) {
      const next = new URL(response.location, current);
      if (!isPublicHost(next.hostname)) return { finalUrl: current, status: response.status, hops: hops + 1, headers: response.headers, body: '', bytes, error: false };
      current = normalizeAuditUrl(next.toString());
      hops += 1;
      continue;
    }
    return { finalUrl: current, status: response.status, hops, headers: response.headers, body: response.body, bytes, error: false };
  }
  return { finalUrl: current, status: 0, hops, headers: {}, body: '', bytes: 0, error: true };
}

function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(match => match[1].trim());
}

export interface CrawlOutput {
  origin: string;
  host: string;
  robotsPresent: boolean;
  sitemapPresent: boolean;
  robotsBlocked: string[];
  pages: CrawledPage[];
  brokenLinks: string[];
}

export async function crawlSite(input: {
  startUrl: string;
  maxPages: number;
  fetchPage?: AuditFetch;
  timeoutMs?: number;
  concurrency?: number;
  onProgress?: (crawled: number, maxPages: number) => void;
  /** Queue sitemap URLs before links discovered on the pages. Audit leaves this off. */
  seedFromSitemap?: boolean;
  /** Raw HTML for each fetched HTML page. Audit does not set this. */
  onHtml?: (page: { url: string; html: string }) => void;
  delayMs?: number;
}): Promise<CrawlOutput> {
  const fetchPage = input.fetchPage ?? createAuditFetch();
  const timeoutMs = input.timeoutMs ?? AUDIT_TIMEOUT_MS;
  const concurrency = input.concurrency ?? AUDIT_CONCURRENCY;
  const start = await follow(normalizeAuditUrl(input.startUrl), fetchPage, timeoutMs);
  const originUrl = new URL(start.finalUrl);
  const origin = originUrl.origin;
  const host = originUrl.hostname;
  const robotsUrl = `${origin}/robots.txt`;
  let robotsPresent = false;
  let disallow: string[] = [];
  let sitemapHints: string[] = [];
  const robots = await follow(robotsUrl, fetchPage, timeoutMs);
  if (robots.status >= 200 && robots.status < 300 && robots.body) {
    robotsPresent = true;
    const rules = parseRobots(robots.body);
    disallow = rules.disallow;
    sitemapHints = rules.sitemaps;
  }
  const sitemapUrls = new Set<string>();
  const sitemapTargets = [...new Set([`${origin}/sitemap.xml`, ...sitemapHints])].slice(0, 6);
  let sitemapPresent = false;
  for (const target of sitemapTargets) {
    if (!sameHost(target, origin)) continue;
    const file = await follow(target, fetchPage, timeoutMs);
    if (file.status < 200 || file.status >= 300 || !file.body) continue;
    sitemapPresent = true;
    const locs = sitemapLocs(file.body);
    const children = locs.filter(loc => /sitemap/i.test(loc) && loc.endsWith('.xml')).slice(0, 5);
    for (const loc of locs) {
      try { if (sameHost(loc, origin)) sitemapUrls.add(normalizeAuditUrl(loc)); } catch { /* skip a bad sitemap URL */ }
    }
    for (const child of children) {
      if (!sameHost(child, origin)) continue;
      const nested = await follow(child, fetchPage, timeoutMs);
      if (nested.status >= 200 && nested.status < 300) {
        for (const loc of sitemapLocs(nested.body)) {
          try { if (sameHost(loc, origin)) sitemapUrls.add(normalizeAuditUrl(loc)); } catch { /* skip a bad sitemap URL */ }
        }
      }
    }
    break;
  }

  const pages: CrawledPage[] = [];
  const seen = new Set<string>();
  const inbound = new Map<string, number>();
  const robotsBlocked: string[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url: normalizeAuditUrl(start.finalUrl), depth: 0 }];
  if (input.seedFromSitemap) {
    for (const loc of sitemapUrls) {
      if (queue.length >= input.maxPages) break;
      if (queue.some(item => item.url === loc)) continue;
      let parsed: URL;
      try { parsed = new URL(loc); } catch { continue; }
      if (!pathAllowed(parsed.pathname, disallow) || ASSET.test(parsed.pathname)) continue;
      queue.push({ url: loc, depth: 1 });
    }
  }
  const linked = new Set<string>();

  const rememberLinks = (facts: PageFacts, depth: number) => {
    for (const link of facts.links) {
      linked.add(link);
      inbound.set(link, (inbound.get(link) || 0) + 1);
      if (robotsBlocked.includes(link) || seen.has(link) || queue.some(item => item.url === link)) continue;
      let parsed: URL;
      try { parsed = new URL(link); } catch { continue; }
      if (!pathAllowed(parsed.pathname, disallow)) {
        robotsBlocked.push(link);
        continue;
      }
      if (ASSET.test(parsed.pathname)) continue;
      queue.push({ url: link, depth: depth + 1 });
    }
  };

  // The start response is reused so the homepage is not fetched twice.
  const seedFacts = isHtml(start.headers, start.body) && start.status >= 200 && start.status < 300
    ? analyzeHtml(start.body, start.finalUrl)
    : null;

  async function take(url: string, depth: number, preset?: typeof start): Promise<void> {
    const fetched = preset ?? await follow(url, fetchPage, timeoutMs);
    if (!sameHost(fetched.finalUrl, origin) && fetched.finalUrl !== url) {
      pages.push(blankPage(url, fetched.finalUrl, fetched.status, fetched.hops, depth, false));
      return;
    }
    const html = isHtml(fetched.headers, fetched.body) && fetched.status >= 200 && fetched.status < 300;
    const noindexHeader = /\bnoindex\b/i.test(header(fetched.headers, 'x-robots-tag'));
    const facts = html ? (preset && seedFacts && url === normalizeAuditUrl(start.finalUrl) ? seedFacts : analyzeHtml(fetched.body, fetched.finalUrl)) : null;
    const page = blankPage(url, fetched.finalUrl, fetched.status, fetched.hops, depth, html);
    page.bytes = fetched.bytes;
    page.inSitemap = sitemapUrls.has(url) || sitemapUrls.has(fetched.finalUrl);
    if (html && fetched.body) input.onHtml?.({ url: fetched.finalUrl, html: fetched.body });
    if (facts) {
      page.title = facts.title;
      page.metaDescription = facts.metaDescription;
      page.h1Count = facts.h1Count;
      page.missingAlt = facts.missingAlt;
      page.canonical = facts.canonical;
      page.noindex = facts.noindex || noindexHeader;
      page.wordCount = facts.wordCount;
      page.mixedContent = facts.mixedContent;
      rememberLinks(facts, depth);
    } else {
      page.noindex = noindexHeader;
    }
    pages.push(page);
    input.onProgress?.(pages.length, input.maxPages);
  }

  seen.add(queue[0].url);
  await take(queue[0].url, 0, start);
  let nextIndex = 1;
  let active = 0;
  await new Promise<void>(resolve => {
    const pump = () => {
      while (active < concurrency && nextIndex < queue.length && pages.length < input.maxPages) {
        const item = queue[nextIndex];
        nextIndex += 1;
        if (!item || seen.has(item.url)) continue;
        seen.add(item.url);
        active += 1;
        void (async () => {
          await new Promise(done => setTimeout(done, input.delayMs ?? 200));
          if (pages.length < input.maxPages) await take(item.url, item.depth);
        })().finally(() => {
          active -= 1;
          pump();
        });
      }
      if (active === 0 && nextIndex >= queue.length) resolve();
    };
    pump();
  });

  for (const page of pages) page.inbound = inbound.get(page.finalUrl) || inbound.get(page.url) || 0;
  return {
    origin,
    host,
    robotsPresent,
    sitemapPresent,
    robotsBlocked: [...new Set(robotsBlocked)].slice(0, 50),
    pages,
    brokenLinks: pages.filter(page => page.status >= 400 && linked.has(page.url)).map(page => page.url).slice(0, 50),
  };
}

function blankPage(url: string, finalUrl: string, status: number, hops: number, depth: number, html: boolean): CrawledPage {
  return {
    url, finalUrl, status, redirectHops: hops, title: '', metaDescription: '', h1Count: 0, missingAlt: 0,
    canonical: null, noindex: false, wordCount: 0, bytes: 0, mixedContent: 0, depth, html, inSitemap: false, inbound: 0, issueCount: 0,
  };
}
