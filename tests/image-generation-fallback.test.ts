import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ANTIGRAVITY_IMAGE_FALLBACK_MODEL,
  antigravityCapacityFallbackMessage,
  antigravityImageFallbackFor,
  generateWithAntigravityCapacityFallback,
  isCapacityOrRateLimitFailure,
  shouldFallbackAntigravityImage,
} from '../src/lib/image-generation-fallback';
import { explainImageFailure } from '../src/app/api/generate-image/route';
import { DEFAULT_IMAGE_MODEL } from '../src/lib/image-models';

const CAPACITY_502 = 'Image API error 502: {"error":{"message":"You have exhausted your capacity on this mode"}}';
const CAPACITY_429 = 'Image API error 429: You have exhausted your capacity on this mode';
const QUOTA_502 = 'Image API error 502: rate limit / quota exceeded';
const PLAIN_502 = 'Image API error 502: Bad Gateway';
const AUTH_401 = 'Image API error 401: token is expired';

// Stand-in for a future verified non-ag/ image model, passed explicitly so the
// retry mechanism stays covered while the configured fallback is null.
const FAKE_FALLBACK = 'cx/test-fallback-image';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('capacity detection matches explainImageFailure, including wrapped 502s', () => {
  assert.equal(isCapacityOrRateLimitFailure(CAPACITY_502), true);
  assert.equal(isCapacityOrRateLimitFailure(CAPACITY_429), true);
  assert.equal(isCapacityOrRateLimitFailure(QUOTA_502), true);
  assert.equal(isCapacityOrRateLimitFailure('Image API error 429: usage limit (reset after 8m 56s)'), true);
  assert.equal(isCapacityOrRateLimitFailure(PLAIN_502), false);
  assert.equal(isCapacityOrRateLimitFailure(AUTH_401), false);
  assert.equal(isCapacityOrRateLimitFailure('timeout after 240s'), false);
  assert.equal(isCapacityOrRateLimitFailure('Image API error 404: model not found'), false);

  assert.match(explainImageFailure(CAPACITY_502, 'ag/nano-banana-pro'), /quota\/rate limit is full/);
  assert.doesNotMatch(explainImageFailure(PLAIN_502, 'ag/nano-banana-pro'), /quota\/rate limit is full/);
});

test('no image fallback is configured: cx/gpt-5.5-image is broken and Gemini is the only working model', () => {
  assert.equal(ANTIGRAVITY_IMAGE_FALLBACK_MODEL, null);
  assert.notEqual(ANTIGRAVITY_IMAGE_FALLBACK_MODEL, 'cx/gpt-5.5-image');
  assert.equal(antigravityImageFallbackFor(DEFAULT_IMAGE_MODEL), null, 'never falls back to the same model');
  assert.equal(antigravityImageFallbackFor('ag/gemini-3.1-flash-image'), null);
  for (const reason of [CAPACITY_502, CAPACITY_429, QUOTA_502, PLAIN_502, AUTH_401]) {
    assert.equal(shouldFallbackAntigravityImage('ag/gemini-3.1-flash-image', reason), false);
    assert.equal(shouldFallbackAntigravityImage('cx/gpt-5.5-image', reason), false);
  }
  const source = read('src/lib/image-generation-fallback.ts');
  assert.doesNotMatch(source, /=\s*DEFAULT_IMAGE_MODEL/, 'fallback must not alias the default model');
});

test('capacity on the default ag/ model fails once with the clear quota error (no retry)', async () => {
  const attempted: string[] = [];
  await assert.rejects(
    () => generateWithAntigravityCapacityFallback(DEFAULT_IMAGE_MODEL, async (model) => {
      attempted.push(model);
      throw new Error(CAPACITY_502);
    }),
    (error: unknown) => error instanceof Error && error.message === CAPACITY_502,
  );
  assert.deepEqual(attempted, [DEFAULT_IMAGE_MODEL]);

  const explained = explainImageFailure(CAPACITY_502, DEFAULT_IMAGE_MODEL);
  assert.match(explained, /quota\/rate limit is full/);
  assert.match(explained, /Gemini 3\.1 Flash Image/);
  assert.match(explained, /No other image model is available/);
  assert.doesNotMatch(explained, /gpt-5\.5|GPT-5\.5/);
});

