import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTEL_CATEGORIES,
  activityWindow,
  buildComparison,
  buildCombinedOpportunities,
  buildIntelPrompt,
  buildSourceCatalog,
  buildTimeline,
  isRefreshDue,
  mentionsCompetitor,
  newsQuery,
  normalizeInstagramHandle,
  parseCompetitorInput,
  parseEvidenceInput,
  parseIntelResponse,
  parseNewsRssWithDates,
  type IntelSource,
} from '../src/lib/partnership/intel';
import { partnershipCronAuthorization } from '../src/lib/partnership/cron';
import { extractPageFacts, isActivityPage } from '../src/lib/partnership/page-facts';

const NOW = new Date('2026-11-15T08:00:00Z');
const WINDOW = activityWindow(NOW);

test('activity window covers the last 3 months and lists each month', () => {
  assert.equal(WINDOW.end, '2026-11-15');
  assert.equal(WINDOW.start, '2026-08-15');
  assert.deepEqual(WINDOW.months, ['2026-08', '2026-09', '2026-10', '2026-11']);
});

test('the six categories are fixed', () => {
  assert.deepEqual([...INTEL_CATEGORIES], ['campaigns', 'partnerships', 'events', 'products', 'social', 'news']);
});

test('competitor input: name required, region checked, website must be public http(s), no invented URL', () => {
  assert.deepEqual(parseCompetitorInput({ name: '  Elve ', region: 'international', website: '', instagramHandle: '', notes: '' }), {
    value: { name: 'Elve', region: 'international', website: null, instagramHandle: null, notes: null },
  });
  assert.ok('error' in parseCompetitorInput({ name: '', region: 'local' }));
  assert.ok('error' in parseCompetitorInput({ name: 'X', region: 'mars' }));
  assert.ok('error' in parseCompetitorInput({ name: 'X', region: 'local', website: 'ftp://x.com' }));
  assert.ok('error' in parseCompetitorInput({ name: 'X', region: 'local', website: 'http://127.0.0.1/' }));
  const ok = parseCompetitorInput({ name: 'MIFX', region: 'local', website: 'https://MIFX.com/', instagramHandle: '@mifx.official' });
  assert.ok('value' in ok && ok.value.website === 'https://mifx.com/' && ok.value.instagramHandle === 'mifx.official');
});

test('instagram handle accepts @handle or profile URL, rejects junk', () => {
  assert.equal(normalizeInstagramHandle('@abc_def.1'), 'abc_def.1');
  assert.equal(normalizeInstagramHandle('https://www.instagram.com/abc.def/'), 'abc.def');
  assert.equal(normalizeInstagramHandle(''), '');
  assert.equal(normalizeInstagramHandle('not a handle!'), null);
});

test('evidence input: an IG link is stored, caption text kept, at least one is required', () => {
  const link = parseEvidenceInput({ sourceUrl: 'https://www.instagram.com/p/ABC123/', pastedText: 'Promo cashback 50%', observedOn: '2026-10-02' });
  assert.ok('value' in link);
  assert.equal(link.value.kind, 'link');
  assert.equal(link.value.observedOn, '2026-10-02');
  const text = parseEvidenceInput({ pastedText: 'caption only' });
  assert.ok('value' in text && text.value.kind === 'text');
  assert.ok('error' in parseEvidenceInput({}));
  assert.ok('error' in parseEvidenceInput({ sourceUrl: 'javascript:alert(1)' }));
  const bad = parseEvidenceInput({ pastedText: 'x', observedOn: '2026-13-40' });
  assert.ok('value' in bad && bad.value.observedOn === null);
});

test('news query is quoted and limited to the window', () => {
  assert.equal(newsQuery('Forex IMF'), '"Forex IMF" (forex OR broker OR trading) when:90d');
});

test('news headlines must name the competitor', () => {
  assert.equal(mentionsCompetitor('Promo FOREXimf terbaru', 'Forex IMF'), true);
  assert.equal(mentionsCompetitor('Broker Octa rilis akun micro', 'MIFX'), false);
  assert.equal(mentionsCompetitor('Master Trader Championship MIFX', 'mifx'), true);
});

