import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_AD_VALUE, buildMediaDashboard, channelFromUrl, compactNumber, dedupeMentions, estimatedAdValue, estimatedReach, isGoogleAlertsFeedUrl,
  isOfficialMention, mentionUrlKey, normalizeMediaSettings, parseDateRange, parseInsightsResponse, parseSentimentResponse, rawMention, unwrapGoogleRedirect,
  type MediaMention,
} from '../src/lib/partnership/media';
import {
  collectFreeMentions, gdeltDate, parseGdelt, parseGoogleAlertsAtom, parseGoogleNewsMentions, parseYoutubeSearch, applyYoutubeStats, searchTerms, type FreeSourceDeps,
} from '../src/lib/partnership/media-sources';

const feed = readFileSync('tests/fixtures/google-alerts-feed.xml', 'utf8');
// Real feed fetched 18 Nov 2026 from a Google Alerts "Deliver to: RSS feed" URL (no entries at that moment).
const liveEmpty = readFileSync('tests/fixtures/google-alerts-feed-empty-live.xml', 'utf8');

test('Google Alerts Atom: entries parsed, redirect links unwrapped, HTML and entities stripped', () => {
  const parsed = parseGoogleAlertsAtom(feed);
  assert.equal(parsed.feedTitle, 'dupoin');
  assert.equal(parsed.items.length, 2);
  const [first, second] = parsed.items;
  assert.equal(first.url, 'https://news.example.co.id/ekonomi/dupoin-edukasi?utm_source=alert');
  assert.equal(first.title, 'Dupoin Futures gelar edukasi trading di Surabaya');
  assert.equal(first.snippet, 'PT Dupoin Futures Indonesia mengadakan seminar & edukasi ...');
  assert.equal(first.publishedAt, '2026-11-16T03:15:00.000Z');
  assert.equal(first.source, 'google_alerts');
  assert.equal(first.channel, 'online_media');
  assert.equal(first.sourceName, 'news.example.co.id');
  assert.equal(second.title, "Analisis emas mingguan 'Dupoin'");
});

test('Google Alerts Atom: the real (currently empty) feed parses to its title and no items', () => {
  const parsed = parseGoogleAlertsAtom(liveEmpty);
  assert.equal(parsed.feedTitle, 'dupoin penipu');
  assert.deepEqual(parsed.items, []);
});

test('unwrapGoogleRedirect handles url= and q= and leaves other links alone', () => {
  assert.equal(unwrapGoogleRedirect('https://www.google.com/url?rct=j&sa=t&url=https://a.example/x%3Fy%3D1&ct=ga'), 'https://a.example/x?y=1');
  assert.equal(unwrapGoogleRedirect('https://www.google.co.id/url?q=https://b.example/'), 'https://b.example/');
  assert.equal(unwrapGoogleRedirect('https://www.google.com/url?url=javascript:alert(1)'), 'https://www.google.com/url?url=javascript:alert(1)');
  assert.equal(unwrapGoogleRedirect('https://c.example/'), 'https://c.example/');
});

test('only Google Alerts feed URLs are accepted in Settings', () => {
  assert.ok(isGoogleAlertsFeedUrl('https://www.google.com/alerts/feeds/06080713324255246800/8125963208260089004'));
  assert.ok(!isGoogleAlertsFeedUrl('http://www.google.com/alerts/feeds/1/2'));
  assert.ok(!isGoogleAlertsFeedUrl('https://evil.example/alerts/feeds/1/2'));
  assert.ok(!isGoogleAlertsFeedUrl('https://www.google.com/alerts'));
  const { settings, errors } = normalizeMediaSettings({ keywords: 'Dupoin\nDupoin Futures\ndupoin', hashtags: 'dupoin, #DupoinID', alertFeeds: 'https://www.google.com/alerts/feeds/1/2\nhttps://x.example/feed', officialHandles: { instagram: 'https://www.instagram.com/some.account/', website: 'example.com' } });
  assert.deepEqual(settings.keywords, ['Dupoin', 'Dupoin Futures']);
  assert.deepEqual(settings.hashtags, ['#dupoin', '#DupoinID']);
  assert.deepEqual(settings.alertFeeds, ['https://www.google.com/alerts/feeds/1/2']);
  assert.equal(settings.officialHandles.instagram, 'some.account');
  assert.equal(settings.officialHandles.website, 'https://example.com');
  assert.equal(errors.length, 1);
  assert.deepEqual(settings.adValue, DEFAULT_AD_VALUE);
});

