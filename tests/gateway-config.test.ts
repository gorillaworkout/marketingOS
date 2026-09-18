import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GORILLAWORKOUT_API_BASE,
  resolveGorillaWorkoutApiBase,
  resolveGorillaWorkoutApiKey,
} from '../src/lib/gateway-config';

test('default API base is llmdupoin, not llm.gorillaworkout.id', () => {
  assert.equal(DEFAULT_GORILLAWORKOUT_API_BASE, 'https://llmdupoin.gorillaworkout.id/v1');
  assert.doesNotMatch(DEFAULT_GORILLAWORKOUT_API_BASE, /https:\/\/llm\.gorillaworkout\.id/);
});

test('resolveGorillaWorkoutApiBase prefers the override, then env, then default', () => {
  assert.equal(
    resolveGorillaWorkoutApiBase('https://custom.example/v1/'),
    'https://custom.example/v1',
  );
  const previous = process.env.GORILLAWORKOUT_API_BASE;
  delete process.env.GORILLAWORKOUT_API_BASE;
  try {
    assert.equal(resolveGorillaWorkoutApiBase(), DEFAULT_GORILLAWORKOUT_API_BASE);
    process.env.GORILLAWORKOUT_API_BASE = 'https://llm.gorillaworkout.id/v1/';
    assert.equal(resolveGorillaWorkoutApiBase(), 'https://llm.gorillaworkout.id/v1');
  } finally {
    if (previous === undefined) delete process.env.GORILLAWORKOUT_API_BASE;
    else process.env.GORILLAWORKOUT_API_BASE = previous;
  }
});

test('resolveGorillaWorkoutApiKey never invents a secret', () => {
  assert.equal(resolveGorillaWorkoutApiKey(''), '');
  assert.equal(resolveGorillaWorkoutApiKey('from-arg'), 'from-arg');
});