test('Google News RSS keeps the publish date', () => {
  const xml = `<rss><channel>
    <item><title>MIFX gelar edukasi - Kontan</title><link>https://news.google.com/rss/articles/abc?oc=5</link><pubDate>Tue, 06 Oct 2026 07:00:00 GMT</pubDate><source url="https://kontan.co.id">Kontan</source></item>
    <item><title>No link</title><pubDate>Tue, 06 Oct 2026 07:00:00 GMT</pubDate></item>
    <item><title>Old &amp; dated</title><link>https://example.com/a</link><pubDate>garbage</pubDate></item>
  </channel></rss>`;
  const hits = parseNewsRssWithDates(xml);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].url, 'https://news.google.com/rss/articles/abc?oc=5');
  assert.equal(hits[0].publishedAt, '2026-10-06');
  assert.equal(hits[0].publisher, 'Kontan');
  assert.equal(hits[1].title, 'Old & dated');
  assert.equal(hits[1].publishedAt, null);
});

test('page facts read title, description, publish date and an excerpt; scripts are stripped', () => {
  const html = `<html><head><title>Promo Cashback Oktober</title><meta name="description" content="Cashback hingga 50%">
    <meta property="article:published_time" content="2026-10-03T10:00:00+07:00"><script>var x = 1;</script></head>
    <body><h1>Promo</h1><p>Deposit minimal Rp1 juta.</p></body></html>`;
  const facts = extractPageFacts('https://mifx.com/promo/cashback', html);
  assert.equal(facts.title, 'Promo Cashback Oktober');
  const generic = extractPageFacts('https://mifx.com/pro-rebate', '<title>Broker Forex | MIFX</title><body><h1>Pro Rebate</h1></body>');
  assert.equal(generic.title, 'Pro Rebate — Broker Forex | MIFX');
  assert.equal(facts.description, 'Cashback hingga 50%');
  assert.equal(facts.publishedAt, '2026-10-03');
  assert.match(facts.excerpt, /Deposit minimal/);
  assert.doesNotMatch(facts.excerpt, /var x/);
  assert.equal(isActivityPage(facts, WINDOW), true);
  const about = extractPageFacts('https://mifx.com/about', '<title>About us</title><body>History</body>');
  assert.equal(isActivityPage(about, WINDOW), false);
  const oldPromo = { ...facts, publishedAt: '2025-01-01' };
  assert.equal(isActivityPage(oldPromo, WINDOW), false);
});

function sampleSources(): IntelSource[] {
  return buildSourceCatalog({
    pages: [{ url: 'https://mifx.com/promo/cashback', title: 'Promo Cashback', description: '', publishedAt: '2026-10-03', excerpt: 'Cashback 50%' }],
    news: [
      { title: 'MIFX sponsori turnamen', url: 'https://news.example/a', publishedAt: '2026-09-10', publisher: 'News' },
      { title: 'Too old', url: 'https://news.example/old', publishedAt: '2026-01-10', publisher: 'News' },
    ],
    web: [{ title: 'MIFX partner bank', url: 'https://web.example/b', snippet: 'Kerja sama' }],
    evidence: [{ id: 'ev-1', kind: 'link', sourceUrl: 'https://www.instagram.com/p/X/', pastedText: 'Giveaway iPhone', extractedText: null, observedOn: '2026-11-01' }],
  }, WINDOW);
}

test('source catalog numbers sources, drops news outside the window, and labels evidence E1', () => {
  const sources = sampleSources();
  assert.deepEqual(sources.map(source => source.id), ['S1', 'S2', 'S3', 'E1']);
  assert.equal(sources[3].evidenceId, 'ev-1');
  assert.equal(sources[3].url, 'https://www.instagram.com/p/X/');
  assert.ok(!sources.some(source => source.url === 'https://news.example/old'));
});

test('prompt treats sources as untrusted and demands sourceIds', () => {
  const prompt = buildIntelPrompt({ name: 'MIFX', region: 'local' }, sampleSources(), WINDOW);
  assert.match(prompt.system, /sourceIds/);
  assert.match(prompt.system, /Never invent/i);
  assert.match(prompt.user, /\[S1\]/);
  assert.match(prompt.user, /\[E1\]/);
  assert.match(prompt.user, /2026-08-15/);
});

