import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGapKeywords } from '../src/lib/seo/keyword-gap-bucket';
import { parseDataForSeoRanked } from '../src/lib/seo/keyword-gap-providers';
import { collectTregKeywords } from '../src/lib/seo/keyword-gap-treg';
import {
  cachedTregBalance, classifyTregFailure, fetchTregBalance, forgetTregBalance, TregError, tregCall, tregConfig, tregFallbackNotice, tregMetaHeader,
  type FetchLike, type TregConfig,
} from '../src/lib/seo/treg-client';
import { estimateKeywordGapMicro, TREG_RANKED_KEYWORDS_ENDPOINT, tregBalancePath, tregCallPath, tregRankedKeywordsBody } from '../src/lib/seo/treg-endpoints';
import { canRunTreg, parseKeywordLimit, planTregRun, tregStatus } from '../src/lib/seo/treg-plan';
import { DailyLimitError } from '../src/lib/seo/treg-spend';
import { guardTregSpend, settleTregRun } from '../src/lib/seo/treg-cost-guard';

const FIXTURE = JSON.parse(readFileSync('tests/fixtures/treg-ranked-keywords.json', 'utf8')) as unknown;
const TOKEN = 'treg_test_token_do_not_leak';
const CONFIG: TregConfig = { apiKey: TOKEN, baseUrl: 'https://treg.to', dailyLimitMicro: 5_000_000, lowBalanceMicro: 2_000_000, adminOnly: true, org: null };

type Seen = { url: string; init: RequestInit };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function recorder(responses: Array<Response | Error>): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  let index = 0;
  return {
    seen,
    fetch: async (url, init) => {
      seen.push({ url, init });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next.clone();
    },
  };
}

