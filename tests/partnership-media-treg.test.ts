import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTregMentions, parseTregMediaRows, tregRows } from '../src/lib/partnership/media-treg';
import { MEDIA_TREG_SPECS, estimateMediaTreg, parseMediaTregPlatforms, tregTermsFor } from '../src/lib/partnership/media-treg-platforms';
import { normalizeMediaSettings } from '../src/lib/partnership/media';
import type { TregConfig } from '../src/lib/seo/treg-client';

const config: TregConfig = { apiKey: 'test-token', baseUrl: 'https://treg.to', dailyLimitMicro: 5_000_000, lowBalanceMicro: 0, adminOnly: false, org: null };
const { settings } = normalizeMediaSettings({ keywords: ['Dupoin Futures', 'Dupoin', 'Dupoin Academy', 'Fourth'], hashtags: ['#dupoin'] });
const range = { from: '2026-11-01', to: '2026-11-18' };

test('estimate: catalog price x terms (max 3), hashtags for Instagram hashtag posts', () => {
  assert.deepEqual(tregTermsFor('instagram_hashtag', settings), ['dupoin']);
  assert.deepEqual(tregTermsFor('x', settings), ['Dupoin Futures', 'Dupoin', 'Dupoin Academy']);
  const estimate = estimateMediaTreg(settings, ['instagram_hashtag', 'x', 'facebook']);
  assert.equal(estimate.calls, 1 + 3 + 3);
  assert.equal(estimate.totalMicro, 1_880 + 3 * 750 + 3 * 29_520);
  assert.deepEqual(parseMediaTregPlatforms(['x', 'bogus', 'news']), ['x', 'news']);
  assert.equal(MEDIA_TREG_SPECS.facebook.endpoint, 'justoneapi.x.facebook-search-post-v1');
});

test('provider-native rows: Instagram, TikTok, X, Threads edges, YouTube, Google News', () => {
  const ig = parseTregMediaRows('instagram_hashtag', { output: { posts: [{ code: 'Cabc', caption: { text: 'Belajar trading #dupoin' }, user: { username: 'fan1' }, like_count: 10, comment_count: 2, taken_at: 1763251200 }] } }, 'dupoin');
  assert.equal(ig[0].url, 'https://www.instagram.com/p/Cabc/');
  assert.equal(ig[0].likes, 10);
  assert.equal(ig[0].channel, 'instagram');
  const tt = parseTregMediaRows('tiktok', { output: { videos: [{ aweme_id: '123', desc: 'Dupoin review', author: { unique_id: 'tt1' }, statistics: { digg_count: 5, play_count: 900, share_count: 1 } }] } }, 'Dupoin');
  assert.equal(tt[0].url, 'https://www.tiktok.com/@tt1/video/123');
  assert.equal(tt[0].views, 900);
  const x = parseTregMediaRows('x', { output: { posts: [{ id: '99', text: 'Dupoin?', authorHandle: 'xuser', likeCount: 3, retweetCount: 1 }] } }, 'Dupoin');
  assert.equal(x[0].url, 'https://x.com/xuser/status/99');
  const threads = parseTregMediaRows('threads', { output: { posts: [{ node: { thread_items: [{ post: { code: 'T1', caption: { text: 'Dupoin event' }, user: { username: 'th' }, like_count: 4 } }] } }] } }, 'Dupoin');
  assert.equal(threads[0].url, 'https://www.threads.net/@th/post/T1');
  const yt = parseTregMediaRows('youtube', { output: { videos: [{ id: 'abcdefghijk', title: 'Dupoin webinar', channel: { name: 'Ch' }, viewCount: '1,234' }] } }, 'Dupoin');
  assert.equal(yt[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(yt[0].views, 1234);
  const news = parseTregMediaRows('news', { output: { results: [{ title: 'Dupoin di Kontan', link: 'https://kontan.co.id/a', source: 'Kontan', snippet: 's' }] } }, 'Dupoin');
  assert.equal(news[0].channel, 'online_media');
  assert.equal(news[0].sourceName, 'Kontan');
  assert.equal(tregRows({ data: { data: [{ url: 'https://facebook.com/1', message: 'hi' }] } }).length, 1);
});

test('manual run: cost from X-Treg-Cost-Micro, Facebook goes as GET with query, ceiling header sent', async () => {
  const seen: Array<{ url: string; method: string; ceiling: string | null }> = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    seen.push({ url, method: String(init.method), ceiling: headers['X-Treg-Route-Max-Cost'] ?? null });
    const body = url.includes('facebook') ? { code: 0, data: { data: [{ url: 'https://www.facebook.com/p/1', message: 'Dupoin' }] } } : { output: { posts: [{ id: '1', text: 'Dupoin', authorHandle: 'a' }] } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'X-Treg-Cost-Micro': url.includes('facebook') ? '29520' : '750', 'X-Treg-Call-Id': 'c' } });
  };
  const one = normalizeMediaSettings({ keywords: ['Dupoin'] }).settings;
  const outcome = await fetchTregMentions(config, { runId: 'run1', trigger: 'manual', platforms: ['x', 'facebook'], settings: one, range }, fetchImpl);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.calls, 2);
  assert.equal(outcome.costMicro, 750 + 29_520);
  assert.equal(outcome.mentions.length, 2);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].ceiling, '0.0050');
  assert.equal(seen[1].method, 'GET');
  assert.match(seen[1].url, /\/call\/justoneapi\.x\.facebook-search-post-v1\?keyword=Dupoin&startDate=2026-11-01&endDate=2026-11-18/);
});

test('insufficient balance stops remaining calls and falls back (notes, no throw)', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'insufficient_balance', balance_micro: 120 }), { status: 402 });
  };
  const outcome = await fetchTregMentions(config, { runId: 'run2', trigger: 'manual', platforms: ['x', 'tiktok'], settings, range }, fetchImpl);
  assert.equal(calls, 1);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.refusalBalanceMicro, 120);
  assert.ok(outcome.notes[0].includes('insufficient balance'));
  assert.ok(outcome.notes.some(note => note.includes('skipped: treg stopped')));
});