test('dedupe by URL: www, tracking params, fragment, trailing slash and Google redirects collapse', () => {
  assert.equal(mentionUrlKey('https://www.news.example/a/?utm_source=x&id=2#top'), mentionUrlKey('https://news.example/a?id=2'));
  assert.equal(mentionUrlKey('https://twitter.com/u/status/1'), mentionUrlKey('https://x.com/u/status/1'));
  assert.equal(mentionUrlKey('https://www.youtube.com/watch?v=abc123&si=zz'), 'youtube.com/watch?v=abc123');
  const merged = dedupeMentions([
    rawMention({ url: 'https://www.google.com/url?url=https://news.example/a', channel: 'online_media', source: 'google_alerts', title: 'A', publishedAt: '2026-11-10T00:00:00.000Z' }),
    rawMention({ url: 'https://news.example/a/', channel: 'online_media', source: 'gdelt', snippet: 'longer snippet', publishedAt: '2026-11-09T00:00:00.000Z', likes: 3 }),
    rawMention({ url: 'https://news.example/b', channel: 'online_media', source: 'google_news' }),
    rawMention({ url: 'not a url', channel: 'online_media', source: 'google_news' }),
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].url, 'https://news.example/a');
  assert.equal(merged[0].title, 'A');
  assert.equal(merged[0].snippet, 'longer snippet');
  assert.equal(merged[0].publishedAt, '2026-11-09T00:00:00.000Z');
  assert.equal(merged[0].likes, 3);
});

test('Google News, GDELT and YouTube parsers', () => {
  const rss = '<rss><channel><item><title>Dupoin buka kantor - Kontan</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Mon, 16 Nov 2026 03:00:00 GMT</pubDate><source url="https://kontan.co.id">Kontan</source></item></channel></rss>';
  const news = parseGoogleNewsMentions(rss, 'Dupoin');
  assert.equal(news.length, 1);
  assert.equal(news[0].title, 'Dupoin buka kantor');
  assert.equal(news[0].sourceName, 'Kontan');
  assert.equal(gdeltDate('20261117T103000Z'), '2026-11-17T10:30:00.000Z');
  const gdelt = parseGdelt({ articles: [{ url: 'https://site.example/x', title: 'T', seendate: '20261117T103000Z', domain: 'site.example' }, { url: 'ftp://no' }] }, 'Dupoin');
  assert.equal(gdelt.length, 1);
  assert.equal(gdelt[0].source, 'gdelt');
  const yt = parseYoutubeSearch({ items: [{ id: { videoId: 'abcdef12345' }, snippet: { title: 'Review &amp; Dupoin', channelTitle: 'Chan', publishedAt: '2026-11-01T00:00:00Z' } }] }, 'Dupoin');
  applyYoutubeStats(yt, { items: [{ id: 'abcdef12345', statistics: { viewCount: '1200', likeCount: '30', commentCount: '4' } }] });
  assert.equal(yt[0].title, 'Review & Dupoin');
  assert.equal(yt[0].views, 1200);
  assert.equal(yt[0].likes, 30);
  assert.equal(channelFromUrl('https://vt.tiktok.com/x'), 'tiktok');
});

test('collectFreeMentions: free sources only, YouTube skipped without a key, failures become notes', async () => {
  const urls: string[] = [];
  const { settings } = normalizeMediaSettings({ keywords: ['Dupoin'], alertFeeds: ['https://www.google.com/alerts/feeds/1/2'] });
  const deps: FreeSourceDeps = {
    now: () => new Date('2026-11-18T00:00:00Z'),
    fetchText: async url => { urls.push(url); if (url.includes('alerts/feeds')) return feed; return '<rss></rss>'; },
    fetchJson: async url => { urls.push(url); throw new Error('429'); },
    youtubeKey: null,
    sleep: async () => undefined,
  };
  const result = await collectFreeMentions(settings, deps);
  assert.equal(result.counts.google_alerts, 2);
  assert.ok(result.notes.some(note => note.includes('YouTube skipped')));
  assert.ok(result.notes.some(note => note.includes('GDELT search failed')));
  assert.ok(urls.every(url => !/treg\.to/.test(url)));
  assert.deepEqual(searchTerms({ keywords: ['A', 'a', 'B'], hashtags: ['#c'] }), ['A', 'B', 'c']);
});