function header(init: RequestInit, name: string): string | undefined {
  const headers = init.headers as Record<string, string>;
  const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

test('endpoint module: call path, balance path and an Indonesia ranked-keywords body', () => {
  assert.equal(tregCallPath(TREG_RANKED_KEYWORDS_ENDPOINT), '/call/dataforseo.google.domain.ranked_keywords');
  assert.equal(tregBalancePath(42), '/orgs/42/balance');
  const [task] = tregRankedKeywordsBody('competitor.co.id', 'Indonesia', 'id', 200);
  assert.equal(task.target, 'competitor.co.id');
  assert.equal((task as { location_code?: number }).location_code, 2360);
  assert.equal(task.language_code, 'id');
  assert.equal(task.limit, 200);
  const [other] = tregRankedKeywordsBody('x.com', 'Thailand', 'en', 100);
  assert.equal((other as { location_name?: string }).location_name, 'Thailand');
});

test('estimate: one call for our domain plus one per competitor at catalog price', () => {
  const estimate = estimateKeywordGapMicro(3, 200);
  assert.equal(estimate.calls, 4);
  assert.equal(estimate.perCallMicro, 12_000 + 120 * 200);
  assert.equal(estimate.totalMicro, 4 * 36_000);
  assert.equal(parseKeywordLimit('500'), 500);
  assert.equal(parseKeywordLimit('999999'), 200);
});

test('parser reads position, volume, KD, CPC and intent from the relayed DataForSEO body', () => {
  const parsed = parseDataForSeoRanked(FIXTURE, 'competitor.co.id');
  assert.equal(parsed.competitor.length, 2);
  assert.deepEqual(parsed.competitor[0], { keyword: 'trading emas online', domain: 'competitor.co.id', position: 3, volume: 9900, difficulty: 42, cpc: 1.25, intent: 'commercial' });
  assert.deepEqual(parsed.competitor[1], { keyword: 'cara trading forex', domain: 'competitor.co.id', position: 12, volume: 2400, difficulty: null, cpc: null, intent: 'informational' });
});

test('buckets carry competitor KD, CPC and intent in ranked mode and drop them in Free mode', () => {
  const competitorKeywords = parseDataForSeoRanked(FIXTURE, 'competitor.co.id').competitor;
  const ours = [{ query: 'cara trading forex', clicks: 0, impressions: 0, ctr: null, position: 25 }];
  const ranked = buildGapKeywords({ ours, competitorKeywords, ranked: true });
  const missing = ranked.find(row => row.keyword === 'trading emas online');
  assert.equal(missing?.bucket, 'missing');
  assert.equal(missing?.competitorPosition, 3);
  assert.equal(missing?.difficulty, 42);
  assert.equal(missing?.cpc, 1.25);
  assert.equal(missing?.intent, 'commercial');
  assert.equal(ranked.find(row => row.keyword === 'cara trading forex')?.bucket, 'weak');
  const free = buildGapKeywords({ ours, competitorKeywords, ranked: false });
  assert.equal(free.find(row => row.keyword === 'trading emas online')?.difficulty, null);
  assert.equal(free.find(row => row.keyword === 'trading emas online')?.volume, null);
});

test('tregCall: token only in X-Treg-Token, meta/idempotency/ceiling headers, cost and call id read back', async () => {
  const { fetch, seen } = recorder([json(200, FIXTURE, { 'X-Treg-Cost-Micro': '12240', 'X-Treg-Call-Id': 'call-1' })]);
  const result = await tregCall(CONFIG, {
    endpointId: TREG_RANKED_KEYWORDS_ENDPOINT, body: [{ target: 'a.com' }], meta: { feature: 'keyword-gap', user: 'u@example', run: 'gap-1' },
    idempotencyKey: 'gap-1:0', maxCostUsd: 0.108,
  }, fetch);
  assert.equal(result.costMicro, 12240);
  assert.equal(result.callId, 'call-1');
  assert.equal(seen[0].url, 'https://treg.to/call/dataforseo.google.domain.ranked_keywords');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(header(seen[0].init, 'X-Treg-Token'), TOKEN);
  assert.equal(header(seen[0].init, 'Authorization'), undefined, 'Authorization is relayed to the provider on REST; never put the token there');
  assert.equal(header(seen[0].init, 'Idempotency-Key'), 'gap-1:0');
  assert.equal(header(seen[0].init, 'X-Treg-Route-Max-Cost'), '0.1080');
  assert.equal(header(seen[0].init, 'X-Treg-Meta'), 'feature=keyword-gap, user=uexample, run=gap-1');
});

test('meta header drops characters treg rejects (no @, no spaces) and keeps at most 5 tags', () => {
  const value = tregMetaHeader({ a: 'x y', b: 'me@mail.com', c: '1', d: '2', e: '3', f: '4' });
  assert.equal(value, 'a=xy, b=memail.com, c=1, d=2, e=3');
});

test('failure classification branches on treg error codes', () => {
  assert.equal(classifyTregFailure(402, { error: 'insufficient_balance', balance_micro: 10 }), 'insufficient-balance');
  assert.equal(classifyTregFailure(402, { detail: { error: 'route_max_cost' } }), 'cost-ceiling');
  assert.equal(classifyTregFailure(403, { error: 'funds_required' }), 'insufficient-balance');
  assert.equal(classifyTregFailure(429, { error: 'member_spend_cap_reached' }), 'spend-cap');
  assert.equal(classifyTregFailure(429, { error: 'provider_rate_limited' }), 'rate-limited');
  assert.equal(classifyTregFailure(503, { error: 'provider_capacity_unavailable' }), 'unavailable');
  assert.equal(classifyTregFailure(401, { detail: 'not authenticated' }), 'unauthorized');
  assert.equal(classifyTregFailure(400, { error: 'bad target' }), 'provider-error');
});

test('fallback notice is English and names the reason', () => {
  assert.equal(tregFallbackNotice(new TregError('insufficient-balance')), 'treg unavailable: insufficient balance — showing Free mode');
  assert.equal(tregFallbackNotice(new TregError('not-configured')), 'treg unavailable: not configured — showing Free mode');
  assert.equal(tregFallbackNotice(new Error('boom')), 'treg unavailable: the data provider returned an error — showing Free mode');
});

test('402 insufficient_balance: TregError carries balance_micro, never the raw body or the token', async () => {
  const { fetch } = recorder([json(402, { detail: { error: 'insufficient_balance', balance_micro: 1500, estimated_cost_micro: 36000, topup_url: '/app#billing', message: `token ${TOKEN}` } })]);
  await assert.rejects(tregCall(CONFIG, { endpointId: TREG_RANKED_KEYWORDS_ENDPOINT, body: [] }, fetch), (error: unknown) => {
    assert.ok(error instanceof TregError);
    assert.equal(error.kind, 'insufficient-balance');
    assert.equal(error.balanceMicro, 1500);
    assert.equal(error.message.includes(TOKEN), false);
    assert.equal(error.message.includes('topup'), false);
    return true;
  });
});

test('collectTregKeywords: our domain then each competitor; cost is the sum of X-Treg-Cost-Micro', async () => {
  const { fetch, seen } = recorder([
    json(200, FIXTURE, { 'X-Treg-Cost-Micro': '12240', 'X-Treg-Call-Id': 'c0' }),
    json(200, FIXTURE, { 'X-Treg-Cost-Micro': '12240', 'X-Treg-Call-Id': 'c1' }),
  ]);
  const outcome = await collectTregKeywords({ gapId: 'gap-1', userId: 'user-1', ourDomain: 'https://dupoin.co.id/', competitors: ['https://www.competitor.co.id/'], market: 'Indonesia', language: 'id', keywordLimit: 100 }, CONFIG, fetch);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.actualMicro, 24480);
  assert.equal(outcome.costSource, 'reported');
  assert.equal(outcome.calls, 2);
  assert.deepEqual(outcome.callIds, ['c0', 'c1']);
  const bodies = seen.map(item => JSON.parse(String(item.init.body)) as Array<{ target: string; limit: number }>);
  assert.deepEqual(bodies.map(body => body[0].target), ['dupoin.co.id', 'competitor.co.id']);
  assert.equal(bodies[0][0].limit, 100);
  if (outcome.ok) {
    assert.equal(outcome.ours.length, 2);
    assert.equal(outcome.competitorKeywords[0].domain, 'competitor.co.id');
  }
});

