import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dedupeMentions, normalizeMediaSettings, rawMention } from '../src/lib/partnership/media';
import { collectFreeMentions, readAlertFeeds, type FreeSourceDeps } from '../src/lib/partnership/media-sources';
import { AlertFeedError, alertFeedId, alertFeedsSummary, cleanAlertFeedUrl, cleanAlertLabel, type AlertFeedRow } from '../src/lib/partnership/google-alerts-store';

const FEED = readFileSync('tests/fixtures/google-alerts-feed.xml', 'utf8');
const A = 'https://www.google.com/alerts/feeds/06080713324255246800/1';
const B = 'https://www.google.com/alerts/feeds/06080713324255246800/2';

test('readAlertFeeds tags every item with its feed id; one broken feed does not stop the others', async () => {
  const results = await readAlertFeeds(
    [{ id: 'fa', url: A, label: 'Brand' }, { id: 'fb', url: B, label: 'Broken' }],
    async url => { if (url === B) throw new Error('HTTP 404'); return FEED; },
  );
  assert.equal(results[0].ok, true);
  assert.equal(results[0].feedTitle, 'dupoin');
  assert.equal(results[0].items.length, 2);
  assert.ok(results[0].items.every(item => item.source === 'google_alerts' && item.alertFeedIds?.[0] === 'fa'));
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error, 'HTTP 404');
  assert.deepEqual(results[1].items, []);
});

test('dedupe by URL keeps one article and merges the feeds that delivered it', () => {
  const merged = dedupeMentions([
    rawMention({ url: 'https://www.news.example.co.id/a/?utm_source=x', channel: 'online_media', source: 'google_news', title: 'From news' }),
    rawMention({ url: 'https://news.example.co.id/a', channel: 'online_media', source: 'google_alerts', alertFeedIds: ['fa'] }),
    rawMention({ url: 'https://news.example.co.id/a#top', channel: 'online_media', source: 'google_alerts', alertFeedIds: ['fb', 'fa'] }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'From news');
  assert.deepEqual(merged[0].alertFeedIds?.sort(), ['fa', 'fb']);
});

test('collectFreeMentions reads the feeds it is given (labels in notes) and reports each feed', async () => {
  const { settings } = normalizeMediaSettings({ keywords: ['Dupoin'] });
  const deps: FreeSourceDeps = {
    now: () => new Date('2026-11-18T00:00:00Z'),
    fetchText: async url => (url === A ? FEED : url === B ? Promise.reject(new Error('HTTP 500')) : '<rss></rss>'),
    fetchJson: async () => ({ articles: [] }),
    youtubeKey: null,
    sleep: async () => undefined,
  };
  const result = await collectFreeMentions(settings, deps, 30, [{ id: 'fa', url: A, label: 'Dupoin brand' }, { id: 'fb', url: B, label: 'Scam watch' }]);
  assert.equal(result.counts.google_alerts, 2);
  assert.equal(result.alertFeeds.length, 2);
  assert.ok(result.notes.includes('Google Alerts "Dupoin brand": 2 item(s).'));
  assert.ok(result.notes.some(note => note.startsWith('Google Alerts "Scam watch" could not be read')));
  const none = await collectFreeMentions(settings, deps, 30, []);
  assert.ok(none.notes.some(note => note.includes('Partnership > Google Alerts')));
});

test('feed URL and label validation', () => {
  assert.equal(cleanAlertFeedUrl(` ${A}/ `), A);
  assert.equal(cleanAlertFeedUrl('https://google.com/alerts/feeds/1/2'), 'https://www.google.com/alerts/feeds/1/2');
  for (const bad of ['', 'https://www.google.com/alerts', 'http://www.google.com/alerts/feeds/1/2', 'https://evil.example/alerts/feeds/1/2', 'https://www.google.com/alerts/feeds/a/b']) {
    assert.throws(() => cleanAlertFeedUrl(bad), AlertFeedError, bad);
  }
  assert.equal(cleanAlertLabel('  Dupoin \n brand  '), 'Dupoin brand');
  assert.equal(cleanAlertLabel('x'.repeat(200)).length, 80);
  assert.equal(alertFeedId(A), alertFeedId(A));
  assert.notEqual(alertFeedId(A), alertFeedId(B));
});

test('alertFeedsSummary: latest fetch, items of that pass, failing feeds', () => {
  const row = (patch: Partial<AlertFeedRow>): AlertFeedRow => ({ id: 'x', url: A, label: '', feedTitle: null, lastFetchedAt: null, lastItemCount: null, lastError: null, articleCount: 0, createdAt: '2026-11-18T00:00:00.000Z', ...patch });
  assert.deepEqual(alertFeedsSummary([]), { count: 0, lastFetchedAt: null, lastItems: 0, failing: 0 });
  assert.deepEqual(alertFeedsSummary([
    row({ lastFetchedAt: '2026-11-18T01:00:00.000Z', lastItemCount: 3 }),
    row({ lastFetchedAt: '2026-11-18T02:00:00.000Z', lastItemCount: 0, lastError: 'HTTP 404' }),
    row({}),
  ]), { count: 3, lastFetchedAt: '2026-11-18T02:00:00.000Z', lastItems: 3, failing: 1 });
});

test('Media Monitoring settings no longer edit Google Alerts feeds; the page links to Google Alerts', () => {
  const route = readFileSync('src/app/api/partnership/media/settings/route.ts', 'utf8');
  assert.match(route, /alertFeeds: current\.alertFeeds/);
  const page = readFileSync('src/app/dashboard/partnership/media-monitoring/page.tsx', 'utf8');
  assert.doesNotMatch(page, /label="Google Alerts RSS feeds"/);
  assert.match(page, /href="\/dashboard\/partnership\/google-alerts"/);
  const layout = readFileSync('src/app/dashboard/layout.tsx', 'utf8');
  assert.match(layout, /href: '\/dashboard\/partnership\/media-monitoring'[^\n]*\n\s*\{ href: '\/dashboard\/partnership\/google-alerts', label: 'Google Alerts'[^\n]*feature: 'partnership'/);
});
