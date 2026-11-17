import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompetitorReport, type CollectDeps } from '../src/lib/partnership/collect';

const NOW = new Date('2026-11-15T08:00:00Z');

function deps(overrides: Partial<CollectDeps> = {}): CollectDeps & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { crawl: [], news: [], web: [], complete: [] };
  return {
    calls,
    now: () => NOW,
    crawlPages: async url => {
      calls.crawl.push(url);
      return {
        timedOut: false,
        pages: [
          { url: 'https://broker.example/promo/oktober', html: '<title>Promo Oktober</title><meta property="article:published_time" content="2026-10-01"><body>Bonus deposit</body>' },
          { url: 'https://broker.example/about', html: '<title>About</title><body>Company</body>' },
        ],
      };
    },
    fetchNews: async query => {
      calls.news.push(query);
      return [{ title: 'Broker sponsors expo', url: 'https://news.example/expo', publishedAt: '2026-09-20', publisher: 'News' }];
    },
    searchWeb: async query => {
      calls.web.push(query);
      return null;
    },
    complete: async (system, user) => {
      calls.complete.push(user);
      return {
        model: 'test/model',
        content: JSON.stringify({
          overview: 'Promo and expo.',
          items: [
            { category: 'campaigns', title: 'October deposit bonus', summary: 'Bonus.', sourceIds: ['S1'] },
            { category: 'events', title: 'Expo sponsor', summary: 'Sponsor.', sourceIds: ['S2'] },
            { category: 'social', title: 'Giveaway reels', summary: 'IG.', sourceIds: ['E1'] },
            { category: 'news', title: 'Made up', summary: 'none', sourceIds: [] },
          ],
          opportunities: [{ title: 'Expo presence', detail: 'Book a booth.', sourceIds: ['S2'] }],
        }),
      };
    },
    ...overrides,
  };
}

const competitor = { name: 'Broker', region: 'local', website: 'https://broker.example/' };
const evidence = [{ id: 'ev-1', kind: 'text', sourceUrl: 'https://www.instagram.com/p/Z/', pastedText: 'Giveaway reels every Friday', extractedText: null, observedOn: '2026-11-01' }];

test('refresh reads website activity pages, news, and evidence, and keeps only cited items', async () => {
  const fake = deps();
  const { result, model } = await buildCompetitorReport(competitor, evidence, fake);
  assert.equal(model, 'test/model');
  assert.deepEqual(fake.calls.crawl, ['https://broker.example/']);
  assert.equal(result.sources.filter(source => source.kind === 'website').length, 1, 'About page is not an activity page');
  assert.deepEqual(result.items.map(item => item.title), ['October deposit bonus', 'Expo sponsor', 'Giveaway reels']);
  assert.equal(result.counts.campaigns, 1);
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.window.start, '2026-08-15');
  assert.ok(result.notes.some(note => /web search/i.test(note)), 'notes say web search was skipped');
  assert.match(String(fake.calls.complete[0]), /Giveaway reels every Friday/);
});

test('a competitor without a website is not crawled and no URL is invented', async () => {
  const fake = deps();
  const { result } = await buildCompetitorReport({ ...competitor, website: null }, [], fake);
  assert.deepEqual(fake.calls.crawl, []);
  assert.ok(result.notes.some(note => /No website/i.test(note)));
  assert.ok(result.sources.every(source => source.kind !== 'website'));
});

test('no sources at all skips the model and returns an empty report', async () => {
  const fake = deps({ fetchNews: async () => [], crawlPages: async () => ({ pages: [], timedOut: false }) });
  const { result, model } = await buildCompetitorReport({ ...competitor, website: null }, [], fake);
  assert.equal(model, null);
  assert.equal(fake.calls.complete.length, 0);
  assert.deepEqual(result.items, []);
  assert.ok(result.notes.some(note => /No sources/i.test(note)));
});

test('a crawl or news failure is noted, not fatal', async () => {
  const fake = deps({
    crawlPages: async () => { throw new Error('boom'); },
    fetchNews: async () => { throw new Error('rss down'); },
  });
  const { result } = await buildCompetitorReport(competitor, evidence, fake);
  assert.ok(result.notes.some(note => /website could not be read/i.test(note)));
  assert.ok(result.notes.some(note => /news search failed/i.test(note)));
  assert.deepEqual(result.items.map(item => item.title), ['Giveaway reels']);
});

/* ---- MIFX Priority: free sources vs pasted IG link vs optional treg feed (17 Nov 2026) ---- */
import { readFileSync } from 'node:fs';
import { parseTregInstagramPosts } from '../src/lib/partnership/campaigns';