test('collectTregKeywords: a 402 on the second call stops, keeps the first charge, and reports insufficient balance', async () => {
  const { fetch, seen } = recorder([
    json(200, FIXTURE, { 'X-Treg-Cost-Micro': '12240' }),
    json(402, { error: 'insufficient_balance', balance_micro: 100 }, { 'X-Treg-Error': '1' }),
  ]);
  const outcome = await collectTregKeywords({ gapId: 'g', userId: 'u', ourDomain: 'dupoin.co.id', competitors: ['a.com', 'b.com'], market: 'Indonesia', language: 'id', keywordLimit: 100 }, CONFIG, fetch);
  assert.equal(outcome.ok, false);
  assert.equal(seen.length, 2, 'no further calls after a refusal');
  assert.equal(outcome.actualMicro, 12240);
  if (!outcome.ok) assert.equal(tregFallbackNotice(outcome.error), 'treg unavailable: insufficient balance — showing Free mode');
});

test('collectTregKeywords: a timeout records the call estimate flagged as an estimate', async () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  const { fetch } = recorder([timeout]);
  const outcome = await collectTregKeywords({ gapId: 'g', userId: 'u', ourDomain: 'dupoin.co.id', competitors: ['a.com'], market: 'Indonesia', language: 'id', keywordLimit: 200 }, CONFIG, fetch);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.error.kind, 'timeout');
  assert.equal(outcome.costSource, 'estimate');
  assert.equal(outcome.actualMicro, 36_000);
});

test('collectTregKeywords without a key falls back immediately without any request', async () => {
  const { fetch, seen } = recorder([json(200, FIXTURE)]);
  const outcome = await collectTregKeywords({ gapId: 'g', userId: 'u', ourDomain: 'dupoin.co.id', competitors: ['a.com'], market: 'Indonesia', language: 'id', keywordLimit: 100 }, { ...CONFIG, apiKey: null }, fetch);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.error.kind, 'not-configured');
  assert.equal(seen.length, 0);
});

test('balance: /auth/me gives org_id, /orgs/{id}/balance gives balance_micro; cached 5 minutes', async () => {
  forgetTregBalance();
  const { fetch, seen } = recorder([json(200, { email: 'agent', org_id: 7, role: 'member' }), json(200, { org_id: 7, balance_micro: 4_250_000, balance_usd: 4.25 })]);
  const first = await cachedTregBalance(CONFIG, fetch, 1_000);
  assert.equal(first.balanceMicro, 4_250_000);
  assert.deepEqual(seen.map(item => item.url), ['https://treg.to/auth/me', 'https://treg.to/orgs/7/balance']);
  await cachedTregBalance(CONFIG, fetch, 1_000 + 4 * 60_000);
  assert.equal(seen.length, 2, 'served from cache');
  forgetTregBalance();
  const { fetch: denied } = recorder([json(401, { detail: 'not authenticated' })]);
  await assert.rejects(fetchTregBalance(CONFIG, denied), (error: unknown) => error instanceof TregError && error.kind === 'unauthorized');
});

