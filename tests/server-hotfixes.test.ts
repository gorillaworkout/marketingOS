import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { explainImageFailure } from '../src/app/api/generate-image/route';

test('image failures preserve actionable upstream causes', () => {
  const model = 'gpt-5.6-terra';
  assert.match(explainImageFailure('Image API error 429: usage limit (reset after 8m 56s)', model), /8m 56s/);
  assert.match(explainImageFailure('Image API error 401: token is expired', model), /retrying will not help/);
  assert.match(explainImageFailure('Image API error 402: insufficient credit', model), /administrator/);
  assert.match(explainImageFailure('Image API error 404: model not found', model), /unavailable/);
  assert.match(explainImageFailure('timeout after 240s', model), /timed out/);
  assert.match(explainImageFailure('opaque upstream failure', model), /opaque upstream failure/);
});

test('saved video scripts restore into a visible result step', async () => {
  const source = await readFile(resolve('src/app/dashboard/video-script/page.tsx'), 'utf8');
  assert.match(source, /Array\.isArray\(raw\.options\)/);
  assert.match(source, /setStep\('full'\)/);
  assert.match(source, /setStep\('preview'\)/);
  assert.match(source, /setEvent\(script\.brief\)/);
  assert.match(source, /JSON\.stringify\(raw, null, 2\)/);
});
