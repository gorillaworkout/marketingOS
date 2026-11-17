import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchTregInstagramFeed, instagramFeedEnabled, estimateInstagramFeedMicro, TREG_IG_POSTS_ENDPOINT } from '../src/lib/partnership/treg-instagram';
import { fetchPublic } from '../src/lib/partnership/public-fetch';
import type { TregConfig } from '../src/lib/seo/treg-client';

const config: TregConfig = { apiKey: 'test-key', baseUrl: 'https://treg.example' } as TregConfig;
const fixture = readFileSync(new URL('./fixtures/partnership-treg-ig-mifx.json', import.meta.url), 'utf8');

test('treg Instagram feed: success parses posts and reads the reported cost', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const outcome = await fetchTregInstagramFeed(config, { handle: 'mifx.indonesia', reportId: 'r1' }, async (url, init) => {
    seen = { url, init };
    return new Response(fixture, { status: 200, headers: { 'content-type': 'application/json', 'X-Treg-Cost-Micro': '900' } });
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.ok(outcome.posts.length > 0);
  assert.equal(outcome.costMicro, 900);
  assert.ok(seen && (seen as { url: string }).url.includes(TREG_IG_POSTS_ENDPOINT));
  const body = JSON.parse(String((seen as unknown as { init: RequestInit }).init.body));
  assert.equal(body.username ?? body.input?.username, 'mifx.indonesia');
});

for (const status of [401, 402, 429, 503]) {
  test(`treg Instagram feed: HTTP ${status} falls back without throwing`, async () => {
    const outcome = await fetchTregInstagramFeed(config, { handle: 'x', reportId: 'r2' }, async () => new Response('{"error":"nope"}', { status, headers: { 'content-type': 'application/json' } }));
    assert.equal(outcome.ok, false);
  });
}

test('treg Instagram feed: missing key is a clean fallback with no cost', async () => {
  let called = false;
  const outcome = await fetchTregInstagramFeed({ ...config, apiKey: null }, { handle: 'x', reportId: 'r3' }, async () => { called = true; return new Response('{}'); });
  assert.equal(outcome.ok, false);
  assert.equal(called, false);
  assert.equal(outcome.costMicro, 0);
});

test('treg Instagram feed: network failure counts the estimate', async () => {
  const outcome = await fetchTregInstagramFeed(config, { handle: 'x', reportId: 'r4' }, async () => { throw new TypeError('fetch failed'); });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.costSource, 'estimate');
});

test('treg Instagram feed: env switch and estimate', () => {
  assert.equal(instagramFeedEnabled({ PARTNERSHIP_TREG_INSTAGRAM: 'false' } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(instagramFeedEnabled({} as unknown as NodeJS.ProcessEnv), true);
  assert.deepEqual(estimateInstagramFeedMicro(2), { calls: 2, totalMicro: 1800, maxMicro: 10000 });
});

test('fetchPublic refuses private hosts and private redirect targets', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response('', { status: 302, headers: { location: 'http://internal.local/' } }); }) as unknown as typeof fetch;
  const lookup = async (host: string) => host === 'internal.local' ? ['10.0.0.5'] : ['93.184.216.34'];
  assert.equal(await fetchPublic('http://internal.local/', undefined, { lookup, fetchImpl }), null);
  assert.equal(calls, 0);
  assert.equal(await fetchPublic('https://public.example/', undefined, { lookup, fetchImpl }), null);
  assert.equal(calls, 1);
  assert.equal(await fetchPublic('file:///etc/passwd', undefined, { lookup, fetchImpl }), null);
});

test('refresh route and page wire the optional treg confirmation', () => {
  const route = readFileSync(new URL('../src/app/api/partnership/competitors/[id]/refresh/route.ts', import.meta.url), 'utf8');
  assert.match(route, /confirmedEstimateMicro/);
  assert.match(route, /guardTregSpend/);
  const page = readFileSync(new URL('../src/app/dashboard/partnership/competitor-intelligence/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /useTregStatus\('\/api\/partnership\/treg'\)/);
  assert.match(page, /Brand campaigns/);
  assert.match(page, /Regular social content/);
  assert.doesNotMatch(page, /never scraped/);
});

test('competitor list route passes campaigns to the comparison', () => {
  const route = readFileSync(new URL('../src/app/api/partnership/competitors/route.ts', import.meta.url), 'utf8');
  assert.match(route, /campaigns: report\.result\.campaigns/);
});
