import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ANTIGRAVITY_IMAGE_FALLBACK_MODEL,
  antigravityCapacityFallbackMessage,
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

test('only Antigravity image ids fallback on capacity', () => {
  assert.equal(shouldFallbackAntigravityImage('ag/nano-banana', CAPACITY_502), true);
  assert.equal(shouldFallbackAntigravityImage('ag/nano-banana-pro', CAPACITY_429), true);
  assert.equal(shouldFallbackAntigravityImage('ag/gemini-3.1-flash-image', QUOTA_502), true);
  assert.equal(shouldFallbackAntigravityImage('ag/nano-banana', PLAIN_502), false);
  assert.equal(shouldFallbackAntigravityImage('ag/nano-banana', AUTH_401), false);
  assert.equal(shouldFallbackAntigravityImage('cx/gpt-5.5-image', CAPACITY_429), false);
  assert.equal(ANTIGRAVITY_IMAGE_FALLBACK_MODEL, DEFAULT_IMAGE_MODEL);
  assert.equal(ANTIGRAVITY_IMAGE_FALLBACK_MODEL, 'cx/gpt-5.5-image');
});

test('first-attempt success does not retry or attach fallback metadata', async () => {
  const attempted: string[] = [];
  const result = await generateWithAntigravityCapacityFallback('ag/nano-banana', async (model) => {
    attempted.push(model);
    return { ok: true };
  });
  assert.deepEqual(attempted, ['ag/nano-banana']);
  assert.equal(result.usedModel, 'ag/nano-banana');
  assert.equal(result.fallbackFrom, undefined);
  assert.equal(result.fallbackMessage, undefined);
});

test('capacity on ag/… triggers one retry with cx/gpt-5.5-image', async () => {
  const attempted: string[] = [];
  const result = await generateWithAntigravityCapacityFallback('ag/nano-banana-pro', async (model) => {
    attempted.push(model);
    if (model.startsWith('ag/')) throw new Error(CAPACITY_502);
    return { ok: true, model };
  });

  assert.deepEqual(attempted, ['ag/nano-banana-pro', 'cx/gpt-5.5-image']);
  assert.equal(result.usedModel, 'cx/gpt-5.5-image');
  assert.equal(result.fallbackFrom, 'ag/nano-banana-pro');
  assert.equal(result.requestedModel, 'ag/nano-banana-pro');
  assert.equal(result.fallbackMessage, antigravityCapacityFallbackMessage('ag/nano-banana-pro'));
  assert.match(result.fallbackMessage!, /Antigravity quota full — used GPT-5\.5 Image instead/);
  assert.deepEqual(result.payload, { ok: true, model: 'cx/gpt-5.5-image' });
});

test('non-capacity 502 on ag/… does not retry', async () => {
  const attempted: string[] = [];
  await assert.rejects(
    () => generateWithAntigravityCapacityFallback('ag/nano-banana', async (model) => {
      attempted.push(model);
      throw new Error(PLAIN_502);
    }),
    (error: unknown) => error instanceof Error && error.message === PLAIN_502,
  );
  assert.deepEqual(attempted, ['ag/nano-banana']);
});

test('successful fallback returns usedModel and toast-friendly fallback metadata', async () => {
  const retries: Array<[string, string]> = [];
  const result = await generateWithAntigravityCapacityFallback(
    'ag/gemini-3.1-flash-image',
    async (model) => {
      if (model === 'ag/gemini-3.1-flash-image') throw new Error(CAPACITY_429);
      return { bytes: 12_345 };
    },
    {
      onRetry: (fallbackModel, fromModel) => {
        retries.push([fallbackModel, fromModel]);
      },
    },
  );

  assert.deepEqual(retries, [['cx/gpt-5.5-image', 'ag/gemini-3.1-flash-image']]);
  assert.equal(result.usedModel, 'cx/gpt-5.5-image');
  assert.equal(result.fallbackFrom, 'ag/gemini-3.1-flash-image');
  assert.equal(result.fallbackMessage, 'Antigravity quota full — used GPT-5.5 Image instead');
});

test('failed retry prefers the original Antigravity quota error', async () => {
  await assert.rejects(
    () => generateWithAntigravityCapacityFallback('ag/nano-banana', async (model) => {
      if (model.startsWith('ag/')) throw new Error(CAPACITY_502);
      throw new Error('Image API error 401: token is expired');
    }),
    (error: unknown) => error instanceof Error && error.message === CAPACITY_502,
  );

  const explained = explainImageFailure(CAPACITY_502, 'ag/nano-banana');
  assert.match(explained, /quota\/rate limit is full/);
  assert.match(explained, /cx\/gpt-5\.5-image/);
});

test('logging contract uses the actual model that produced the image', async () => {
  const result = await generateWithAntigravityCapacityFallback('ag/nano-banana', async (model) => {
    if (model.startsWith('ag/')) throw new Error(QUOTA_502);
    return { usage: { input_tokens: 10, output_tokens: 20 } };
  });
  assert.equal(result.usedModel, 'cx/gpt-5.5-image');

  const route = read('src/app/api/generate-image/route.ts');
  assert.match(route, /generateWithAntigravityCapacityFallback/);
  assert.match(route, /logImageGenerationUsage\(job\.ownerId, taskId, usedModel, payload\)/);
  assert.match(route, /taskType: 'image-gen'/);
  assert.doesNotMatch(route, /logImageGenerationUsage\(job\.ownerId, taskId, safeModel/);
});

test('Social Post surfaces usedModel and fallback toast copy', () => {
  const page = read('src/app/dashboard/social-post/page.tsx');
  assert.match(page, /fallbackMessage/);
  assert.match(page, /usedModel/);
  assert.match(page, /setImageNotice\(status\.result\.fallbackMessage\)/);
  assert.match(page, /role="status"/);
  assert.match(page, /status\.result\.usedModel \|\| imageModel/);
});
