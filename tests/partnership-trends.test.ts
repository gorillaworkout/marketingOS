import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  DEFAULT_TREND_WINDOW, TREND_THEMES, TREND_THEME_LABELS, brandNewsQuery, buildTrendSourceCatalog, buildTrendsPrompt, isTrendsDigestDue,
  mentionsBrand, parseTrendBrandInput, parseTrendsResponse, parseWindowDays, themeNewsQuery, trendWindow, type TrendSource,
} from '../src/lib/partnership/trends';
import { buildTrendsDigest, type TrendsDeps } from '../src/lib/partnership/trends-collect';

const NOW = new Date('2026-11-15T08:00:00Z');
const read = (file: string) => readFileSync(file, 'utf8');

test('window is 30 or 90 days, 30 by default; anything else is rejected', () => {
  assert.equal(DEFAULT_TREND_WINDOW, 30);
  assert.equal(parseWindowDays(undefined), 30);
  assert.equal(parseWindowDays(''), 30);
  assert.equal(parseWindowDays(90), 90);
  assert.equal(parseWindowDays('90'), 90);
  assert.equal(parseWindowDays('30'), 30);
  assert.equal(parseWindowDays(7), null);
  assert.equal(parseWindowDays('abc'), null);
  assert.deepEqual(trendWindow(NOW, 30), { start: '2026-10-16', end: '2026-11-15', months: ['2026-10', '2026-11'] });
  assert.equal(trendWindow(NOW, 90).start, '2026-08-17');
});

test('themes cover sponsorships, affiliate/IB, collabs, promos, product, education, regulation, channels', () => {
  assert.deepEqual([...TREND_THEMES], ['sponsorships', 'affiliates', 'collaborations', 'promos', 'product', 'education', 'regulation', 'channels']);
  assert.match(TREND_THEME_LABELS.sponsorships, /esports/i);
  assert.match(TREND_THEME_LABELS.affiliates, /IB/);
  for (const theme of TREND_THEMES) assert.match(themeNewsQuery(theme, 90), /when:90d$/, theme);
});

test('watchlist brand input validates URLs and splits search names', () => {
  const ok = parseTrendBrandInput({ name: ' IG ', website: 'https://www.ig.com/', newsroomUrl: '', searchTerms: 'IG Group,  IG Markets ,,', notes: '' });
  assert.ok('value' in ok);
  if ('value' in ok) {
    assert.equal(ok.value.name, 'IG');
    assert.equal(ok.value.website, 'https://www.ig.com/');
    assert.equal(ok.value.newsroomUrl, null);
    assert.deepEqual(ok.value.searchTerms, ['IG Group', 'IG Markets']);
    assert.equal(ok.value.active, true);
  }
  assert.deepEqual(parseTrendBrandInput({ name: '' }), { error: 'Brand name is required.' });
  assert.ok('error' in parseTrendBrandInput({ name: 'X', website: 'not a url' }));
  assert.ok('error' in parseTrendBrandInput({ name: 'X', newsroomUrl: 'http://127.0.0.1/news' }));
  const off = parseTrendBrandInput({ name: 'X', active: false });
  assert.ok('value' in off && off.value.active === false);
});

test('brand matching uses whole words, so IG does not match "trading"', () => {
  assert.equal(mentionsBrand('IG Group posts record revenue', ['IG']), true);
  assert.equal(mentionsBrand('Big trading news', ['IG']), false);
  assert.equal(mentionsBrand('ICMarkets sponsors a football club', ['IC Markets']), true);
  assert.equal(mentionsBrand('eToro launches', ['eToro']), true);
  assert.equal(mentionsBrand('Plus500 renews deal', ['Plus500']), true);
  assert.equal(mentionsBrand('Nothing here', ['Exness', 'Exness Global']), false);
});

test('brand news query quotes every name and limits Google News to the window', () => {
  assert.equal(brandNewsQuery({ name: 'IG', searchTerms: ['IG Group'] }, 30), '("IG Group" OR "IG") (broker OR trading OR forex OR CFD) when:30d');
  assert.equal(brandNewsQuery({ name: 'Exness', searchTerms: [] }, 90), '"Exness" (broker OR trading OR forex OR CFD) when:90d');
});

const BRANDS = [
  { name: 'Exness', searchTerms: [] as string[] },
  { name: 'IG', searchTerms: ['IG Group'] },
  { name: 'Pepperstone', searchTerms: [] as string[] },
];

