import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { explainImageFailure } from '../src/app/api/generate-image/route';

test('image failures preserve actionable upstream causes', () => {
  const model = 'gpt-5.6-terra';
  assert.match(explainImageFailure('Image API error 429: usage limit (reset after 8m 56s)', model), /retry in 8m 56s/);
  assert.match(explainImageFailure('Image API error 401: token is expired', model), /token expired/);
  assert.match(explainImageFailure('Image API error 401: token is expired', model), /re-authenticate it in AI Models/);
  assert.match(explainImageFailure('Image API error 402: insufficient credit', model), /administrator/);
  assert.match(explainImageFailure('Image API error 404: model not found', model), /unavailable/);
  assert.match(explainImageFailure('timeout after 240s', model), /timed out/);
  assert.match(explainImageFailure('opaque upstream failure', model), /opaque upstream failure/);
  assert.match(explainImageFailure('Image API error 502: Bad Gateway', model), /temporarily down \(502\)/);
});

test('gateway-wrapped Antigravity capacity 502s are quota messages, not outages', () => {
  const antigravity = 'ag/nano-banana-pro';
  const wrapped = 'Image API error 502: {"error":{"message":"You have exhausted your capacity on this mode"}}';
  const explained = explainImageFailure(wrapped, antigravity);
  assert.match(explained, /Image quota reached/);
  assert.match(explained, /no other image model enabled/);
  assert.doesNotMatch(explained, /cx\/gpt-5\.5-image/);
  assert.doesNotMatch(explained, /temporarily down/);

  const quotaWrapped = explainImageFailure('Image API error 502: rate limit / quota exceeded', antigravity);
  assert.match(quotaWrapped, /Image quota reached/);
  assert.doesNotMatch(quotaWrapped, /temporarily down/);

  const real429 = explainImageFailure('Image API error 429: You have exhausted your capacity on this mode', antigravity);
  assert.match(real429, /Image quota reached/);
  assert.doesNotMatch(real429, /cx\/gpt-5\.5-image/);
});

test('saved video scripts restore into a visible result step', async () => {
  const source = await readFile(resolve('src/app/dashboard/video-script/page.tsx'), 'utf8');
  assert.match(source, /Array\.isArray\(raw\.options\)/);
  assert.match(source, /setStep\('full'\)/);
  assert.match(source, /setStep\('preview'\)/);
  assert.match(source, /setEvent\(script\.brief\)/);
  assert.match(source, /JSON\.stringify\(raw, null, 2\)/);
});