test('config: defaults, https-only base URL, admin-only by default', () => {
  const config = tregConfig({ TREG_API_KEY: ' k ', TREG_BASE_URL: 'http://evil.example', TREG_DAILY_SPEND_LIMIT_USD: '1.5' } as unknown as NodeJS.ProcessEnv);
  assert.equal(config.apiKey, 'k');
  assert.equal(config.baseUrl, 'https://treg.to');
  assert.equal(config.dailyLimitMicro, 1_500_000);
  assert.equal(config.adminOnly, true);
  assert.equal(tregConfig({} as unknown as NodeJS.ProcessEnv).apiKey, null);
  assert.equal(tregConfig({ TREG_ADMIN_ONLY: 'false' } as unknown as NodeJS.ProcessEnv).adminOnly, false);
  assert.equal(canRunTreg(CONFIG, 'user'), false);
  assert.equal(canRunTreg(CONFIG, 'admin'), true);
});

const reserveOk = async () => 'spend-1';
const richBalance = async () => ({ balanceMicro: 10_000_000, fetchedAt: '2026-11-16T00:00:00Z' });
const base = { config: CONFIG, role: 'admin', userId: 'user-1', competitors: 2, keywordLimit: 100 };
const estimateMicro = estimateKeywordGapMicro(2, 100).totalMicro;

test('plan: no key → Free mode; non-admin refused; unconfirmed estimate refused', async () => {
  assert.deepEqual(await planTregRun({ ...base, config: { ...CONFIG, apiKey: null }, confirmedEstimateMicro: estimateMicro }, { balance: richBalance, reserve: reserveOk }), { kind: 'skip', reason: 'not-configured' });
  const member = await planTregRun({ ...base, role: 'user', confirmedEstimateMicro: estimateMicro }, { balance: richBalance, reserve: reserveOk });
  assert.equal(member.kind === 'refuse' && member.status, 403);
  const unconfirmed = await planTregRun({ ...base, confirmedEstimateMicro: null }, { balance: richBalance, reserve: reserveOk });
  assert.equal(unconfirmed.kind === 'refuse' && unconfirmed.status, 409);
  const stale = await planTregRun({ ...base, confirmedEstimateMicro: estimateMicro - 1 }, { balance: richBalance, reserve: reserveOk });
  assert.equal(stale.kind === 'refuse' && stale.status, 409);
});

test('plan: balance below the estimate → Free mode before any paid call', async () => {
  const plan = await planTregRun({ ...base, confirmedEstimateMicro: estimateMicro }, { balance: async () => ({ balanceMicro: 1000, fetchedAt: '' }), reserve: reserveOk });
  assert.deepEqual(plan, { kind: 'skip', reason: 'insufficient-balance' });
});

test('plan: daily limit is enforced server-side', async () => {
  const plan = await planTregRun({ ...base, confirmedEstimateMicro: estimateMicro }, {
    balance: richBalance,
    reserve: async input => { throw new DailyLimitError(4_990_000, input.limitMicro, input.estimateMicro); },
  });
  assert.equal(plan.kind, 'refuse');
  if (plan.kind === 'refuse') {
    assert.equal(plan.status, 429);
    assert.match(String(plan.body.error), /Daily treg spend limit reached: \$4\.99 of \$5\.00/);
  }
});

test('plan: a confirmed run reserves the estimate against the limit', async () => {
  let reserved: { estimateMicro: number; limitMicro: number; calls: number } | null = null;
  const plan = await planTregRun({ ...base, confirmedEstimateMicro: estimateMicro }, {
    balance: async () => { throw new TregError('timeout'); },
    reserve: async input => { reserved = input; return 'spend-9'; },
  });
  assert.deepEqual(plan, { kind: 'paid', spendId: 'spend-9', keywordLimit: 100, estimateMicro, balanceBeforeMicro: null });
  assert.deepEqual(reserved && { e: (reserved as { estimateMicro: number }).estimateMicro, l: (reserved as { limitMicro: number }).limitMicro, c: (reserved as { calls: number }).calls }, { e: estimateMicro, l: 5_000_000, c: 3 });
});