test('source catalog drops out-of-window news, de-duplicates links, and tags the brand a headline names', () => {
  const window = trendWindow(NOW, 30);
  const sources = buildTrendSourceCatalog({
    brandNews: [
      { brand: 'Exness', hits: [
        { title: 'Exness sponsors esports team', url: 'https://news.example/a', publishedAt: '2026-11-01', publisher: 'Esports Insider' },
        { title: 'Exness old story', url: 'https://news.example/old', publishedAt: '2026-01-01', publisher: 'X' },
        { title: 'Exness Review 2026 – Is It Legit, Safe and Regulated? - FXLeaders', url: 'https://news.example/review', publishedAt: '2026-11-02', publisher: 'FXLeaders' },
      ] },
      { brand: 'Pepperstone', hits: [
        { title: 'Averaging down stocks: when to use it - Pepperstone', url: 'https://news.example/own-blog', publishedAt: '2026-11-02', publisher: 'Pepperstone' },
      ] },
    ],
    themeNews: [
      { theme: 'sponsorships', hits: [
        { title: 'Exness sponsors esports team', url: 'https://news.example/a', publishedAt: '2026-11-01', publisher: 'Esports Insider' },
        { title: 'Pepperstone signs football deal', url: 'https://news.example/b', publishedAt: '2026-11-03', publisher: 'SportsPro' },
        { title: 'Some broker launches promo', url: 'https://news.example/c', publishedAt: '2026-11-04', publisher: 'FM' },
        { title: '5 Best Forex Brokers in Egypt for 2026 - FXEmpire', url: 'https://news.example/list', publishedAt: '2026-11-04', publisher: 'FXEmpire' },
      ] },
    ],
    pages: [{ brand: 'IG', page: { url: 'https://www.iggroup.com/news/x', title: 'IG launches app feature', description: 'New', publishedAt: '2026-11-05', excerpt: 'Feature' } },
      { brand: 'IG', page: { url: 'https://www.iggroup.com/news/y', title: 'Undated page', description: '', publishedAt: null, excerpt: 'Old' } }],
  }, window, BRANDS);
  assert.deepEqual(sources.map(source => source.url), ['https://www.iggroup.com/news/x', 'https://news.example/a', 'https://news.example/b', 'https://news.example/c']);
  assert.deepEqual(sources.map(source => source.brand), ['IG', 'Exness', 'Pepperstone', null]);
  assert.deepEqual(sources.map(source => source.id), ['S1', 'S2', 'S3', 'S4']);
});

test('headline matching ignores the Google News publisher suffix', async () => {
  const { headlineOf, NOISE_HEADLINE } = await import('../src/lib/partnership/trends');
  assert.equal(headlineOf({ title: 'Averaging down stocks - CMC Markets', publisher: 'CMC Markets' }), 'Averaging down stocks');
  assert.equal(headlineOf({ title: 'XTB launches app', publisher: '' }), 'XTB launches app');
  assert.ok(NOISE_HEADLINE.test('Exness vs XM: which is better'));
  assert.ok(!NOISE_HEADLINE.test('IC Launches New Guillermo Ochoa Campaign'));
});

function catalog(): TrendSource[] {
  return [
    { id: 'S1', kind: 'news', url: 'https://news.example/a', evidenceId: null, title: 'Exness sponsors esports team', date: '2026-11-01', excerpt: 'Exness sponsors esports team (Esports Insider)', brand: 'Exness' },
    { id: 'S2', kind: 'news', url: 'https://news.example/b', evidenceId: null, title: 'Pepperstone signs football deal', date: '2026-11-03', excerpt: 'Pepperstone signs football deal', brand: 'Pepperstone' },
    { id: 'S3', kind: 'news', url: 'https://news.example/c', evidenceId: null, title: 'Vantage launches copy-trading contest', date: '2026-11-04', excerpt: 'Vantage launches copy-trading contest', brand: null },
    { id: 'S4', kind: 'website', url: 'https://www.iggroup.com/news/x', evidenceId: null, title: 'IG launches app feature', date: '2026-11-05', excerpt: 'Feature', brand: 'IG' },
  ];
}

