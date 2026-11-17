import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TREG_ENDPOINTS, TREG_PLATFORM_SPECS, estimateCompetitorTreg, fetchTregSocialFeeds, parseTregFacebookPosts, parseTregMetaAds,
  parseTregPlatforms, parseTregTiktokProfile, parseTregTiktokVideos, parseTregXPosts, parseYoutubeRss, youtubeChannelIdFromHandle,
  youtubeChannelIdFromPage, youtubeRssUrl,
} from '../src/lib/partnership/treg-social';
import { TREG_IG_POSTS_ENDPOINT } from '../src/lib/partnership/treg-instagram';
import { buildSourceCatalog } from '../src/lib/partnership/intel';
import type { TregConfig } from '../src/lib/seo/treg-client';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const config: TregConfig = { apiKey: 'test-key', baseUrl: 'https://treg.example' } as TregConfig;
const mifx = { instagram: 'mifx.indonesia', tiktok: 'mifx.indonesia', youtube: 'user/MifxChannel', linkedin: 'company/pt-mifx' };

test('treg estimate: sum of the selected platforms the competitor has; Meta ads need no handle', () => {
  assert.deepEqual(parseTregPlatforms(['tiktok', 'bogus', 'instagram', 'tiktok']), ['instagram', 'tiktok']);
  const all = estimateCompetitorTreg(mifx, ['instagram', 'tiktok', 'facebook', 'meta_ads', 'x']);
  assert.deepEqual(all.platforms.map(item => item.platform), ['instagram', 'tiktok', 'meta_ads']);
  assert.equal(all.totalMicro, 900 + 640 + 500 + 1200);
  assert.equal(all.calls, 4);
  assert.equal(all.maxMicro, 4 * 5000);
  assert.deepEqual(estimateCompetitorTreg({}, ['instagram', 'x']), { calls: 0, totalMicro: 0, maxMicro: 0, platforms: [] });
  assert.equal(estimateCompetitorTreg({}, ['meta_ads']).totalMicro, TREG_PLATFORM_SPECS.meta_ads.priceMicro);
});

test('treg parsers: real response shapes (TikTok, Facebook, X) become dated posts with links', () => {
  assert.match(parseTregTiktokProfile(fixture('partnership-treg-tiktok-profile.json')) || '', /^MS4w/);
  const videos = parseTregTiktokVideos(fixture('partnership-treg-tiktok-videos.json'), 'mifx.indonesia');
  assert.ok(videos.length > 0);
  assert.ok(videos.every(post => post.platform === 'tiktok' && post.url.startsWith('https://www.tiktok.com/') && /^\d{4}-\d{2}-\d{2}$/.test(post.date || '')));
  const fb = parseTregFacebookPosts(fixture('partnership-treg-facebook-posts.json'));
  assert.ok(fb.length > 0 && fb.every(post => post.platform === 'facebook' && post.url.includes('facebook.com')));
  const x = parseTregXPosts(fixture('partnership-treg-x-posts.json'), 'xtb_id');
  assert.ok(x.length > 0 && x.every(post => post.platform === 'x' && post.url.startsWith('https://')));
});

test('Meta Ad Library: MIFX ads run from page "Monex Investindo Futures" are kept via its domain/handle; others dropped', () => {
  const ads = parseTregMetaAds(fixture('partnership-treg-meta-ads.json'), { name: 'MIFX', website: 'https://mifx.com/', handles: mifx });
  assert.ok(ads.length > 0 && ads.length <= 8);
  assert.ok(ads.every(ad => ad.account === 'Monex Investindo Futures' && ad.url.startsWith('https://www.facebook.com/ads/library/?id=')));
  assert.ok(ads.some(ad => ad.landingUrl?.includes('mifx.com')));
  assert.equal(new Set(ads.map(ad => ad.text)).size, ads.length);
  const other = parseTregMetaAds(fixture('partnership-treg-meta-ads.json'), { name: 'Valbury', website: 'https://valbury.co.id/', handles: { instagram: 'valbury_futures' } });
  assert.deepEqual(other, []);
});

test('YouTube (free): channel id from a handle or page, RSS url, and RSS videos', () => {
  assert.equal(youtubeChannelIdFromHandle('channel/UC-l61LxjsphAAjnoQwGTV6Q'), 'UC-l61LxjsphAAjnoQwGTV6Q');
  assert.equal(youtubeChannelIdFromHandle('@MIFX'), null);
  assert.equal(youtubeChannelIdFromPage('<link rel="canonical" href="https://www.youtube.com/channel/UC-l61LxjsphAAjnoQwGTV6Q">'), 'UC-l61LxjsphAAjnoQwGTV6Q');
  assert.equal(youtubeRssUrl('UCabc'), 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc');
  const videos = parseYoutubeRss(fixture('partnership-youtube-rss-mifx.xml'));
  assert.equal(videos.length, 3);
  assert.ok(videos.every(video => video.platform === 'youtube' && video.url.startsWith('https://www.youtube.com/watch?v=') && video.date));
});

function tregStub(responses: Record<string, { status?: number; body: unknown; cost?: number }>) {
  const calls: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const endpoint = decodeURIComponent(String(url).split('/call/')[1] || '');
    const body = JSON.parse(String(init?.body || '{}'));
    calls.push({ endpoint, body: body.input ?? body });
    const answer = responses[endpoint] ?? { status: 500, body: { error: 'unexpected' } };
    return new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), {
      status: answer.status ?? 200, headers: { 'content-type': 'application/json', ...(answer.cost !== undefined ? { 'X-Treg-Cost-Micro': String(answer.cost) } : {}) },
    });
  };
  return { calls, fetchImpl };
}

