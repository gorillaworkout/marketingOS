import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENROUTER_FREE_IMAGE_BACKUP_MODEL,
  freeImageBackupModel,
  isOpenRouterFreeImageModel,
} from '../src/lib/llm-provider-defaults';
import { defaultLlmSettings, type LlmSettings } from '../src/lib/llm-provider-store';
import {
  postImage,
  readCircuit,
  resetLlmProviderForTests,
  setLlmFetchForTests,
  setLlmSettingsReaderForTests,
} from '../src/lib/llm-provider';
import { generateWithAntigravityCapacityFallback, imageQuotaNotice } from '../src/lib/image-generation-fallback';
import { explainImageFailure } from '../src/app/api/generate-image/route';
import { imageModelLabel } from '../src/lib/image-models';
import { modelsInUse } from '../src/lib/model-tiers';

const BEFORE_EXPIRY = Date.parse('2026-11-15T07:00:00Z');
const AFTER_EXPIRY = Date.parse('2026-11-29T00:00:01Z');
const CAPACITY_502 = 'Image API error 502: {"error":{"message":"You have exhausted your capacity on this mode"}}';
const PNG_B64 = Buffer.alloc(20_000, 1).toString('base64');

function settings(overrides: Partial<LlmSettings> = {}): LlmSettings {
  return { ...defaultLlmSettings(), openrouterKey: 'sk-or-test-key-1234', keyConfigured: true, keyHint: '••••1234', ...overrides };
}

test.beforeEach(() => {
  resetLlmProviderForTests();
  process.env.GORILLAWORKOUT_API_KEY = 'dupoin-test-key';
});
test.afterEach(() => resetLlmProviderForTests());

test('free backup is offered until its OpenRouter expiry, then switches off', () => {
  assert.equal(OPENROUTER_FREE_IMAGE_BACKUP_MODEL, 'recraft/recraft-v4.1-flash-v2:free');
  assert.equal(freeImageBackupModel(BEFORE_EXPIRY), OPENROUTER_FREE_IMAGE_BACKUP_MODEL);
  assert.equal(freeImageBackupModel(AFTER_EXPIRY), null);
  assert.equal(isOpenRouterFreeImageModel('google/gemini-3.1-flash-image', BEFORE_EXPIRY), false);
  assert.equal(imageModelLabel(OPENROUTER_FREE_IMAGE_BACKUP_MODEL), 'Recraft V4.1 Flash (OpenRouter free)');
});

test('free backup goes straight to OpenRouter /images with its exact free id in auto mode', async () => {
  setLlmSettingsReaderForTests(async () => settings({ mode: 'auto' }));
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  setLlmFetchForTests(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 });
  });
  const result = await postImage({ model: OPENROUTER_FREE_IMAGE_BACKUP_MODEL, prompt: 'p', size: '1024x1024', aspectRatio: '1:1', timeoutMs: 1000, now: BEFORE_EXPIRY });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/images');
  assert.equal(calls[0].body.model, OPENROUTER_FREE_IMAGE_BACKUP_MODEL);
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.upstreamModel, OPENROUTER_FREE_IMAGE_BACKUP_MODEL);
  assert.deepEqual(readCircuit(), { consecutiveFailures: 0, openUntil: 0 });
});

test('Dupoin-only mode refuses the OpenRouter free backup without calling out', async () => {
  setLlmSettingsReaderForTests(async () => settings({ mode: 'dupoin' }));
  let called = false;
  setLlmFetchForTests(async () => { called = true; return new Response('{}', { status: 200 }); });
  await assert.rejects(
    postImage({ model: OPENROUTER_FREE_IMAGE_BACKUP_MODEL, prompt: 'p', size: '1024x1024', timeoutMs: 1000, now: BEFORE_EXPIRY }),
    /off while AI Models provider mode is LLM Dupoin only/,
  );
  assert.equal(called, false);
});

test('Gemini quota hit retries once on the free backup and reports it', async () => {
  const attempts: string[] = [];
  const result = await generateWithAntigravityCapacityFallback('ag/gemini-3.1-flash-image', async model => {
    attempts.push(model);
    if (model.startsWith('ag/')) throw new Error(CAPACITY_502);
    return { ok: true };
  }, { fallbackModel: OPENROUTER_FREE_IMAGE_BACKUP_MODEL });
  assert.deepEqual(attempts, ['ag/gemini-3.1-flash-image', OPENROUTER_FREE_IMAGE_BACKUP_MODEL]);
  assert.equal(result.usedModel, OPENROUTER_FREE_IMAGE_BACKUP_MODEL);
  assert.match(result.fallbackMessage ?? '', /Recraft V4\.1 Flash \(OpenRouter free\)/);
});

test('when the backup also fails, the quota notice names the backup instead of "no other model"', async () => {
  let backupError = '';
  await assert.rejects(generateWithAntigravityCapacityFallback('ag/gemini-3.1-flash-image', async model => {
    throw new Error(model.startsWith('ag/') ? CAPACITY_502 : 'OpenRouter image error 404: no endpoints');
  }, { fallbackModel: OPENROUTER_FREE_IMAGE_BACKUP_MODEL, onFallbackError: (_m, e) => { backupError = (e as Error).message; } }), /exhausted your capacity/);
  assert.match(backupError, /404/);
  const message = explainImageFailure(CAPACITY_502, 'ag/gemini-3.1-flash-image', imageModelLabel(OPENROUTER_FREE_IMAGE_BACKUP_MODEL));
  assert.match(message, /backup image model Recraft V4\.1 Flash \(OpenRouter free\) was also unavailable/);
  assert.match(imageQuotaNotice('Gemini'), /no other image model enabled/);
});

test('Test all with images probes the free backup on OpenRouter', () => {
  const rows = modelsInUse({ primaries: ['ag/gemini-3.1-flash-image'], freeChain: [], paidTargets: [], usePaid: false, embeddingModel: 'x', imageModel: 'ag/gemini-3.1-flash-image', includeImages: true, freeImageBackup: OPENROUTER_FREE_IMAGE_BACKUP_MODEL });
  assert.ok(rows.some(row => row.provider === 'openrouter' && row.kind === 'image' && row.model === OPENROUTER_FREE_IMAGE_BACKUP_MODEL));
});
