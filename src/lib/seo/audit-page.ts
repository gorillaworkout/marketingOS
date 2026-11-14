import * as cheerio from 'cheerio';
import { normalizeAuditUrl, sameHost } from './audit-url';
import type { AuditIssue, CrawledPage, IndexingRow, IssueSeverity, NotConnectedCard } from './audit-types';

export const TITLE_MAX = 65;
export const DESCRIPTION_MAX = 155;
const THIN_WORDS = 150;
const LARGE_BYTES = 1_500_000;
const URL_CAP = 50;

export interface PageFacts {
  title: string;
  metaDescription: string;
  h1Count: number;
  missingAlt: number;
  canonical: string | null;
  noindex: boolean;
  wordCount: number;
  mixedContent: number;
  links: string[];
}

function absolute(base: string, href: string): string | null {
  const value = href.trim();
  if (!value || /^(mailto:|tel:|javascript:|#)/i.test(value)) return null;
  try { return normalizeAuditUrl(new URL(value, base).toString()); } catch { return null; }
}

export function analyzeHtml(html: string, pageUrl: string): PageFacts {
  const $ = cheerio.load(html);
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.replace(/\s+/g, ' ').trim() || '';
  const robots = [
    $('meta[name="robots"]').attr('content') || '',
    $('meta[name="googlebot"]').attr('content') || '',
  ].join(' ').toLowerCase();
  const canonicalHref = $('link[rel="canonical"]').attr('href') || '';
  const canonical = canonicalHref ? absolute(pageUrl, canonicalHref) : null;
  const resources = $('img, script, iframe, source, video, audio, link[rel="stylesheet"]')
    .toArray()
    .map(node => $(node).attr('src') || $(node).attr('href') || '');
  const secure = pageUrl.startsWith('https:');
  const mixedContent = secure ? resources.filter(src => src.trim().toLowerCase().startsWith('http://')).length : 0;
  $('script, style, noscript').remove();
  const words = $('body').text().replace(/\s+/g, ' ').trim();
  const links = [...new Set(
    $('a[href]').toArray()
      .map(node => absolute(pageUrl, $(node).attr('href') || ''))
      .filter((href): href is string => !!href && sameHost(href, pageUrl) && !/\.(png|jpe?g|gif|webp|svg|pdf|zip|css|js)$/i.test(new URL(href).pathname)),
  )];
  return {
    title,
    metaDescription,
    h1Count: $('h1').length,
    missingAlt: $('img').toArray().filter(node => !($(node).attr('alt') || '').trim()).length,
    canonical,
    noindex: /\bnoindex\b/.test(robots),
    wordCount: words ? words.split(' ').length : 0,
    mixedContent,
    links,
  };
}

function issue(code: string, severity: IssueSeverity, title: string, detail: string, urls: string[]): AuditIssue | null {
  const unique = [...new Set(urls)].slice(0, URL_CAP);
  if (!unique.length) return null;
  return { code, severity, title, detail, urls: unique };
}

export function buildAuditIssues(pages: CrawledPage[], extras: { robotsPresent: boolean; sitemapPresent: boolean; origin: string; brokenLinks: string[]; robotsBlocked: string[] }): AuditIssue[] {
  const htmlOk = pages.filter(page => page.html && page.status >= 200 && page.status < 300);
  const titles = new Map<string, string[]>();
  const descriptions = new Map<string, string[]>();
  for (const page of htmlOk) {
    const title = page.title.toLowerCase();
    const description = page.metaDescription.toLowerCase();
    if (title) titles.set(title, [...(titles.get(title) || []), page.url]);
    if (description) descriptions.set(description, [...(descriptions.get(description) || []), page.url]);
  }
  const collected = [
    issue('http-5xx', 'error', 'Server errors', 'A page returned a 5xx status.', pages.filter(page => page.status >= 500).map(page => page.url)),
    issue('http-4xx', 'error', 'Client errors', 'A page returned a 4xx status.', pages.filter(page => page.status >= 400 && page.status < 500).map(page => page.url)),
    issue('broken-internal', 'error', 'Broken internal links', 'An internal link points at a page that returned an error.', extras.brokenLinks),
    issue('missing-title', 'error', 'Missing title', 'The page has no <title>.', htmlOk.filter(page => !page.title).map(page => page.url)),
    issue('multiple-h1', 'error', 'Multiple H1 headings', 'The page has more than one H1.', htmlOk.filter(page => page.h1Count > 1).map(page => page.url)),
    issue('mixed-content', 'error', 'Mixed content', 'An HTTPS page loads an HTTP resource.', htmlOk.filter(page => page.mixedContent > 0).map(page => page.url)),
    issue('missing-description', 'warning', 'Missing meta description', 'The page has no meta description.', htmlOk.filter(page => !page.metaDescription).map(page => page.url)),
    issue('title-length', 'warning', 'Title length', `Titles should be 15–${TITLE_MAX} characters.`, htmlOk.filter(page => page.title && (page.title.length < 15 || page.title.length > TITLE_MAX)).map(page => page.url)),
    issue('description-length', 'warning', 'Meta description length', `Descriptions should be 50–${DESCRIPTION_MAX} characters.`, htmlOk.filter(page => page.metaDescription && (page.metaDescription.length < 50 || page.metaDescription.length > DESCRIPTION_MAX)).map(page => page.url)),
    issue('duplicate-title', 'warning', 'Duplicate titles', 'More than one page uses the same title.', [...titles.values()].filter(urls => urls.length > 1).flat()),
    issue('duplicate-description', 'warning', 'Duplicate meta descriptions', 'More than one page uses the same meta description.', [...descriptions.values()].filter(urls => urls.length > 1).flat()),
    issue('missing-h1', 'warning', 'Missing H1', 'The page has no H1.', htmlOk.filter(page => page.h1Count === 0).map(page => page.url)),
    issue('missing-alt', 'warning', 'Missing image alt', 'An image has no alt text.', htmlOk.filter(page => page.missingAlt > 0).map(page => page.url)),
    issue('missing-canonical', 'warning', 'Missing canonical', 'The page has no canonical link.', htmlOk.filter(page => !page.canonical).map(page => page.url)),
    issue('canonical-mismatch', 'warning', 'Canonical mismatch', 'The canonical URL is a different page.', htmlOk.filter(page => page.canonical && page.canonical !== page.finalUrl).map(page => page.url)),
    issue('thin-content', 'warning', 'Thin content', `The page has fewer than ${THIN_WORDS} words.`, htmlOk.filter(page => page.wordCount < THIN_WORDS).map(page => page.url)),
    issue('large-page', 'warning', 'Large page', 'The response is larger than 1.5 MB.', pages.filter(page => page.bytes > LARGE_BYTES).map(page => page.url)),
    issue('redirect-chain', 'warning', 'Redirect chain', 'The URL redirects more than once.', pages.filter(page => page.redirectHops >= 2).map(page => page.url)),
    issue('missing-sitemap', 'warning', 'Sitemap missing', 'sitemap.xml was not found.', extras.sitemapPresent ? [] : [`${extras.origin}/sitemap.xml`]),
    issue('redirect', 'notice', 'Redirect', 'The URL redirects once before the final page.', pages.filter(page => page.redirectHops === 1).map(page => page.url)),
    issue('noindex', 'notice', 'Noindex', 'The page asks search engines not to index it.', htmlOk.filter(page => page.noindex).map(page => page.url)),
    issue('not-in-sitemap', 'notice', 'Not in the sitemap', 'A crawled page is not listed in the sitemap.', extras.sitemapPresent ? htmlOk.filter(page => !page.inSitemap).map(page => page.url) : []),
    issue('orphan', 'notice', 'Orphan page', 'No other crawled page links to this page.', htmlOk.filter(page => page.depth > 0 && page.inbound === 0).map(page => page.url)),
    issue('robots-blocked', 'notice', 'Blocked by robots.txt', 'The URL was discovered but robots.txt disallows it, so it was not fetched.', extras.robotsBlocked),
    issue('missing-robots', 'notice', 'robots.txt missing', 'robots.txt was not found. The crawl continued.', extras.robotsPresent ? [] : [`${extras.origin}/robots.txt`]),
  ];
  return collected.filter((item): item is AuditIssue => !!item);
}

const WEIGHT: Record<IssueSeverity, number> = { error: 4, warning: 1, notice: 0 };

/** Notices do not change the score. Each issue counts at most 8 URLs. */
export function healthScore(issues: AuditIssue[]): number {
  const penalty = issues.reduce((sum, item) => sum + WEIGHT[item.severity] * Math.min(item.urls.length, 8), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

export function applyIssueCounts(pages: CrawledPage[], issues: AuditIssue[]): CrawledPage[] {
  return pages.map(page => ({
    ...page,
    issueCount: issues.filter(item => item.urls.includes(page.url) || item.urls.includes(page.finalUrl)).length,
  }));
}

export function indexingRows(pages: CrawledPage[], robotsBlocked: string[], sitemapPresent: boolean): IndexingRow[] {
  const rows: IndexingRow[] = [];
  for (const page of pages) {
    const reasons: string[] = [];
    if (page.noindex) reasons.push('noindex');
    if (page.canonical && page.canonical !== page.finalUrl) reasons.push('canonical-mismatch');
    if (sitemapPresent && page.html && page.status < 400 && !page.inSitemap) reasons.push('not-in-sitemap');
    if (page.depth > 0 && page.inbound === 0 && page.html) reasons.push('orphan');
    if (reasons.length) rows.push({ url: page.url, reasons });
  }
  for (const url of robotsBlocked) rows.push({ url, reasons: ['robots-blocked'] });
  return rows;
}

export function notConnectedCards(): { gsc: NotConnectedCard; ga4: NotConnectedCard } {
  return {
    gsc: {
      status: 'not-connected',
      title: 'Search Console indexing',
      needed: 'Google Search Console URL Inspection is not connected. SEO OS can sync Search Analytics, but indexing coverage needs the URL Inspection API on the same service account. No indexing numbers are shown until that access exists.',
    },
    ga4: {
      status: 'not-connected',
      title: 'Bounce rate (GA4)',
      needed: 'GA4 is not connected. Bounce rate needs a GA4 property id and a service account with Analytics read access. No bounce rate is shown until that access exists.',
    },
  };
}
