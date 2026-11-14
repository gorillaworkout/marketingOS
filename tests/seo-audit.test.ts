import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { crawlSite, type AuditFetch, type AuditResponse } from '../src/lib/seo/audit-crawl.ts';
import { pagesToCsv } from '../src/lib/seo/audit-export.ts';
import { applyIssueCounts, buildAuditIssues, healthScore, indexingRows, notConnectedCards } from '../src/lib/seo/audit-page.ts';
import { parsePsiResponse, psiRequestUrl, resolvePsiKey, scrubPsiKey, topPsiPages } from '../src/lib/seo/audit-psi.ts';
import { parseRobots, pathAllowed } from '../src/lib/seo/audit-robots.ts';
import { auditUrlError, clampMaxPages, defaultAuditUrl, isPublicHost } from '../src/lib/seo/audit-url.ts';
import type { CrawledPage } from '../src/lib/seo/audit-types.ts';

const HOME = `<!doctype html><html><head>
<title>Gold trading account for new clients today</title>
<meta name="description" content="Open a gold trading account with a clear fee table and the steps to register online today.">
<link rel="canonical" href="https://example.com/">
</head><body>
<h1>Gold</h1>
<a href="/blog">Blog</a>
<a href="/missing">Missing</a>
<a href="/private">Private</a>
<a href="https://other.test/out">Out</a>
<img src="http://cdn.example.com/a.png">
<p>${'word '.repeat(160)}</p>
</body></html>`;

const BLOG = `<!doctype html><html><head><title>Notes</title></head><body><p>Short.</p><a href="/missing">Missing</a></body></html>`;

function response(status: number, body: string, type: string, location: string | null = null): AuditResponse {
  return { status, body, location, headers: { 'content-type': type, ...(location ? { location } : {}) } };
}

test('robots rules block the named path and keep sitemap URLs', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml\n');
  assert.equal(pathAllowed('/blog', rules.disallow), true);
  assert.equal(pathAllowed('/private', rules.disallow), false);
  assert.deepEqual(rules.sitemaps, ['https://example.com/sitemap.xml']);
});

test('the crawler stays on the host, honors robots, and scores the fixture', async () => {
  const pages = new Map<string, AuditResponse>([
    ['https://example.com/', response(200, HOME, 'text/html')],
    ['https://example.com/robots.txt', response(200, 'User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml\n', 'text/plain')],
    ['https://example.com/sitemap.xml', response(200, '<urlset><url><loc>https://example.com/</loc></url></urlset>', 'application/xml')],
    ['https://example.com/blog', response(200, BLOG, 'text/html')],
    ['https://example.com/missing', response(404, 'missing', 'text/html')],
  ]);
  const fetched: string[] = [];
  const fetchPage: AuditFetch = async url => {
    fetched.push(url);
    return pages.get(url) ?? response(404, '', 'text/plain');
  };
  const crawl = await crawlSite({ startUrl: 'https://example.com/', maxPages: 10, fetchPage, concurrency: 2 });
  assert.equal(fetched.includes('https://example.com/private'), false);
  assert.equal(fetched.includes('https://other.test/out'), false);
  assert.equal(crawl.robotsBlocked.some(url => url.endsWith('/private')), true);
  const issues = buildAuditIssues(crawl.pages, {
    robotsPresent: crawl.robotsPresent, sitemapPresent: crawl.sitemapPresent, origin: crawl.origin,
    brokenLinks: crawl.brokenLinks, robotsBlocked: crawl.robotsBlocked,
  });
  const scored = applyIssueCounts(crawl.pages, issues);
  assert.equal(issues.some(issue => issue.code === 'mixed-content'), true);
  assert.equal(issues.some(issue => issue.code === 'http-4xx'), true);
  assert.equal(issues.some(issue => issue.code === 'broken-internal'), true);
  assert.equal(issues.some(issue => issue.code === 'thin-content' && issue.urls.some(url => url.endsWith('/blog'))), true);
  assert.equal(healthScore(issues) < 100, true);
  assert.equal(healthScore(issues) >= 0, true);
  const index = indexingRows(scored, crawl.robotsBlocked, crawl.sitemapPresent);
  assert.equal(index.some(row => row.reasons.includes('robots-blocked')), true);
  assert.equal(index.some(row => row.url.endsWith('/blog') && row.reasons.includes('not-in-sitemap')), true);
});