test('every item must cite a known source; uncited items and out-of-window items are dropped', () => {
  const sources = sampleSources();
  const raw = JSON.stringify({
    overview: 'Busy quarter.',
    items: [
      { category: 'campaigns', title: 'Cashback 50%', summary: 'Deposit cashback.', date: '2026-10-03', sourceIds: ['S1'] },
      { category: 'events', title: 'Tournament', summary: 'Sponsor.', sourceIds: ['S2', 'S99'] },
      { category: 'news', title: 'Invented', summary: 'No source.', sourceIds: [] },
      { category: 'news', title: 'Fake id', summary: 'x', sourceIds: ['S42'] },
      { category: 'unknown', title: 'Bad cat', summary: 'x', sourceIds: ['S1'] },
      { category: 'social', title: 'Giveaway', summary: 'IG giveaway.', sourceIds: ['E1'] },
      { category: 'partnerships', title: 'Bank partner', summary: 'Undated web hit.', sourceIds: ['S3'] },
      { category: 'campaigns', title: 'Old', summary: 'x', date: '2025-02-01', sourceIds: ['S3'] },
    ],
    opportunities: [
      { title: 'Counter cashback', detail: 'Run a rebate.', sourceIds: ['S1'] },
      { title: 'No source idea', detail: 'x', sourceIds: [] },
    ],
  });
  const parsed = parseIntelResponse(raw, sources, WINDOW);
  assert.deepEqual(parsed.items.map(item => item.title), ['Cashback 50%', 'Tournament', 'Giveaway', 'Bank partner']);
  assert.equal(parsed.items[0].month, '2026-10');
  assert.equal(parsed.items[1].month, '2026-09');
  assert.equal(parsed.items[1].sources.length, 1);
  assert.equal(parsed.items[2].sources[0].evidenceId, 'ev-1');
  assert.equal(parsed.items[3].month, null);
  assert.deepEqual(parsed.opportunities.map(item => item.title), ['Counter cashback']);
  assert.equal(parsed.overview, 'Busy quarter.');
});

test('a reply that is not JSON yields nothing rather than invented items', () => {
  const parsed = parseIntelResponse('Sorry, I cannot.', sampleSources(), WINDOW);
  assert.deepEqual(parsed.items, []);
  assert.deepEqual(parsed.opportunities, []);
});

test('timeline groups by month newest first, undated last', () => {
  const parsed = parseIntelResponse(JSON.stringify({ items: [
    { category: 'campaigns', title: 'A', summary: 'a', sourceIds: ['S1'] },
    { category: 'events', title: 'B', summary: 'b', sourceIds: ['S2'] },
    { category: 'partnerships', title: 'C', summary: 'c', sourceIds: ['S3'] },
  ] }), sampleSources(), WINDOW);
  const timeline = buildTimeline(parsed.items);
  assert.deepEqual(timeline.map(group => group.month), ['2026-10', '2026-09', 'undated']);
  assert.equal(timeline[0].label, 'October 2026');
});

test('comparison counts items per category for each competitor', () => {
  const parsed = parseIntelResponse(JSON.stringify({ items: [
    { category: 'campaigns', title: 'A', summary: 'a', sourceIds: ['S1'] },
    { category: 'campaigns', title: 'A2', summary: 'a', sourceIds: ['S1'] },
    { category: 'events', title: 'B', summary: 'b', sourceIds: ['S2'] },
  ], opportunities: [{ title: 'Idea', detail: 'd', sourceIds: ['S1'] }] }), sampleSources(), WINDOW);
  const rows = buildComparison([
    { competitor: { id: 'c1', name: 'MIFX', region: 'local' }, report: { finishedAt: '2026-11-15T01:00:00Z', items: parsed.items } },
    { competitor: { id: 'c2', name: 'Elve', region: 'international' }, report: null },
  ]);
  assert.equal(rows[0].counts.campaigns, 2);
  assert.equal(rows[0].counts.events, 1);
  assert.equal(rows[0].total, 3);
  assert.equal(rows[0].headline, 'A');
  assert.equal(rows[1].total, 0);
  assert.equal(rows[1].lastRefreshed, null);
  const combined = buildCombinedOpportunities([{ competitorName: 'MIFX', opportunities: parsed.opportunities }]);
  assert.equal(combined[0].competitorName, 'MIFX');
  assert.equal(combined[0].sources[0].url, 'https://mifx.com/promo/cashback');
});

test('weekly refresh is due after 7 days or when never refreshed', () => {
  assert.equal(isRefreshDue(null, NOW), true);
  assert.equal(isRefreshDue('2026-11-10T00:00:00Z', NOW), false);
  assert.equal(isRefreshDue('2026-11-07T00:00:00Z', NOW), true);
});

test('cron secret is required and compared safely', () => {
  assert.equal(partnershipCronAuthorization('abc', ''), 'missing');
  assert.equal(partnershipCronAuthorization('abc', 'abd'), 'rejected');
  assert.equal(partnershipCronAuthorization(null, 'abc'), 'rejected');
  assert.equal(partnershipCronAuthorization(' abc ', 'abc'), 'ok');
});