test('the parser keeps only cited, in-window, correctly attributed items and links ideas and trends to surviving items', () => {
  const window = trendWindow(NOW, 30);
  const raw = JSON.stringify({
    summary: 'Sports sponsorships dominate.',
    items: [
      { id: 'I1', theme: 'sponsorships', brand: 'exness', title: 'Esports sponsorship', summary: 'Exness backs a team.', date: '2026-11-01', sourceIds: ['S1'] },
      { id: 'I2', theme: 'sponsorships', brand: 'Pepperstone', title: 'Football deal', summary: 'Club partner.', sourceIds: ['s2'] },
      { id: 'I3', theme: 'promos', brand: 'Vantage', title: 'Copy-trading contest', summary: 'Contest.', sourceIds: ['S3'] },
      { id: 'I4', theme: 'product', brand: 'IG Group', title: 'App feature', summary: 'New feature.', sourceIds: ['S4'] },
      { id: 'I5', theme: 'promos', brand: 'Exness', title: 'Uncited promo', summary: 'Made up.', sourceIds: [] },
      { id: 'I6', theme: 'promos', brand: 'Exness', title: 'Ghost source', summary: 'Made up.', sourceIds: ['S99'] },
      { id: 'I7', theme: 'regulation', brand: 'Exness', title: 'Misattributed', summary: 'Source is about Pepperstone.', sourceIds: ['S2'] },
      { id: 'I8', theme: 'gossip', brand: 'Exness', title: 'Bad theme', summary: '', sourceIds: ['S1'] },
    ],
    topTrends: [
      { title: 'Sports sponsorship wave', detail: 'Two brokers bought sports exposure.', itemIds: ['I1', 'I2'] },
      { title: 'Uncited trend', detail: 'No items.', itemIds: ['I5'] },
    ],
    ideas: [
      { title: 'Local esports partnership', detail: 'Sponsor an Indonesian esports league with education content.', itemIds: ['I1'] },
      { title: 'Guaranteed returns campaign', detail: 'Promise guaranteed profit to new traders.', itemIds: ['I3'] },
      { title: 'Deposit bonus push', detail: 'Run a deposit bonus for new accounts.', itemIds: ['I3'] },
      { title: 'Idea about nothing', detail: 'Cites a dropped item.', itemIds: ['I6'] },
      { title: 'Award brag', detail: 'Dupoin is Best Broker Forbes 2025. Host a trading-education week.', itemIds: ['I4'] },
    ],
  });
  const parsed = parseTrendsResponse(raw, catalog(), window, BRANDS);
  assert.deepEqual(parsed.items.map(item => [item.id, item.brand, item.title]), [
    ['T1', 'Exness', 'Esports sponsorship'],
    ['T2', 'Pepperstone', 'Football deal'],
    ['T3', 'Vantage', 'Copy-trading contest'],
    ['T4', 'IG', 'App feature'],
  ]);
  assert.equal(parsed.items[1].date, '2026-11-03', 'date falls back to the cited source');
  assert.deepEqual(parsed.items[0].sources.map(source => source.url), ['https://news.example/a']);
  assert.equal(parsed.summary, 'Sports sponsorships dominate.');
  assert.deepEqual(parsed.topTrends.map(trend => [trend.title, trend.itemIds]), [['Sports sponsorship wave', ['T1', 'T2']]]);
  assert.deepEqual(parsed.ideas.map(idea => [idea.title, idea.itemIds]), [
    ['Local esports partnership', ['T1']],
    ['Deposit bonus push', ['T3']],
    ['Award brag', ['T4']],
  ]);
  assert.match(parsed.ideas[1].complianceNote || '', /Compliance/);
  assert.equal(parsed.ideas[0].complianceNote, null);
  assert.equal(parsed.ideas[2].detail, 'Host a trading-education week.', 'unverified award claims are stripped');
  assert.ok(parsed.dropped >= 4);
});

test('items whose only sources are outside the window are dropped, and a model date outside the window is replaced', () => {
  const window = trendWindow(NOW, 30);
  const sources: TrendSource[] = [
    { id: 'S1', kind: 'website', url: 'https://x.example/old', evidenceId: null, title: 'Exness old', date: '2026-01-01', excerpt: 'Exness', brand: 'Exness' },
    { id: 'S2', kind: 'news', url: 'https://x.example/new', evidenceId: null, title: 'Exness new', date: '2026-11-10', excerpt: 'Exness', brand: 'Exness' },
  ];
  const parsed = parseTrendsResponse({
    items: [
      { id: 'a', theme: 'promos', brand: 'Exness', title: 'Old', summary: '', sourceIds: ['S1'] },
      { id: 'b', theme: 'promos', brand: 'Exness', title: 'New', summary: '', date: '2025-01-01', sourceIds: ['S2'] },
    ],
  }, sources, window, BRANDS);
  assert.deepEqual(parsed.items.map(item => [item.title, item.date]), [['New', '2026-11-10']]);
});