test('health score ignores notices and stays inside 0-100', () => {
  assert.equal(healthScore([{ code: 'noindex', severity: 'notice', title: 'Noindex', detail: '', urls: ['https://a.test/'] }]), 100);
  assert.equal(healthScore([{ code: 'http-5xx', severity: 'error', title: 'Server errors', detail: '', urls: ['https://a.test/'] }]), 96);
  const many = [{ code: 'http-5xx', severity: 'error' as const, title: 'Server errors', detail: '', urls: Array.from({ length: 40 }, (_, index) => `https://a.test/${index}`) }];
  assert.equal(healthScore(many), 68);
  assert.equal(healthScore([]), 100);
});

test('PageSpeed parsing keeps lab and field data and hides the key', () => {
  const reading = parsePsiResponse({
    lighthouseResult: {
      categories: { performance: { score: 0.42 } },
      audits: {
        'largest-contentful-paint': { numericValue: 3200 },
        'interaction-to-next-paint': { numericValue: 180 },
        'cumulative-layout-shift': { numericValue: 0.12 },
        'first-contentful-paint': { numericValue: 1400 },
        'server-response-time': { numericValue: 210 },
      },
    },
    loadingExperience: {
      overall_category: 'AVERAGE',
      metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2800 }, INTERACTION_TO_NEXT_PAINT: { percentile: 150 } },
    },
  }, 'https://dupoin.co.id/', 'mobile');
  assert.equal(reading.performanceScore, 42);
  assert.equal(reading.lab?.lcp, 3200);
  assert.equal(reading.lab?.inp, 180);
  assert.equal(reading.field?.category, 'AVERAGE');
  assert.equal(reading.field?.lcp, 2800);
  const key = 'pagespeed-secret-key';
  assert.equal(resolvePsiKey(undefined, null), null);
  assert.equal(resolvePsiKey(' env-key ', null), 'env-key');
  assert.match(psiRequestUrl('https://dupoin.co.id/', 'desktop', key), /key=pagespeed-secret-key/);
  assert.equal(scrubPsiKey(`failed ${key}`, key).includes(key), false);
  const home = { url: 'https://dupoin.co.id/', finalUrl: 'https://dupoin.co.id/', status: 200, depth: 0, html: true };
  const deep = { url: 'https://dupoin.co.id/a', finalUrl: 'https://dupoin.co.id/a', status: 200, depth: 2, html: true };
  assert.deepEqual(topPsiPages('https://dupoin.co.id/', [deep, home], 1), ['https://dupoin.co.id/']);
});

test('URL defaults, public-host checks, and CSV export', () => {
  assert.equal(defaultAuditUrl([
    { site_url: 'https://indonesiancheer.org/', active: true },
    { site_url: 'https://dupoin.co.id/', active: false },
  ]), 'https://dupoin.co.id/');
  assert.equal(defaultAuditUrl([{ site_url: 'https://indonesiancheer.org/', active: true }]), 'https://indonesiancheer.org/');
  assert.equal(isPublicHost('10.1.2.3'), false);
  assert.equal(isPublicHost('dupoin.co.id'), true);
  assert.match(auditUrlError('http://127.0.0.1/') || '', /public/);
  assert.equal(clampMaxPages(500), 200);
  const page = { url: '=cmd', status: 200, title: 'Hello', wordCount: 10, depth: 0, issueCount: 1 } as CrawledPage;
  assert.match(pagesToCsv([page]), /'=cmd/);
});

test('Search Console and GA4 stay not connected', () => {
  const cards = notConnectedCards();
  assert.equal(cards.gsc.status, 'not-connected');
  assert.equal(cards.ga4.status, 'not-connected');
  assert.match(cards.ga4.needed, /GA4/);
  assert.doesNotMatch(JSON.stringify(cards), /\d+(\.\d+)?%/);
});

test('the audit page is in the SEO menu and does not embed a key', () => {
  const layout = readFileSync(new URL('../src/app/dashboard/layout.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/app/api/seo/audit/route.ts', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/app/api/seo/settings/pagespeed/route.ts', import.meta.url), 'utf8');
  assert.match(layout, /href: '\/dashboard\/seo\/audit', label: 'Website Audit'/);
  assert.match(route, /requireFeature\(request, 'seo'\)/);
  assert.match(settings, /requireAdmin/);
  assert.doesNotMatch(settings, /AIza[0-9A-Za-z_-]{20,}/);
  assert.doesNotMatch(route, /PAGESPEED_API_KEY\s*=\s*['\"][^'\"]+/);
});
