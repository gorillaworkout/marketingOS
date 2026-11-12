import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGatewayCompletion } from '../src/lib/gateway-response';
import { aiProviderStatus } from '../src/lib/ai-http-status';
import {
  FREE_TEXT_CHAIN,
  modelsInUse,
  openRouterChainForTier,
  resolveDupoinModel,
  TEXT_SHORTLIST,
  tierForFeature,
} from '../src/lib/model-tiers';

test('features resolve to the right tier and Dupoin shortlist', () => {
  assert.equal(tierForFeature('seo-content'), 'smart');
  assert.equal(tierForFeature('social-post'), 'fast');
  assert.equal(tierForFeature('video-script'), 'fast');
  assert.equal(tierForFeature('ai-research'), 'research');
  assert.equal(tierForFeature('image'), 'image');
  assert.deepEqual(resolveDupoinModel({
    preference: 'cx/gpt-5.6-sol',
    orgDefault: 'cc/claude-sonnet-5-5',
    primary: 'cc/claude-sonnet-5-5',
    shortlist: TEXT_SHORTLIST,
  }), 'cx/gpt-5.6-sol');
  assert.equal(resolveDupoinModel({
    preference: 'cx/gpt-6-sol',
    orgDefault: 'cx/gpt-5.6-sol',
    primary: 'cc/claude-sonnet-5-5',
    shortlist: TEXT_SHORTLIST,
  }), 'cx/gpt-5.6-sol');
  assert.equal(resolveDupoinModel({
    preference: null,
    orgDefault: 'not-a-model',
    primary: 'ag/gemini-3-flash',
    shortlist: TEXT_SHORTLIST,
  }), 'ag/gemini-3-flash');
});

test('paid toggle puts the tier target in front of the free chain and image stays a credit model', () => {
  assert.deepEqual(openRouterChainForTier({ tier: 'smart', usePaid: false, freeChain: FREE_TEXT_CHAIN }), [...FREE_TEXT_CHAIN]);
  assert.deepEqual(openRouterChainForTier({ tier: 'fast', usePaid: true, freeChain: FREE_TEXT_CHAIN }), [
    'anthropic/claude-haiku-5.5',
    ...FREE_TEXT_CHAIN,
  ]);
  assert.deepEqual(openRouterChainForTier({ tier: 'image', usePaid: true, freeChain: FREE_TEXT_CHAIN }), ['google/gemini-3.1-flash-image']);
  assert.equal((FREE_TEXT_CHAIN as readonly string[]).includes('google/gemma-4-31b-it:free'), false);
  assert.equal(FREE_TEXT_CHAIN[0], 'thinkingmachines/inkling-2-small:free');
});

test('health covers the unique models in use and skips images unless asked', () => {
  const rows = modelsInUse({
    primaries: ['cc/claude-sonnet-5-5', 'ag/gemini-3-flash', 'cx/gpt-5.6-sol', 'ag/gemini-3.1-flash-image'],
    freeChain: FREE_TEXT_CHAIN,
    paidTargets: ['anthropic/claude-sonnet-5.5', 'google/gemini-3.1-flash-image'],
    usePaid: false,
    embeddingModel: 'liquid/lfm-2.5-embedding-350m:free',
    imageModel: 'ag/gemini-3.1-flash-image',
    includeImages: false,
  });
  assert.equal(rows.some(row => row.kind === 'image'), false);
  assert.equal(new Set(rows.map(row => `${row.provider}:${row.model}`)).size, rows.length);
  assert.ok(rows.length <= 8);
});

test('Inkling reasoning is not parsed as the answer, and a reasoning-only body is empty', () => {
  const withAnswer = JSON.stringify({
    choices: [{ message: { reasoning: 'think first', content: '<think>think first</think>{"title":"ok"}' } }],
  });
  assert.equal(parseGatewayCompletion(withAnswer, 'application/json'), '{"title":"ok"}');
  const reasoningOnly = JSON.stringify({
    choices: [{ message: { reasoning: 'only thoughts', content: '' } }],
  });
  assert.throws(() => parseGatewayCompletion(reasoningOnly, 'application/json'), /did not contain completion content/);
});

test('AI provider failures stay off HTTP 502 so Cloudflare cannot hide the message', () => {
  assert.equal(aiProviderStatus(new Error('OpenRouter free-model rate limit (HTTP 429)')), 429);
  assert.equal(aiProviderStatus(new Error('image generation needs OpenRouter credits')), 402);
  assert.equal(aiProviderStatus(new Error('fetch failed: ECONNREFUSED')), 503);
  assert.equal(aiProviderStatus(new Error('The model returned an empty draft')), 424);
  const route = readFileSync('src/app/api/seo/content/route.ts', 'utf8');
  assert.match(route, /aiProviderStatus\(error\)/);
  assert.doesNotMatch(route, /AI draft failed[\s\S]{0,200}status: 502/);
});

test('migration 051 snapshots the old tables and the down script restores them', () => {
  const up = readFileSync('db/migrations/051_model_tiers.sql', 'utf8');
  const down = readFileSync('db/rollbacks/051_model_tiers_down.sql', 'utf8');
  for (const table of ['feature_model_assignments', 'task_model_preferences', 'llm_model_mappings', 'image_model_assignments']) {
    assert.match(up, new RegExp(`${table}_legacy`));
    assert.match(down, new RegExp(`INSERT INTO ${table} SELECT \\* FROM ${table}_legacy`));
  }
  assert.match(up, /cx\/gpt-5\.6-sol/);
  assert.match(up, /thinkingmachines\/inkling-2-small:free/);
  assert.doesNotMatch(up, /google\/gemma-4-26b-a4b-it:free/);
  assert.match(down, /DROP TABLE IF EXISTS llm_tier_config/);
});
