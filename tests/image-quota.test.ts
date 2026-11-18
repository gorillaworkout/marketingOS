import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  allFreeModelsExhaustedText,
  allImageModelsExhausted,
  clearImageModelQuota,
  formatWibTime,
  imageModelQuotaState,
  markImageModelExhausted,
  parseDurationMs,
  parseQuotaResetAt,
  quotaExhaustedText,
  quotaFallbackNotice,
  quotaHeaderSuffix,
  quotaPickerHint,
  resetImageQuotaStore,
  shortModelName,
  UNKNOWN_RESET_TTL_MS,
} from '../src/lib/image-quota';
import { generateWithAntigravityCapacityFallback } from '../src/lib/image-generation-fallback';
import { explainQuotaFailure } from '../src/app/api/generate-image/route';

// 2026-11-18 14:02:00 WIB = 07:02:00Z
const NOW = Date.parse('2026-11-18T07:02:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

/** The real gateway body for an Antigravity quota hit (seen 2026-11-18). */
const GEMINI_429 = 'Image API error 429: {"error":{"message":"[antigravity/gemini-3.1-flash-image] [429]: {\\n  \\"error\\": {\\n    \\"code\\": 429,\\n    \\"message\\": \\"You have exhausted your capacity on this model. Your quota will reset after 1h48m15s.\\",\\n    \\"status\\": \\"RESOURCE_EXHAUSTED\\"';

test('parseDurationMs reads compact and spaced durations', () => {
  assert.equal(parseDurationMs('1h48m15s'), HOUR + 48 * MIN + 15_000);
  assert.equal(parseDurationMs('1h 48m'), HOUR + 48 * MIN);
  assert.equal(parseDurationMs('48m'), 48 * MIN);
  assert.equal(parseDurationMs('30s'), 30_000);
  assert.equal(parseDurationMs('8m 56s'), 8 * MIN + 56_000);
  assert.equal(parseDurationMs('6497s'), 6_497_000);
  assert.equal(parseDurationMs('1.5s'), 1500);
  assert.equal(parseDurationMs(''), null);
  assert.equal(parseDurationMs('soon'), null);
});

test('parseQuotaResetAt: message text, "about"/"~" wording', () => {
  assert.equal(parseQuotaResetAt(GEMINI_429, NOW), NOW + HOUR + 48 * MIN + 15_000);
  assert.equal(parseQuotaResetAt('quota exhausted, resets in about 1h48m', NOW), NOW + HOUR + 48 * MIN);
  assert.equal(parseQuotaResetAt('Rate limited. Try again in 30s.', NOW), NOW + 30_000);
  assert.equal(parseQuotaResetAt('usage limit (reset after 8m 56s)', NOW), NOW + 8 * MIN + 56_000);
  assert.equal(parseQuotaResetAt('quota reset after ~48m', NOW), NOW + 48 * MIN);
  assert.equal(parseQuotaResetAt('You have exhausted your capacity on this model.', NOW), null);
  assert.equal(parseQuotaResetAt('reset after 400h', NOW), null, 'absurd values are ignored');
});

test('parseQuotaResetAt: structured fields win; otherwise the latest of text and headers', () => {
  assert.equal(parseQuotaResetAt('reset after 1h', NOW, { 'Retry-After': '120' }), NOW + HOUR, 'a short Retry-After never hides a longer reset');
  assert.equal(parseQuotaResetAt('quota exhausted', NOW, { 'Retry-After': '120' }), NOW + 120_000);
  assert.equal(parseQuotaResetAt('x', NOW, new Headers({ 'retry-after': 'Wed, 18 Nov 2026 08:50:00 GMT' })), Date.parse('2026-11-18T08:50:00Z'));
  assert.equal(parseQuotaResetAt('x', NOW, { 'x-ratelimit-reset': String(Math.floor((NOW + 10 * MIN) / 1000)) }), NOW + 10 * MIN);
  const structured = 'Image API error 429: {"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"6497s"}]},"message":"reset after 1h"}';
  assert.equal(parseQuotaResetAt(structured, NOW), NOW + 6_497_000);
  assert.equal(parseQuotaResetAt('quota {"resetAt":"2026-11-18T08:50:00Z"}', NOW), Date.parse('2026-11-18T08:50:00Z'));
  // llm-provider keeps headers on the Error via this suffix.
  // Live gateway body (2026-11-18 14:23 WIB): exact upstream timestamp + gateway's own 8s cooldown.
  const live = readFileSync(path.join(process.cwd(), 'tests/fixtures/antigravity-image-quota-429.txt'), 'utf8');
  assert.equal(parseQuotaResetAt(`${live} [retry-after: 8]`, Date.parse('2026-11-18T07:23:57Z')), Date.parse('2026-11-18T08:54:51Z'));
  assert.equal(formatWibTime(parseQuotaResetAt(live, Date.parse('2026-11-18T07:23:57Z')) as number, Date.parse('2026-11-18T07:23:57Z')), '15:54 WIB');
  // Without the timestamp, quotaResetDelay (with fractional seconds) is used.
  assert.equal(parseQuotaResetAt('{"quotaResetDelay": "1h30m53.478925003s"}', NOW), NOW + Math.round(HOUR + 30 * MIN + 53_478.925003));
  const suffix = quotaHeaderSuffix(new Headers({ 'retry-after': '90' }));
  assert.equal(suffix, ' [retry-after: 90]');
  assert.equal(parseQuotaResetAt(`Image API error 429: busy${suffix}`, NOW), NOW + 90_000);
  assert.equal(quotaHeaderSuffix(new Headers()), '');
  // Full body read before truncation: the exact timestamp survives as a marker.
  const liveNow = Date.parse('2026-11-18T07:23:57Z');
  const marker = quotaHeaderSuffix(new Headers({ 'retry-after': '8' }), live, liveNow);
  assert.equal(marker, ' [quota-reset-at: 2026-11-18T08:54:51.000Z] [retry-after: 8]');
  assert.equal(parseQuotaResetAt(`Image API error 429: ${live.slice(0, 500)}${marker}`, liveNow), Date.parse('2026-11-18T08:54:51Z'));
});

test('formatting: WIB clock time, other-day date, short labels', () => {
  const reset = parseQuotaResetAt(GEMINI_429, NOW) as number; // 15:50:15 WIB
  assert.equal(formatWibTime(reset, NOW), '15:50 WIB');
  assert.equal(formatWibTime(Date.parse('2026-11-18T18:30:00Z'), NOW), '19 Nov 01:30 WIB');
  assert.equal(shortModelName('Gemini 3.1 Flash Image (Antigravity)'), 'Gemini 3.1 Flash Image');
  assert.equal(
    quotaFallbackNotice({ fromLabel: 'Gemini 3.1 Flash Image (Antigravity)', resetAt: reset, usedLabel: 'GPT Image 2 (ChatGPT)', usedFree: true, now: NOW }),
    'Gemini 3.1 Flash Image quota exhausted, resets around 15:50 WIB. This image was generated with GPT Image 2 (free) instead.',
  );
  assert.equal(quotaExhaustedText('Gemini 3.1 Flash Image (Antigravity)', null, NOW), 'Gemini 3.1 Flash Image quota exhausted, try again later');
  assert.equal(quotaPickerHint(reset, NOW), 'Quota resets ~15:50 WIB');
  assert.equal(quotaPickerHint(null, NOW), 'Quota exhausted, try again later');
  assert.equal(
    allFreeModelsExhaustedText([{ label: 'GPT Image 2 (ChatGPT)', resetAt: NOW + 3 * HOUR }, { label: 'Gemini 3.1 Flash Image (Antigravity)', resetAt: reset }], NOW),
    'All free image models are out of quota. The earliest reset is around 15:50 WIB (Gemini 3.1 Flash Image).',
  );
  assert.equal(allFreeModelsExhaustedText([{ label: 'A', resetAt: null }], NOW), 'All free image models are out of quota; try again later.');
});

test('quota store: TTL until reset, short TTL when unknown, cleared on success', () => {
  resetImageQuotaStore();
  markImageModelExhausted('ag/gemini-3.1-flash-image', NOW + HOUR, NOW);
  assert.equal(imageModelQuotaState('ag/gemini-3.1-flash-image', NOW + 30 * MIN)?.resetAt, NOW + HOUR);
  assert.equal(imageModelQuotaState('ag/gemini-3.1-flash-image', NOW + HOUR + 1), null, 'expires at the reset time');
  markImageModelExhausted('cx/gpt-image-2', null, NOW);
  assert.ok(imageModelQuotaState('cx/gpt-image-2', NOW + UNKNOWN_RESET_TTL_MS - 1));
  assert.equal(imageModelQuotaState('cx/gpt-image-2', NOW + UNKNOWN_RESET_TTL_MS), null);
  markImageModelExhausted('cx/gpt-image-2', NOW + HOUR, NOW);
  clearImageModelQuota('cx/gpt-image-2');
  assert.equal(imageModelQuotaState('cx/gpt-image-2', NOW), null);
  resetImageQuotaStore();
});

test('all-free-exhausted uses provider groups and gives the earliest reset', () => {
  resetImageQuotaStore();
  const enabled = ['ag/gemini-3.1-flash-image', 'cx/gpt-image-2', 'cx/gpt-image-2.5'];
  markImageModelExhausted('ag/gemini-3.1-flash-image', NOW + 108 * MIN, NOW);
  assert.equal(allImageModelsExhausted(enabled, NOW), null, 'GPT Image still has quota');
  assert.match(explainQuotaFailure('ag/gemini-3.1-flash-image', 'cx/gpt-image-2', enabled, NOW), /^Gemini 3\.1 Flash Image quota exhausted, resets around 15:50 WIB; backup GPT Image 2 was also unavailable\./);
  markImageModelExhausted('cx/gpt-image-2', NOW + 3 * HOUR, NOW);
  assert.equal(allImageModelsExhausted(enabled, NOW)?.length, 2);
  assert.equal(
    explainQuotaFailure('ag/gemini-3.1-flash-image', 'cx/gpt-image-2', enabled, NOW),
    'All free image models are out of quota. The earliest reset is around 15:50 WIB (Gemini 3.1 Flash Image).',
  );
  resetImageQuotaStore();
  markImageModelExhausted('cx/gpt-image-2', null, NOW);
  assert.equal(explainQuotaFailure('cx/gpt-image-2', null, ['cx/gpt-image-2'], NOW), 'All free image models are out of quota; try again later.');
  resetImageQuotaStore();
});

test('mocked Gemini 429 → fallback records the reset and the route builds the WIB notice', async () => {
  resetImageQuotaStore();
  const seen: string[] = [];
  const result = await generateWithAntigravityCapacityFallback('ag/gemini-3.1-flash-image', async model => {
    seen.push(model);
    if (model.startsWith('ag/')) throw new Error(GEMINI_429);
    return { ok: true };
  }, {
    fallbackModel: 'cx/gpt-image-2',
    onAttemptError: (model, error) => {
      markImageModelExhausted(model, parseQuotaResetAt((error as Error).message, NOW), NOW);
    },
  });
  assert.deepEqual(seen, ['ag/gemini-3.1-flash-image', 'cx/gpt-image-2']);
  assert.equal(result.fallbackFrom, 'ag/gemini-3.1-flash-image');
  const state = imageModelQuotaState('ag/gemini-3.1-flash-image', NOW);
  assert.equal(formatWibTime(state?.resetAt as number, NOW), '15:50 WIB');
  resetImageQuotaStore();
});

test('route, API and page wire the quota info through', () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');
  const route = read('src/app/api/generate-image/route.ts');
  assert.match(route, /onAttemptError: recordQuotaFailure/);
  assert.match(route, /clearImageModelQuota\(usedModel\)/);
  assert.match(route, /quotaFallbackNotice\(/);
  assert.match(route, /\.\.\.\(quota \? \{ quota \} : \{\}\)/);
  assert.match(route, /explainQuotaFailure\(safeModel/);
  const models = read('src/app/api/image-models/route.ts');
  assert.match(models, /quota: quotaSnapshot\(\)/);
  const page = read('src/app/dashboard/generate-image/page.tsx');
  assert.match(page, /quotaPickerHint\(reset, clock\)/);
  assert.match(page, /generate-image-quota-hint/);
  const provider = read('src/lib/llm-provider.ts');
  assert.match(provider, /quotaHeaderSuffix\(attempt\.response\.headers, /);
});
