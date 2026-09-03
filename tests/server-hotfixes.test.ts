import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { explainImageFailure } from '../src/app/api/generate-image/route';
import { restoreSavedVideoScript } from '../src/lib/video-script-history';

test('image failures preserve actionable upstream causes without leaking unknown details', () => {
  const model = 'gpt-5.6-terra';
  assert.match(explainImageFailure('Image API error 429: usage limit (reset after 8m 56s)', model), /8m 56s/);
  assert.doesNotMatch(explainImageFailure('Image API error 429: usage limit (reset after api_key=UPSTREAM_SECRET)', model), /UPSTREAM_SECRET|api_key/);
  assert.match(explainImageFailure('Image API error 401: token is expired', model), /retrying will not help/);
  assert.match(explainImageFailure('Image API error 402: insufficient credit', model), /administrator/);
  assert.match(explainImageFailure('Image API error 404: model not found', model), /unavailable/);
  assert.match(explainImageFailure('timeout after 240s', model), /timed out/);
  assert.equal(explainImageFailure('secret=abc123 stack trace', model), 'Image generation failed unexpectedly. Please contact the administrator if this continues.');
});

test('normalizes every saved video script shape to a visible result', () => {
  const full = { hook: 'H', fullScript: '[00:00-00:10] script' };
  assert.deepEqual(restoreSavedVideoScript({ options: [{ hook: 'preview' }, full] }), { kind: 'full', script: full });
  assert.deepEqual(restoreSavedVideoScript({ scriptData: full }), { kind: 'full', script: full });
  assert.deepEqual(restoreSavedVideoScript({ script: full }), { kind: 'full', script: full });
  assert.deepEqual(restoreSavedVideoScript(full), { kind: 'full', script: full });
  assert.deepEqual(restoreSavedVideoScript({ options: [{ hook: 'preview' }] }), { kind: 'preview', options: [{ hook: 'preview' }], selectedIndex: 0 });
  assert.deepEqual(restoreSavedVideoScript({ status: 'unknown' }), { kind: 'raw' });
});

test('saved video scripts restore into a visible result step', async () => {
  const source = await readFile(resolve('src/app/dashboard/video-script/page.tsx'), 'utf8');
  assert.match(source, /restoreSavedVideoScript\(raw\)/);
  assert.match(source, /setResult\(\{ script: restored\.script/);
  assert.match(source, /setStep\('full'\)/);
  assert.match(source, /setStep\('preview'\)/);
  assert.match(source, /setEvent\(script\.brief\)/);
  assert.match(source, /JSON\.stringify\(raw, null, 2\)/);
});