test('the prompt treats sources as untrusted, names the watchlist, and demands sourceIds and itemIds', () => {
  const prompt = buildTrendsPrompt(catalog(), trendWindow(NOW, 30), BRANDS);
  assert.match(prompt.system, /untrusted/i);
  assert.match(prompt.system, /BAPPEBTI/);
  assert.match(prompt.system, /sourceIds/);
  assert.match(prompt.system, /itemIds/);
  assert.match(prompt.system, /guaranteed/i);
  for (const theme of TREND_THEMES) assert.match(prompt.system, new RegExp(theme));
  assert.match(prompt.user, /Watchlist: Exness, IG, Pepperstone/);
  assert.match(prompt.user, /\[S1\] \(news, 2026-11-01, Exness\)/);
});

test('one digest per week', () => {
  assert.equal(isTrendsDigestDue(null, NOW), true);
  assert.equal(isTrendsDigestDue('2026-11-10T00:00:00Z', NOW), false);
  assert.equal(isTrendsDigestDue('2026-11-08T07:00:00Z', NOW), true);
});

function deps(overrides: Partial<TrendsDeps> = {}): TrendsDeps & { calls: Record<string, string[]> } {
  const calls: Record<string, string[]> = { news: [], crawl: [], serper: [], complete: [] };
  return {
    calls,
    now: () => NOW,
    fetchNews: async query => {
      calls.news.push(query);
      if (query.includes('"Exness"')) return [{ title: 'Exness sponsors esports team', url: 'https://news.example/a', publishedAt: '2026-11-01', publisher: 'EI' }];
      if (query.startsWith('(forex OR CFD) broker sponsor')) return [{ title: 'Pepperstone signs football deal', url: 'https://news.example/b', publishedAt: '2026-11-03', publisher: 'SP' }];
      return [];
    },
    crawlPages: async url => {
      calls.crawl.push(url);
      return { timedOut: false, pages: [{ url: 'https://pepperstone.example/press/new-app', html: '<title>Pepperstone launches app</title><meta property="article:published_time" content="2026-11-07"><body>App</body>' }] };
    },
    searchNews: async query => { calls.serper.push(query); return null; },
    complete: async (_system, user) => {
      calls.complete.push(user);
      return {
        model: 'stub/model',
        content: JSON.stringify({
          summary: 'Sponsorship and app launches.',
          items: [
            { id: 'I1', theme: 'sponsorships', brand: 'Exness', title: 'Esports', summary: 's', sourceIds: ['S2'] },
            { id: 'I2', theme: 'sponsorships', brand: 'Pepperstone', title: 'Football', summary: 's', sourceIds: ['S3'] },
            { id: 'I3', theme: 'product', brand: 'Pepperstone', title: 'App', summary: 's', sourceIds: ['S1'] },
          ],
          topTrends: [{ title: 'Sports', detail: 'd', itemIds: ['I1', 'I2'] }],
          ideas: [{ title: 'Esports for Dupoin', detail: 'd', itemIds: ['I1'] }],
        }),
      };
    },
    ...overrides,
  };
}

const WATCH = [
  { name: 'Exness', website: 'https://www.exness.com/', newsroomUrl: null, searchTerms: [] as string[] },
  { name: 'Pepperstone', website: 'https://pepperstone.com/en', newsroomUrl: 'https://pepperstone.com/en/about-us/press', searchTerms: [] as string[] },
];

test('digest reads brand news, theme news, and newsrooms, then keeps cited items with counts per theme', async () => {
  const fake = deps();
  const progress: number[] = [];
  const { result, model } = await buildTrendsDigest(WATCH, 30, { ...fake, onProgress: value => { progress.push(value); } });
  assert.equal(model, 'stub/model');
  assert.equal(fake.calls.news.length, WATCH.length + TREND_THEMES.length);
  assert.ok(fake.calls.news.every(query => query.endsWith('when:30d')));
  assert.deepEqual(fake.calls.crawl, ['https://pepperstone.com/en/about-us/press']);
  assert.equal(result.windowDays, 30);
  assert.deepEqual(result.window, trendWindow(NOW, 30));
  assert.deepEqual(result.items.map(item => item.title), ['Esports', 'Football', 'App']);
  assert.equal(result.counts.sponsorships, 2);
  assert.equal(result.counts.product, 1);
  assert.equal(result.topTrends.length, 1);
  assert.equal(result.ideas.length, 1);
  assert.deepEqual(result.brands, ['Exness', 'Pepperstone']);
  assert.ok(result.notes.some(note => /SERPER_API_KEY/.test(note)));
  assert.ok(result.notes.some(note => /Exness: no newsroom/.test(note)));
  assert.ok(result.notes.includes('Pepperstone: newsroom read 1 page(s); 1 dated inside the window.'));
  assert.ok(progress.length > 3 && progress.every((value, index) => index === 0 || value >= progress[index - 1]));
});

