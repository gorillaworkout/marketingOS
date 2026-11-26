import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  generateWithAntigravityCapacityFallback,
  isAccessOrAuthFailure,
  isAntigravityRetryableFailure,
  isUpstreamAccountDisabledFailure,
} from '../src/lib/image-generation-fallback';
import { explainImageFailure } from '../src/app/api/generate-image/route';
import { DEFAULT_IMAGE_MODEL, isAllowedImageModel, isPaidImageModel } from '../src/lib/image-models';
import { IMAGE_SHORTLIST, TIER_PRIMARY } from '../src/lib/model-tiers';

const NANO = 'ag/gemini-3.1-flash-image';
const GPT2 = 'cx/gpt-image-2';
// Shape of the production failure on 2026-11-26 (no secrets).
const TOS_403 = 'Image API error 403: {"error":{"message":"[antigravity/gemini-3.1-flash-image] [403]: {\\n  \\"error\\": {\\n    \\"code\\": 403,\\n    \\"message\\": \\"This service has been disabled in this account for violation of Terms of Service. Please submit an appeal to continue using this product.\\",\\n    \\"status\\": \\"PERMISSION_DENIED\\",\\n    \\"details\\": [{\\"reason\\": \\"TOS_VIOLATION\\"}]';
const PLAIN_403 = 'Image API error 403: {"error":{"message":"forbidden"}}';
const AUTH_401 = 'Image API error 401: token is expired';

test('classifies the Antigravity ToS 403 and other access failures', () => {
  assert.equal(isUpstreamAccountDisabledFailure(TOS_403), true);
  assert.equal(isUpstreamAccountDisabledFailure(PLAIN_403), false);
  for (const reason of [TOS_403, PLAIN_403, AUTH_401, 'Model Nano Banana 2 token expired. Please re-authenticate it in AI Models.']) {
    assert.equal(isAccessOrAuthFailure(reason), true, reason);
    assert.equal(isAntigravityRetryableFailure(reason), true, reason);
  }
  for (const reason of ['Image API error 404: model not found', 'Image API error 502: Bad Gateway', 'timeout after 240s', 'Image API error 402: billing']) {
    assert.equal(isAccessOrAuthFailure(reason), false, reason);
  }
});

test('a 403 on an ag/ image model retries exactly once on GPT Image 2 and reports the model used', async () => {
  const attempts: string[] = [];
  const retries: Array<[string, string, string]> = [];
  const result = await generateWithAntigravityCapacityFallback(NANO, async (model) => {
    attempts.push(model);
    if (model === NANO) throw new Error(TOS_403);
    return { data: [{ b64_json: 'x' }] };
  }, { fallbackModel: GPT2, onRetry: (to, from, reason) => { retries.push([to, from, reason]); } });
  assert.deepEqual(attempts, [NANO, GPT2]);
  assert.equal(result.usedModel, GPT2);
  assert.equal(result.fallbackFrom, NANO);
  assert.match(result.fallbackMessage ?? '', /disabled by Google/);
  assert.match(result.fallbackMessage ?? '', /used GPT Image 2/);
  assert.doesNotMatch(result.fallbackMessage ?? '', /quota/i);
  assert.equal(retries.length, 1);
  assert.equal(retries[0][2], TOS_403, 'onRetry receives the original reason');
});

test('401 also falls back once; a failing backup is not retried and the original error is kept', async () => {
  const attempts: string[] = [];
  await assert.rejects(
    () => generateWithAntigravityCapacityFallback(NANO, async (model) => {
      attempts.push(model);
      throw new Error(model === NANO ? AUTH_401 : PLAIN_403);
    }, { fallbackModel: GPT2 }),
    (error: unknown) => error instanceof Error && error.message === AUTH_401,
  );
  assert.deepEqual(attempts, [NANO, GPT2], 'two attempts total, no loop');
});

test('403 on a non-ag model never retries', async () => {
  const attempts: string[] = [];
  await assert.rejects(() => generateWithAntigravityCapacityFallback(GPT2, async (model) => {
    attempts.push(model);
    throw new Error(PLAIN_403);
  }, { fallbackModel: 'cx/gpt-image-2.5' }));
  assert.deepEqual(attempts, [GPT2]);
});

test('403 copy is honest: no "this account is not allowed"', () => {
  const tos = explainImageFailure(TOS_403, NANO);
  assert.match(tos, /Google \(Antigravity\) account behind Nano Banana 2 \(Gemini 3\.1 Flash Image\) was disabled by Google/);
  assert.match(tos, /Pick GPT Image 2 or another model/);
  assert.match(explainImageFailure(TOS_403, NANO, 'GPT Image 2 (ChatGPT)'), /Backup image model GPT Image 2 \(ChatGPT\) also failed\./);
  const generic = explainImageFailure(PLAIN_403, GPT2);
  assert.match(generic, /refused GPT Image 2 \(ChatGPT\) \(403 permission denied upstream\)/);
  assert.match(generic, /not a problem with your MarketingOS account/);
  for (const message of [tos, generic]) assert.doesNotMatch(message, /This account is not allowed/);
  assert.match(explainImageFailure(AUTH_401, NANO), /re-authenticate it in AI Models/);
});

test('default image model is GPT Image 2 and Nano Banana 2 stays selectable', () => {
  assert.equal(DEFAULT_IMAGE_MODEL, GPT2);
  assert.equal(isPaidImageModel(DEFAULT_IMAGE_MODEL), false);
  assert.equal(isAllowedImageModel(NANO), true);
  assert.deepEqual([...IMAGE_SHORTLIST], [GPT2, NANO]);
  assert.equal(TIER_PRIMARY.image, GPT2);
});

test('the route passes the failure reason to onRetry and keeps usedModel in the result', () => {
  const route = readFileSync('src/app/api/generate-image/route.ts', 'utf8');
  assert.match(route, /onRetry: \(fallbackModel, fromModel, reason\) =>/);
  assert.match(route, /is unavailable — retrying with/);
  assert.match(route, /usedModel,\n/);
});

test('migration 071 moves only the old default to GPT Image 2; rollback is guarded', () => {
  const sql = readFileSync('db/migrations/071_default_image_gpt_image_2.sql', 'utf8');
  const down = readFileSync('db/rollbacks/071_default_image_gpt_image_2_down.sql', 'utf8');
  for (const text of [sql, down]) {
    assert.ok(!text.includes('?'), 'the migration runner does not allow ? in SQL');
    assert.match(text, /^\s*(--[^\n]*\n\s*)*BEGIN;/);
    assert.match(text, /COMMIT;\s*$/);
    assert.doesNotMatch(text, /DROP |TRUNCATE|DELETE FROM image_model_assignments|DELETE FROM llm_tier_config/i);
  }
  assert.match(sql, /SET default_model = 'cx\/gpt-image-2'[\s\S]*AND default_model = 'ag\/gemini-3\.1-flash-image'[\s\S]*LIKE '%"cx\/gpt-image-2"%'/);
  assert.match(sql, /SET dupoin_primary = 'cx\/gpt-image-2'[\s\S]*WHERE tier = 'image'\s*AND dupoin_primary = 'ag\/gemini-3\.1-flash-image'/);
  assert.match(down, /AND default_model = 'cx\/gpt-image-2'/);
  assert.match(down, /AND dupoin_primary = 'cx\/gpt-image-2'/);
  assert.match(down, /DELETE FROM schema_migrations WHERE name = '071_default_image_gpt_image_2.sql'/);
});