test('status: low-balance warning, no token in the payload', async () => {
  const status = await tregStatus(CONFIG, 'admin', { balance: async () => ({ balanceMicro: 1_200_000, fetchedAt: 'now' }), spentToday: async () => 250_000 });
  assert.equal(status.balanceUsd, 1.2);
  assert.equal(status.lowBalance, true);
  assert.equal(status.spentTodayUsd, 0.25);
  assert.equal(status.dailyLimitUsd, 5);
  assert.equal(status.canRun, true);
  assert.equal(JSON.stringify(status).includes(TOKEN), false);
  const member = await tregStatus(CONFIG, 'user', { balance: richBalance, spentToday: async () => 0 });
  assert.equal(member.canRun, false);
  const off = await tregStatus({ ...CONFIG, apiKey: null }, 'admin', { spentToday: async () => 0 });
  assert.equal(off.configured, false);
  assert.equal(off.balanceUsd, null);
});

test('shared cost guard: any feature passes its own one-generate estimate; balance before is kept', async () => {
  let feature = '';
  const plan = await guardTregSpend({ config: CONFIG, role: 'admin', userId: 'u', feature: 'keyword-enrichment', estimate: { calls: 1, totalMicro: 90_000 }, confirmedEstimateMicro: 90_000 }, {
    balance: richBalance,
    reserve: async input => { feature = input.feature; assert.equal(input.balanceBeforeMicro, 10_000_000); return 'spend-x'; },
  });
  assert.deepEqual(plan, { kind: 'paid', spendId: 'spend-x', estimateMicro: 90_000, balanceBeforeMicro: 10_000_000 });
  assert.equal(feature, 'keyword-enrichment');
});

test('settleTregRun: records the actual cost and reads the new remaining balance', async () => {
  const settled: Array<Record<string, unknown>> = [];
  const cost = await settleTregRun({ config: CONFIG, spendId: 'spend-1', estimateMicro: 36_000, balanceBeforeMicro: 5_000_000, ok: true, actualMicro: 24_480, costSource: 'reported', calls: 2, callIds: ['c0', 'c1'], note: null }, {
    balance: async () => ({ balanceMicro: 4_975_520, fetchedAt: 'now' }),
    settle: async (id, input) => { settled.push({ id, ...input }); },
  });
  assert.deepEqual(cost, { provider: 'treg', estimatedMicro: 36_000, actualMicro: 24_480, source: 'reported', calls: 2, balanceBeforeMicro: 5_000_000, balanceAfterMicro: 4_975_520 });
  assert.equal(settled[0].id, 'spend-1');
  assert.equal(settled[0].status, 'succeeded');
  assert.equal(settled[0].balanceAfterMicro, 4_975_520);
});

test('settleTregRun: a 402 refusal balance is used without another request; unreachable balance stays unknown', async () => {
  let asked = false;
  const refused = await settleTregRun({ config: CONFIG, spendId: null, estimateMicro: 36_000, balanceBeforeMicro: null, ok: false, actualMicro: 0, costSource: 'reported', calls: 1, callIds: [], note: 'x', refusalBalanceMicro: 1_500 }, {
    balance: async () => { asked = true; return { balanceMicro: 0, fetchedAt: '' }; },
  });
  assert.equal(refused.balanceAfterMicro, 1_500);
  assert.equal(asked, false);
  const unknown = await settleTregRun({ config: CONFIG, spendId: null, estimateMicro: 1, balanceBeforeMicro: null, ok: true, actualMicro: 1, costSource: 'reported', calls: 1, callIds: [], note: null }, {
    balance: async () => { throw new TregError('timeout'); },
  });
  assert.equal(unknown.balanceAfterMicro, null);
});

test('Keyword Gap uses the shared <TregCostNotice> before and after a generate', () => {
  const page = readFileSync('src/app/dashboard/seo/keyword-gap/page.tsx', 'utf8');
  const component = readFileSync('src/components/seo/TregCostNotice.tsx', 'utf8');
  assert.match(page, /<TregBalancePanel status=\{treg\} \/>/);
  assert.match(page, /<TregCostNotice[\s\S]*confirming=\{confirming\}/);
  assert.match(page, /result=\{gap\.cost\}/);
  assert.match(component, /Estimated cost for one generate/);
  assert.match(component, /Remaining balance/);
  assert.match(component, /reported by treg/);
  assert.equal(/TREG_API_KEY=\S/.test(component + page), false);
});