test('reach and ad value are estimates from the editable config', () => {
  const config = { ...DEFAULT_AD_VALUE, cpm: { ...DEFAULT_AD_VALUE.cpm, instagram: 10_000, online_media: 20_000 }, onlineMediaReach: 1_000, engagementToReach: 5 };
  const ig = rawMention({ url: 'https://instagram.com/p/x', channel: 'instagram', source: 'treg', likes: 100, comments: 10, shares: 0 });
  assert.equal(estimatedReach(ig, config), 550);
  assert.equal(estimatedAdValue(ig, config), 5_500);
  assert.equal(estimatedReach({ ...ig, views: 9_000 }, config), 9_000);
  const article = rawMention({ url: 'https://n.example/a', channel: 'online_media', source: 'gdelt' });
  assert.equal(estimatedAdValue(article, config), 20_000);
});

test('official vs earned', () => {
  const handles = { instagram: 'brand.official', website: 'https://brand.example' };
  assert.ok(isOfficialMention({ url: 'https://www.instagram.com/p/abc/', channel: 'instagram', author: 'brand.official' }, handles));
  assert.ok(isOfficialMention({ url: 'https://www.instagram.com/brand.official/', channel: 'instagram', author: null }, handles));
  assert.ok(isOfficialMention({ url: 'https://blog.brand.example/x', channel: 'online_media', author: null }, handles));
  assert.ok(!isOfficialMention({ url: 'https://www.instagram.com/p/abc/', channel: 'instagram', author: 'someone' }, handles));
});

test('dashboard: totals, timeline, sentiment by channel, top posts and sources inside the range only', () => {
  const base = (over: Partial<MediaMention>): MediaMention => ({
    ...rawMention({ url: 'https://n.example/x', channel: 'online_media', source: 'gdelt' }), id: 'm', urlKey: 'k', isOfficial: false, sentiment: null, sentimentReason: null, firstSeenAt: '2026-11-10T00:00:00.000Z', ...over,
  });
  const mentions = [
    base({ id: '1', publishedAt: '2026-11-02T01:00:00.000Z', sentiment: 'positive', sourceName: 'Kontan' }),
    base({ id: '2', publishedAt: '2026-11-02T05:00:00.000Z', channel: 'instagram', author: 'fan', likes: 50, comments: 5, sentiment: 'negative', url: 'https://instagram.com/p/a' }),
    base({ id: '3', publishedAt: '2026-11-03T05:00:00.000Z', sentiment: 'neutral', sourceName: 'Kontan', isOfficial: true }),
    base({ id: '4', publishedAt: '2026-10-01T05:00:00.000Z', sentiment: 'positive' }),
  ];
  const range = { from: '2026-11-01', to: '2026-11-05' };
  const dash = buildMediaDashboard(mentions, range, DEFAULT_AD_VALUE);
  assert.equal(dash.totals.mentions, 3);
  assert.equal(dash.totals.engagement, 55);
  assert.equal(dash.totals.official, 1);
  assert.equal(dash.timeline.length, 5);
  assert.equal(dash.timeline[1].mentions, 2);
  assert.equal(dash.peaks.mentionsDay, '2026-11-02');
  assert.deepEqual(dash.sentiment, { positive: 1, neutral: 1, negative: 1, unscored: 0 });
  assert.deepEqual(dash.byChannel.map(row => [row.channel, row.total]), [['online_media', 2], ['instagram', 1]]);
  assert.equal(dash.topPosts[0].id, '2');
  assert.equal(dash.topSources[0].name, 'Kontan');
  assert.equal(dash.topSources[0].mentions, 2);
  assert.equal(compactNumber(673_940_000), '673.94M');
  assert.equal(compactNumber(2_920), '2,920');
});

test('date range defaults to 30 days and is ordered and capped', () => {
  const range = parseDateRange(null, null, new Date('2026-11-18T00:00:00Z'));
  assert.deepEqual(range, { from: '2026-10-20', to: '2026-11-18' });
  assert.deepEqual(parseDateRange('2026-11-10', '2026-11-01'), { from: '2026-11-01', to: '2026-11-10' });
});

test('LLM replies are parsed defensively', () => {
  const sentiments = parseSentimentResponse('```json\n{"items":[{"id":"a","sentiment":"Positive","reason":"praise"},{"id":"zzz","sentiment":"negative"},{"id":"b","sentiment":"angry"},{"id":"a","sentiment":"negative"}]}\n```', ['a', 'b']);
  assert.deepEqual(sentiments, [{ id: 'a', sentiment: 'positive', reason: 'praise' }]);
  const insights = parseInsightsResponse('{"executiveSummary":"S","keyInsights":["one","two",3],"recommendations":{"strengths":["x"]}}');
  assert.equal(insights.executiveSummary, 'S');
  assert.deepEqual(insights.keyInsights, ['one', 'two']);
  assert.deepEqual(insights.recommendations.fixes, []);
  assert.equal(parseInsightsResponse('not json').executiveSummary, '');
});
