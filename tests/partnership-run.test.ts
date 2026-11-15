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