test('first-attempt success does not retry or attach fallback metadata', async () => {
  const attempted: string[] = [];
  const result = await generateWithAntigravityCapacityFallback('ag/gemini-3.1-flash-image', async (model) => {
    attempted.push(model);
    return { ok: true };
  });
  assert.deepEqual(attempted, ['ag/gemini-3.1-flash-image']);
  assert.equal(result.usedModel, 'ag/gemini-3.1-flash-image');
  assert.equal(result.fallbackFrom, undefined);
  assert.equal(result.fallbackMessage, undefined);
});

test('with an explicit fallback, capacity on ag/… triggers exactly one retry', async () => {
  const attempted: string[] = [];
  const retries: Array<[string, string]> = [];
  const result = await generateWithAntigravityCapacityFallback(
    'ag/gemini-3.1-flash-image',
    async (model) => {
      attempted.push(model);
      if (model.startsWith('ag/')) throw new Error(CAPACITY_429);
      return { ok: true, model };
    },
    { fallbackModel: FAKE_FALLBACK, onRetry: (to, from) => { retries.push([to, from]); } },
  );
  assert.deepEqual(attempted, ['ag/gemini-3.1-flash-image', FAKE_FALLBACK]);
  assert.deepEqual(retries, [[FAKE_FALLBACK, 'ag/gemini-3.1-flash-image']]);
  assert.equal(result.usedModel, FAKE_FALLBACK);
  assert.equal(result.fallbackFrom, 'ag/gemini-3.1-flash-image');
  assert.equal(result.fallbackMessage, antigravityCapacityFallbackMessage('ag/gemini-3.1-flash-image', FAKE_FALLBACK));
  assert.match(result.fallbackMessage!, /Antigravity quota full — used .+ instead/);
});

test('a fallback equal to the requested model never retries', async () => {
  const attempted: string[] = [];
  await assert.rejects(
    () => generateWithAntigravityCapacityFallback('ag/gemini-3.1-flash-image', async (model) => {
      attempted.push(model);
      throw new Error(CAPACITY_502);
    }, { fallbackModel: 'ag/gemini-3.1-flash-image' }),
  );
  assert.deepEqual(attempted, ['ag/gemini-3.1-flash-image']);
});

test('non-capacity 502 on ag/… does not retry even with a fallback', async () => {
  const attempted: string[] = [];
  await assert.rejects(
    () => generateWithAntigravityCapacityFallback('ag/gemini-3.1-flash-image', async (model) => {
      attempted.push(model);
      throw new Error(PLAIN_502);
    }, { fallbackModel: FAKE_FALLBACK }),
    (error: unknown) => error instanceof Error && error.message === PLAIN_502,
  );
  assert.deepEqual(attempted, ['ag/gemini-3.1-flash-image']);
});

test('failed retry prefers the original Antigravity quota error', async () => {
  await assert.rejects(
    () => generateWithAntigravityCapacityFallback('ag/gemini-3.1-flash-image', async (model) => {
      if (model.startsWith('ag/')) throw new Error(CAPACITY_502);
      throw new Error('Image API error 401: token is expired');
    }, { fallbackModel: FAKE_FALLBACK }),
    (error: unknown) => error instanceof Error && error.message === CAPACITY_502,
  );
});

test('logging contract uses the actual model that produced the image', async () => {
  const result = await generateWithAntigravityCapacityFallback('ag/gemini-3.1-flash-image', async (model) => {
    if (model.startsWith('ag/')) throw new Error(QUOTA_502);
    return { usage: { input_tokens: 10, output_tokens: 20 } };
  }, { fallbackModel: FAKE_FALLBACK });
  assert.equal(result.usedModel, FAKE_FALLBACK);

  const route = read('src/app/api/generate-image/route.ts');
  assert.match(route, /generateWithAntigravityCapacityFallback/);
  assert.match(route, /logImageGenerationUsage\(job\.ownerId, taskId, usedModel, payload\)/);
  assert.match(route, /taskType: 'image-gen'/);
  assert.doesNotMatch(route, /logImageGenerationUsage\(job\.ownerId, taskId, safeModel/);
  assert.match(route, /explainImageFailure\(reason, safeModel\)/, 'errors name the model that was actually sent');
});

test('Social Post surfaces usedModel and fallback toast copy', () => {
  const page = read('src/app/dashboard/social-post/page.tsx');
  assert.match(page, /fallbackMessage/);
  assert.match(page, /usedModel/);
  assert.match(page, /setImageNotice\(status\.result\.fallbackMessage\)/);
  assert.match(page, /role="status"/);
  assert.match(page, /status\.result\.usedModel \|\| imageModel/);
});