const MIFX_NOW = new Date('2026-11-17T03:00:00Z');
const ZENDESK = JSON.stringify({ articles: [
  { title: 'MIFX Priority Hub', html_url: 'https://support.mifx.com/hc/id/articles/43413762259351-MIFX-Priority-Hub', created_at: '2026-09-11T03:00:00Z', updated_at: '2026-11-16T01:00:00Z', body: '<p>MIFX Priority Hub adalah fitur khusus di aplikasi MIFX untuk Priority Client.</p>' },
  { title: 'Bagaimana Cara Log in?', html_url: 'https://support.mifx.com/hc/id/articles/1', created_at: '2021-05-11T03:00:00Z', updated_at: '2026-11-16T01:00:00Z', body: '' },
] });
const IG_PAGE = '<meta property="og:description" content="75 likes, 1 comments - mifx.indonesia on September 21, 2026: &quot;Satu Ruang untuk Segala Keistimewaan Anda.\n\nMulai hari ini, semua keistimewaan Priority Client hadir dalam satu ruang “MIFX Priority Hub”.\n\nKarena trader di level tertinggi, layak mendapat layanan yang eksklusif.\n\n#mifx #tradingforex&quot;." />';

/** Model stub: classifies like the prompt asks, citing only sources that mention MIFX Priority. */
function mifxModel(calls: string[]) {
  return async (_system: string, user: string) => {
    calls.push(user);
    const blocks = user.split(/\n(?=\[[SE]\d+\])/);
    const priority = blocks.filter(block => /MIFX Priority/.test(block)).map(block => block.match(/^\[([SE]\d+)\]/)?.[1]).filter(Boolean) as string[];
    const withComm = blocks.filter(block => /Satu Ruang untuk Segala Keistimewaan/.test(block)).map(block => block.match(/^\[([SE]\d+)\]/)?.[1]).filter(Boolean) as string[];
    const campaigns = withComm.length ? [{ name: 'MIFX Priority Hub', brandComm: 'Satu Ruang untuk Segala Keistimewaan Anda', hashtags: ['#mifx'], format: 'Reels + carousel launch series', period: 'Sep 2026, ongoing', channels: ['Instagram', 'app'], summary: 'Premium tier hub for Priority Clients.', sourceIds: withComm }] : [];
    const items = !withComm.length && priority.length ? [{ category: 'products', title: 'MIFX Priority Hub', summary: 'In-app hub for Priority Clients.', sourceIds: priority }] : [];
    return { model: 'stub', content: JSON.stringify({ overview: 'MIFX.', campaigns, regularContent: [], items, opportunities: [] }) };
  };
}

function mifxDeps(extra: Partial<CollectDeps> = {}) {
  const calls: string[] = [];
  const fetched: string[] = [];
  const base: CollectDeps = {
    now: () => MIFX_NOW,
    crawlPages: async () => ({ timedOut: false, pages: [{ url: 'https://mifx.com/', html: '<title>MIFX</title><a href="https://support.mifx.com/hc/id">Support</a><a href="https://client.mifx.com/open-live-account">Open</a>' }] }),
    fetchNews: async () => [],
    searchWeb: async () => null,
    fetchPublic: async url => {
      fetched.push(url);
      if (url.startsWith('https://support.mifx.com/api/v2/help_center/id/articles.json')) return { url, status: 200, body: ZENDESK };
      if (url === 'https://www.instagram.com/p/DdjHlscH-Ac/') return { url, status: 200, body: IG_PAGE };
      return { url, status: 404, body: '' };
    },
    complete: mifxModel(calls),
    ...extra,
  };
  return { deps: base, calls, fetched };
}

const MIFX = { name: 'MIFX', region: 'local', website: 'https://mifx.com/', instagramHandle: 'mifx.indonesia' };