test('a news or crawl failure is noted, not fatal; with no sources the model is not called', async () => {
  const fake = deps({
    fetchNews: async () => { throw new Error('rss down'); },
    crawlPages: async () => { throw new Error('blocked'); },
  });
  const { result, model } = await buildTrendsDigest(WATCH, 90, fake);
  assert.equal(model, null);
  assert.equal(fake.calls.complete.length, 0);
  assert.equal(result.items.length, 0);
  assert.ok(result.notes.some(note => /news search failed/i.test(note)));
  assert.ok(result.notes.some(note => /could not be read/i.test(note)));
  assert.ok(result.notes.some(note => /No sources/i.test(note)));
});

test('Serper news is used when a key is configured', async () => {
  const fake = deps({ searchNews: async query => [{ title: `Exness ${query.slice(0, 10)}`, url: `https://serper.example/${encodeURIComponent(query)}`, publishedAt: '2026-11-09', publisher: 'S' }] });
  const { result } = await buildTrendsDigest(WATCH, 30, fake);
  assert.match(fake.calls.complete[0], /\(web, 2026-11-09, Exness\) .*<https:\/\/serper\.example\//);
  assert.ok(!result.notes.some(note => /SERPER_API_KEY/.test(note)));
});

test('sidebar, page, gated routes, cron, and migration 059 are wired', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /href: '\/dashboard\/partnership\/global-trends', label: 'Global Industry Trends', icon: '[a-z]+', feature: 'partnership'/);
  assert.ok(existsSync('src/app/dashboard/partnership/global-trends/page.tsx'));
  const routes = [
    'src/app/api/partnership/trends/route.ts',
    'src/app/api/partnership/trends/[id]/route.ts',
    'src/app/api/partnership/trend-brands/route.ts',
    'src/app/api/partnership/trend-brands/[id]/route.ts',
  ];
  for (const route of routes) {
    const source = read(route);
    const handlers = [...source.matchAll(/export async function (GET|POST|PUT|DELETE)\b[\s\S]*?\n}/g)];
    assert.ok(handlers.length > 0, route);
    for (const handler of handlers) assert.match(handler[0], /requireFeature\(request, 'partnership'\)/, `${route} ${handler[1]}`);
  }
  assert.match(read('scripts/run-partnership-refresh.ts'), /runDueTrendsDigest\(/);
  assert.match(read('src/app/api/partnership/cron/refresh/route.ts'), /runDueTrendsDigest\(/);
  const generation = read('src/lib/partnership/trends-run.ts');
  assert.match(generation, /generateContent\(/);
  assert.match(generation, /crawlSite\(/);
  assert.match(generation, /taskType: 'partnership-global-trends'/);
  const sql = read('db/migrations/059_partnership_global_trends.sql');
  assert.match(sql, /^\s*(--[^\n]*\n\s*)*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(sql, /'competitor-activity', 'global-trends'/);
  assert.ok(existsSync('db/rollbacks/059_partnership_global_trends_down.sql'));
});

test('Serper news results resolve relative dates and skip entries without a link', async () => {
  const { parseSerperNews } = await import('../src/lib/partnership/trends');
  const hits = parseSerperNews({ news: [
    { title: 'Exness sponsors club', link: 'https://n.example/1', date: '3 days ago', source: 'SportsPro' },
    { title: 'XTB launches app', link: 'https://n.example/2', date: 'Oct 3, 2026', source: 'FM' },
    { title: 'No link', date: '1 day ago' },
    { title: 'Odd date', link: 'https://n.example/3', date: 'yesterday-ish' },
    { title: '2 hours', link: 'https://n.example/4', date: '2 hours ago' },
  ] }, NOW);
  assert.deepEqual(hits.map(hit => [hit.url, hit.publishedAt]), [
    ['https://n.example/1', '2026-11-12'], ['https://n.example/2', '2026-10-03'], ['https://n.example/3', null], ['https://n.example/4', '2026-11-15'],
  ]);
  assert.deepEqual(parseSerperNews(null, NOW), []);
});