test('treg feeds: one call at a time per platform, actual cost per platform, posts and ads collected', async () => {
  const { calls, fetchImpl } = tregStub({
    [TREG_IG_POSTS_ENDPOINT]: { body: fixture('partnership-treg-ig-mifx.json'), cost: 900 },
    [TREG_ENDPOINTS.tiktokProfile]: { body: fixture('partnership-treg-tiktok-profile.json'), cost: 640 },
    [TREG_ENDPOINTS.tiktokVideos]: { body: fixture('partnership-treg-tiktok-videos.json'), cost: 500 },
    [TREG_ENDPOINTS.metaAds]: { body: fixture('partnership-treg-meta-ads.json'), cost: 1100 },
  });
  const outcome = await fetchTregSocialFeeds(config, { reportId: 'r1', name: 'MIFX', website: 'https://mifx.com/', handles: mifx, platforms: ['instagram', 'tiktok', 'facebook', 'meta_ads', 'x'] }, fetchImpl);
  assert.deepEqual(calls.map(call => call.endpoint), [TREG_IG_POSTS_ENDPOINT, TREG_ENDPOINTS.tiktokProfile, TREG_ENDPOINTS.tiktokVideos, TREG_ENDPOINTS.metaAds]);
  assert.equal(calls[3].body.company_name, 'MIFX');
  assert.equal(calls[3].body.company_domain, 'mifx.com');
  assert.equal(outcome.costMicro, 900 + 640 + 500 + 1100);
  assert.deepEqual(outcome.perPlatform, { instagram: 900, tiktok: 1140, meta_ads: 1100 });
  assert.equal(outcome.costSource, 'reported');
  assert.ok(outcome.ok && outcome.instagram.length > 0);
  assert.ok(outcome.posts.some(post => post.platform === 'tiktok') && outcome.posts.some(post => post.platform === 'meta_ads'));
});

test('treg feeds: a balance refusal stops the remaining platforms and never throws', async () => {
  const { calls, fetchImpl } = tregStub({
    [TREG_IG_POSTS_ENDPOINT]: { status: 402, body: { error: 'insufficient_balance', balance_micro: 300 } },
  });
  const outcome = await fetchTregSocialFeeds(config, { reportId: 'r2', name: 'MIFX', website: 'https://mifx.com/', handles: mifx, platforms: ['instagram', 'tiktok', 'meta_ads'] }, fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.costMicro, 0);
  assert.equal(outcome.refusalBalanceMicro, 300);
  assert.ok(outcome.notes.some(note => /free sources used/.test(note)));
  assert.ok(outcome.notes.filter(note => /skipped: treg stopped/.test(note)).length === 2);
});

test('treg feeds: a timeout counts the catalog price as an estimate', async () => {
  const outcome = await fetchTregSocialFeeds(config, { reportId: 'r3', name: 'XTB', website: null, handles: { x: 'xtb_id' }, platforms: ['x'] }, async () => { throw new TypeError('fetch failed'); });
  assert.equal(outcome.costMicro, 500);
  assert.equal(outcome.costSource, 'estimate');
});

test('source catalog: social posts and Meta ads become citable sources inside the window', () => {
  const window = { start: '2026-08-17', end: '2026-11-17', months: 3 };
  const sources = buildSourceCatalog({
    pages: [], news: [], web: [], evidence: [],
    social: [
      { platform: 'meta_ads', url: 'https://www.facebook.com/ads/library/?id=1', account: 'Monex Investindo Futures', date: '2026-06-01', text: 'MIFX Priority', hashtags: [], kind: 'VIDEO', period: '2026-06-01 to now (active)', placements: ['INSTAGRAM'], landingUrl: 'https://get.mifx.com/mifx-priority' },
      { platform: 'tiktok', url: 'https://www.tiktok.com/@mifx.indonesia/video/1', account: 'mifx.indonesia', date: '2026-10-01', text: 'Promo #MIFXPriority', hashtags: ['#MIFXPriority'], kind: 'video' },
      { platform: 'x', url: 'https://x.com/a/status/1', account: 'a', date: '2025-01-01', text: 'old', hashtags: [], kind: 'post' },
    ],
  }, window);
  assert.deepEqual(sources.map(source => source.kind), ['ads', 'social']);
  assert.ok(sources[0].title.includes('Meta ad'));
  assert.ok(sources.every(source => source.url));
});