test('MIFX, free sources only: the help center (linked subdomain) surfaces MIFX Priority Hub, but not as a campaign', async () => {
  const { deps: d, fetched } = mifxDeps();
  const { result } = await buildCompetitorReport(MIFX, [], d);
  assert.ok(fetched.some(url => url.includes('support.mifx.com/api/v2/help_center/id/articles.json')), 'help-center API read');
  assert.ok(!fetched.some(url => url.includes('client.mifx.com')), 'client area never touched');
  assert.deepEqual(result.items.map(item => item.title), ['MIFX Priority Hub']);
  assert.deepEqual(result.campaigns, []);
  assert.ok(result.notes.some(note => /Paste the campaign's Instagram post link/.test(note)));
});

test('MIFX, team pastes the IG link: caption captured from the public post page and the campaign surfaces', async () => {
  const saved: Array<[string, string]> = [];
  const { deps: d } = mifxDeps({ saveEvidenceText: async (id, text) => { saved.push([id, text]); } });
  const evidence = [{ id: 'ev-ig', kind: 'link', sourceUrl: 'https://www.instagram.com/p/DdjHlscH-Ac/?igsh=abc', pastedText: null, extractedText: null, observedOn: null }];
  const { result } = await buildCompetitorReport(MIFX, evidence, d);
  assert.equal(result.campaigns?.length, 1);
  const campaign = result.campaigns![0];
  assert.equal(campaign.name, 'MIFX Priority Hub');
  assert.equal(campaign.brandComm, 'Satu Ruang untuk Segala Keistimewaan Anda');
  assert.deepEqual(campaign.hashtags, ['#mifx']);
  assert.equal(campaign.date, '2026-09-21');
  assert.equal(campaign.sources[0].evidenceId, 'ev-ig');
  assert.equal(saved[0][0], 'ev-ig');
  assert.match(saved[0][1], /^Instagram post by @mifx\.indonesia on 2026-09-21/);
});

test('MIFX, optional treg feed (real sanitized response): the Priority Hub posts become campaign evidence', async () => {
  const posts = parseTregInstagramPosts(readFileSync('tests/fixtures/partnership-treg-ig-mifx.json', 'utf8'));
  let asked = '';
  const { deps: d, calls } = mifxDeps({ instagramFeed: async handle => { asked = handle; return { posts, note: 'treg Instagram: 12 recent post(s) from @mifx.indonesia, cost $0.0009.' }; } });
  const { result } = await buildCompetitorReport(MIFX, [], d);
  assert.equal(asked, 'mifx.indonesia');
  assert.equal(result.campaigns?.[0]?.name, 'MIFX Priority Hub');
  assert.ok(result.campaigns![0].sources.every(source => source.kind === 'instagram'));
  assert.ok(result.notes.includes('treg Instagram: 12 recent post(s) from @mifx.indonesia, cost $0.0009.'));
  assert.match(calls[0], /\(instagram, 2026-09-21\) Instagram carousel by @mifx\.indonesia/);
});

test('treg feed that declines (null) leaves a free run untouched', async () => {
  const { deps: d } = mifxDeps({ instagramFeed: async () => null });
  const { result } = await buildCompetitorReport(MIFX, [], d);
  assert.deepEqual(result.campaigns, []);
  assert.equal(result.sources.filter(source => source.kind === 'instagram').length, 0);
});

test('multi-platform: free YouTube RSS and treg TikTok/Meta ads posts are citable sources in the prompt', async () => {
  const rss = readFileSync('tests/fixtures/partnership-youtube-rss-mifx.xml', 'utf8');
  const fetched: string[] = [];
  let prompt = '';
  const d = deps({
    fetchPublic: async url => {
      fetched.push(url);
      if (url === 'https://www.youtube.com/user/MifxChannel') return { url, status: 200, body: '<link rel="canonical" href="https://www.youtube.com/channel/UC-l61LxjsphAAjnoQwGTV6Q">' };
      if (url.startsWith('https://www.youtube.com/feeds/videos.xml')) return { url, status: 200, body: rss };
      return null;
    },
    socialFeeds: async () => ({
      instagram: [],
      posts: [
        { platform: 'meta_ads', url: 'https://www.facebook.com/ads/library/?id=1097899522636371', account: 'Monex Investindo Futures', date: '2026-10-05', text: 'MIFX Priority: layanan prioritas', hashtags: [], kind: 'VIDEO', period: '2026-10-05 to now (active)', placements: ['INSTAGRAM'], landingUrl: 'https://get.mifx.com/mifx-priority' },
        { platform: 'tiktok', url: 'https://www.tiktok.com/@mifx.indonesia/video/1', account: 'mifx.indonesia', date: '2026-10-10', text: 'Tips trading #MIFX', hashtags: ['#MIFX'], kind: 'video' },
      ],
      notes: ['treg TikTok: 1 recent video(s) from @mifx.indonesia, cost $0.0011.'],
    }),
    complete: async (_system, user) => { prompt = user; return { model: 'test/model', content: JSON.stringify({ overview: '', items: [], opportunities: [] }) }; },
  });
  const { result } = await buildCompetitorReport({ ...competitor, socialHandles: { youtube: 'user/MifxChannel', tiktok: 'mifx.indonesia' } }, [], d);
  assert.ok(fetched.includes('https://www.youtube.com/feeds/videos.xml?channel_id=UC-l61LxjsphAAjnoQwGTV6Q'));
  assert.ok(result.sources.some(source => source.kind === 'ads' && source.url?.includes('ads/library')));
  assert.ok(result.sources.some(source => source.kind === 'social' && source.url?.includes('tiktok.com')));
  assert.ok(result.notes.some(note => /YouTube: \d+ recent video/.test(note)));
  assert.match(prompt, /Meta ad/);
  assert.match(prompt, /tiktok: mifx\.indonesia|TikTok/i);
});
