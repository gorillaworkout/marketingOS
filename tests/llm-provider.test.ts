import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decryptSecret, encryptSecret, maskSecret, scrubSecrets } from '../src/lib/llm-crypto';
import {
  DEFAULT_LLM_MODEL_MAPPINGS,
  DEFAULT_OPENROUTER_CHAT_MODEL,
  EMBEDDINGS_FAILOVER_NOTE,
} from '../src/lib/llm-provider-defaults';
import { defaultLlmSettings, type LlmSettings } from '../src/lib/llm-provider-store';
import {
  EMBEDDING_DIM,
} from '../src/lib/embeddings';
import {
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
} from '../src/lib/llm-provider-defaults';
import {
  IMAGE_CREDITS_MESSAGE,
  MODEL_PROBE_GAP_MS,
  MODEL_PROBE_MAX_TOKENS,
  OPENROUTER_RATE_LIMIT_MESSAGE,
  PROVIDER_CIRCUIT_OPEN_MS,
  PROVIDER_FAILURES_TO_OPEN,
  applyProviderResult,
  canManageLlmProvider,
  chooseProvider,
  classifyModelProbe,
  failoverEmbeddingWriteAllowed,
  healthProbePlan,
  openRouterChatChain,
  imageRequestPath,
  isProviderFailoverStatus,
  mapModel,
  postChat,
  postImage,
  probeModel,
  probeModelsInOrder,
  readCircuit,
  resetLlmProviderForTests,
  resolveProviderTarget,
  setLlmFetchForTests,
  setLlmSettingsReaderForTests,
} from '../src/lib/llm-provider';

function settings(overrides: Partial<LlmSettings> = {}): LlmSettings {
  return { ...defaultLlmSettings(), openrouterKey: 'sk-or-test-key-1234', keyConfigured: true, keyHint: '••••1234', ...overrides };
}

function jsonResponse(status: number, body: unknown = { choices: [{ message: { content: 'ok' } }] }): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test.beforeEach(() => {
  resetLlmProviderForTests();
  process.env.GORILLAWORKOUT_API_KEY = 'dupoin-test-key';
  delete process.env.GORILLAWORKOUT_API_BASE;
});

test.afterEach(() => {
  resetLlmProviderForTests();
});

test('admin access is role admin only', () => {
  assert.equal(canManageLlmProvider({ role: 'admin' }), true);
  assert.equal(canManageLlmProvider({ role: 'user' }), false);
  assert.equal(canManageLlmProvider({ role: null }), false);
  assert.equal(canManageLlmProvider(null), false);
  const route = readFileSync('src/app/api/admin/llm-provider/route.ts', 'utf8');
  const testRoute = readFileSync('src/app/api/admin/llm-provider/test/route.ts', 'utf8');
  const nav = readFileSync('src/app/dashboard/layout.tsx', 'utf8');
  assert.match(route, /requireAdmin\(request\)/);
  assert.match(testRoute, /requireAdmin\(request\)/);
  assert.match(readFileSync('src/app/dashboard/models/page.tsx', 'utf8'), /role === 'admin'/);
  assert.match(nav, /href: '\/dashboard\/models', label: 'Models'/);
  assert.doesNotMatch(nav, /LLM Provider/);
});

test('default Dupoin mode keeps the env gateway, model, and key', async () => {
  const calls: Array<{ url: string; body: string; headers: Headers }> = [];
  setLlmSettingsReaderForTests(async () => settings({ mode: 'dupoin' }));
  setLlmFetchForTests(async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body), headers: new Headers(init?.headers) });
    return jsonResponse(200);
  });
  const exchange = await postChat({
    model: 'ag/gemini-3-flash',
    body: { messages: [{ role: 'user', content: 'hi' }] },
    referer: 'https://marketingos.local',
    title: 'MarketingOS',
    timeoutMs: 1000,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://llmdupoin.gorillaworkout.id/v1/chat/completions');
  assert.equal(JSON.parse(calls[0].body).model, 'ag/gemini-3-flash');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer dupoin-test-key');
  assert.equal(exchange.provider, 'gorillaworkout');
  assert.equal(exchange.upstreamModel, 'ag/gemini-3-flash');
});

test('OpenRouter mode maps a verified model and sends the recommended headers', async () => {
  const calls: Array<{ url: string; body: string; headers: Headers }> = [];
  setLlmSettingsReaderForTests(async () => settings({ mode: 'openrouter' }));
  setLlmFetchForTests(async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body), headers: new Headers(init?.headers) });
    return jsonResponse(200);
  });
  const exchange = await postChat({
    model: 'cc/claude-sonnet-5-5',
    body: { messages: [] },
    referer: 'https://marketing-aws.gorillaworkout.id',
    title: 'Dupoin AI Research',
    timeoutMs: 1000,
  });
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(JSON.parse(calls[0].body).model, 'thinkingmachines/inkling-2-small:free');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer sk-or-test-key-1234');
  assert.equal(calls[0].headers.get('http-referer'), 'https://marketing-aws.gorillaworkout.id');
  assert.equal(calls[0].headers.get('x-title'), 'Dupoin AI Research');
  assert.equal(exchange.provider, 'openrouter');
});

test('an unmapped model uses the admin default substitute', () => {
  const mapped = mapModel('cx/gpt-6-sol', DEFAULT_LLM_MODEL_MAPPINGS, DEFAULT_OPENROUTER_CHAT_MODEL, 'chat');
  assert.equal(mapped.mapped, false);
  assert.equal(mapped.model, 'thinkingmachines/inkling-2-small:free');
  const known = mapModel('ag/gemini-3-flash', DEFAULT_LLM_MODEL_MAPPINGS, DEFAULT_OPENROUTER_CHAT_MODEL, 'chat');
  assert.equal(known.model, 'thinkingmachines/inkling-2-small:free');
  assert.equal(known.mapped, true);
});

test('automatic mode failovers on 429, 5xx, and network errors, not on a bad prompt', async () => {
  const calls: string[] = [];
  setLlmSettingsReaderForTests(async () => settings({ mode: 'auto' }));
  setLlmFetchForTests(async (url) => {
    calls.push(String(url));
    if (String(url).includes('llmdupoin')) return jsonResponse(400, { error: 'bad prompt' });
    return jsonResponse(200);
  });
  const rejected = await postChat({ model: 'ag/gemini-3-flash', body: {}, referer: 'https://marketingos.local', title: 'MarketingOS', timeoutMs: 1000 });
  assert.equal(rejected.response.status, 400);
  assert.equal(calls.length, 1);

  calls.length = 0;
  resetLlmProviderForTests();
  setLlmSettingsReaderForTests(async () => settings({ mode: 'auto' }));
  setLlmFetchForTests(async (url) => {
    calls.push(String(url));
    if (String(url).includes('llmdupoin')) return jsonResponse(503, { error: 'down' });
    return jsonResponse(200);
  });
  const failedOver = await postChat({ model: 'cc/claude-sonnet-5-5', body: {}, referer: 'https://marketingos.local', title: 'MarketingOS', timeoutMs: 1000 });
  assert.equal(failedOver.provider, 'openrouter');
  assert.equal(failedOver.upstreamModel, 'thinkingmachines/inkling-2-small:free');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /openrouter.ai/);

  calls.length = 0;
  resetLlmProviderForTests();
  setLlmSettingsReaderForTests(async () => settings({ mode: 'auto' }));
  setLlmFetchForTests(async (url) => {
    calls.push(String(url));
    if (String(url).includes('llmdupoin')) throw new Error('fetch failed: ECONNREFUSED');
    return jsonResponse(200);
  });
  const networked = await postChat({ model: 'ag/gemini-3-flash', body: {}, referer: 'https://marketingos.local', title: 'MarketingOS', timeoutMs: 1000 });
  assert.equal(networked.provider, 'openrouter');
  assert.equal(isProviderFailoverStatus(429), true);
  assert.equal(isProviderFailoverStatus(400), false);
});

test('a request that already streamed to the user is not repeated', async () => {
  let calls = 0;
  setLlmSettingsReaderForTests(async () => settings({ mode: 'auto' }));
  setLlmFetchForTests(async () => {
    calls += 1;
    return jsonResponse(503);
  });
  const response = await postChat({
    model: 'ag/gemini-3-flash',
    body: {},
    referer: 'https://marketingos.local',
    title: 'MarketingOS',
    timeoutMs: 1000,
    streamedToUser: true,
  });
  assert.equal(calls, 1);
  assert.equal(response.response.status, 503);
  assert.equal(response.provider, 'gorillaworkout');
});

test('the circuit opens after repeated Dupoin failures and probes Dupoin again when it expires', async () => {
  const calls: string[] = [];
  setLlmSettingsReaderForTests(async () => settings({ mode: 'auto' }));
  setLlmFetchForTests(async (url) => {
    calls.push(String(url));
    if (String(url).includes('llmdupoin')) return jsonResponse(502);
    return jsonResponse(200);
  });
  const now = 1_000_000;
  for (let index = 0; index < PROVIDER_FAILURES_TO_OPEN; index += 1) {
    await postChat({ model: 'ag/gemini-3-flash', body: {}, referer: 'https://marketingos.local', title: 'MarketingOS', timeoutMs: 1000, now: now + index });
  }
  assert.ok(readCircuit().openUntil > now);
  calls.length = 0;
  await postChat({ model: 'ag/gemini-3-flash', body: {}, referer: 'https://marketingos.local', title: 'MarketingOS', timeoutMs: 1000, now: now + 10 });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /openrouter.ai/);

  calls.length = 0;
  setLlmFetchForTests(async (url) => {
    calls.push(String(url));
    return jsonResponse(200);
  });
  const recovered = await postChat({
    model: 'ag/gemini-3-flash',
    body: {},
    referer: 'https://marketingos.local',
    title: 'MarketingOS',
    timeoutMs: 1000,
    now: now + PROVIDER_CIRCUIT_OPEN_MS + 5,
  });
  assert.match(calls[0], /llmdupoin/);
  assert.equal(recovered.provider, 'gorillaworkout');
  assert.equal(readCircuit().consecutiveFailures, 0);
});

test('applyProviderResult resets on success and ignores client errors', () => {
  const opened = applyProviderResult({
    mode: 'auto',
    attempted: 'dupoin',
    outcome: 'transport',
    streamedToUser: false,
    circuit: { consecutiveFailures: PROVIDER_FAILURES_TO_OPEN - 1, openUntil: 0 },
    now: 50,
  });
  assert.equal(opened.failover, true);
  assert.equal(opened.circuit.openUntil, 50 + PROVIDER_CIRCUIT_OPEN_MS);
  const kept = applyProviderResult({
    mode: 'auto',
    attempted: 'dupoin',
    outcome: 'client',
    streamedToUser: false,
    circuit: opened.circuit,
    now: 80,
  });
  assert.equal(kept.failover, false);
  assert.equal(kept.circuit.consecutiveFailures, PROVIDER_FAILURES_TO_OPEN);
  const reset = applyProviderResult({
    mode: 'auto',
    attempted: 'dupoin',
    outcome: 'ok',
    streamedToUser: false,
    circuit: opened.circuit,
    now: 90,
  });
  assert.deepEqual(reset.circuit, { consecutiveFailures: 0, openUntil: 0 });
  assert.equal(chooseProvider('dupoin', opened.circuit, 90), 'dupoin');
  assert.equal(chooseProvider('auto', opened.circuit, 90), 'openrouter');
});

test('encryption round-trips the key and never returns it in the mask', () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  const stored = encryptSecret('sk-or-live-secret-9876');
  assert.notEqual(stored, 'sk-or-live-secret-9876');
  assert.equal(decryptSecret(stored), 'sk-or-live-secret-9876');
  assert.notEqual(encryptSecret('sk-or-live-secret-9876'), stored);
  assert.equal(maskSecret('sk-or-live-secret-9876'), '••••9876');
  assert.equal(scrubSecrets('Authorization: Bearer sk-or-live-secret-9876'), 'Authorization: Bearer [redacted]');
  process.env.JWT_SECRET = 'other-secret';
  assert.throws(() => decryptSecret(stored), /Could not read the stored OpenRouter API key/);
  delete process.env.JWT_SECRET;
  assert.throws(() => encryptSecret('sk-or-live-secret-9876'), /JWT_SECRET is required/);
});

test('Dupoin image stays on images/generations and an unknown OpenRouter image model fails clearly', async () => {
  const dupoin = resolveProviderTarget({ settings: settings({ mode: 'dupoin' }), provider: 'dupoin', kind: 'image', model: 'ag/gemini-3.1-flash-image' });
  assert.equal(imageRequestPath(dupoin.provider), '/images/generations');
  assert.equal(dupoin.model, 'ag/gemini-3.1-flash-image');
  const openrouter = resolveProviderTarget({ settings: settings(), provider: 'openrouter', kind: 'image', model: 'ag/gemini-3.1-flash-image' });
  assert.equal(openrouter.model, 'google/gemini-3.1-flash-image');
  assert.equal(imageRequestPath('openrouter'), '/images');

  setLlmSettingsReaderForTests(async () => settings({
    mode: 'openrouter',
    defaultImageModel: 'not-a-catalog/image',
    mappings: [],
  }));
  setLlmFetchForTests(async () => jsonResponse(200));
  await assert.rejects(
    () => postImage({ model: 'ag/custom-image', prompt: 'blue square', size: '1024x1024', aspectRatio: '1:1', timeoutMs: 1000 }),
    /OpenRouter cannot serve image model/,
  );
});

test('migration seeds the verified map and stores no secrets', () => {
  const sql = readFileSync('db/migrations/049_llm_provider.sql', 'utf8');
  for (const mapping of DEFAULT_LLM_MODEL_MAPPINGS) {
    assert.match(sql, new RegExp(mapping.dupoinModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    if (mapping.kind !== 'chat') assert.match(sql, new RegExp(mapping.openrouterModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(readFileSync('db/migrations/051_model_tiers.sql', 'utf8'), /thinkingmachines\/inkling-2-small:free/);
  assert.match(sql, /ON CONFLICT \(dupoin_model\) DO NOTHING/);
  assert.match(sql, /DROP TABLE IF EXISTS llm_provider_settings/);
  assert.doesNotMatch(sql, /sk-|api[_-]?key\s*=/i);
  assert.match(readFileSync('src/app/dashboard/models/page.tsx', 'utf8'), /EMBEDDINGS_FAILOVER_NOTE|1024/);
  assert.match(EMBEDDINGS_FAILOVER_NOTE, /does not write OpenRouter embeddings/i);
  assert.match(readFileSync('src/app/dashboard/models/page.tsx', 'utf8'), /OpenRouter text chain/);
  assert.equal(failoverEmbeddingWriteAllowed(), false);
  assert.equal(EMBEDDING_DIM, 1024);
  assert.equal(DEFAULT_OPENROUTER_EMBEDDING_MODEL, 'liquid/lfm-2.5-embedding-350m:free');
  for (const mapping of DEFAULT_LLM_MODEL_MAPPINGS) {
    if (mapping.kind === 'chat') assert.match(mapping.openrouterModel, /:free$/);
  }
});

test('OpenRouter 429 is explained once and is not retried in a loop', async () => {
  let calls = 0;
  setLlmSettingsReaderForTests(async () => settings({ mode: 'auto' }));
  setLlmFetchForTests(async () => {
    calls += 1;
    return jsonResponse(429, { error: 'rate limit exceeded' });
  });
  await assert.rejects(
    () => postChat({ model: 'ag/gemini-3-flash', body: {}, referer: 'https://marketingos.local', title: 'MarketingOS', timeoutMs: 1000 }),
    new RegExp(OPENROUTER_RATE_LIMIT_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.equal(calls, 4);

  calls = 0;
  resetLlmProviderForTests();
  setLlmSettingsReaderForTests(async () => settings({ mode: 'openrouter' }));
  setLlmFetchForTests(async () => {
    calls += 1;
    return jsonResponse(429, { error: 'rate limit exceeded' });
  });
  await assert.rejects(
    () => postChat({ model: 'ag/gemini-3-flash', body: {}, referer: 'https://marketingos.local', title: 'MarketingOS', timeoutMs: 1000 }),
    /OpenRouter free-model rate limit/,
  );
  assert.equal(calls, 3);
});

test('a 429 on the first OpenRouter chat model tries the next id once and stops when it answers', async () => {
  const bodies: string[] = [];
  setLlmSettingsReaderForTests(async () => settings({ mode: 'openrouter' }));
  setLlmFetchForTests(async (_url, init) => {
    bodies.push(String(init?.body));
    return jsonResponse(bodies.length === 1 ? 429 : 200);
  });
  const exchange = await postChat({ model: 'ag/gemini-3-flash', body: { max_tokens: 100 }, referer: 'https://marketingos.local', title: 'MarketingOS', timeoutMs: 1000 });
  assert.equal(bodies.length, 2);
  assert.equal(JSON.parse(bodies[0]).model, 'thinkingmachines/inkling-2-small:free');
  assert.equal(JSON.parse(bodies[1]).model, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.equal(exchange.upstreamModel, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.deepEqual(openRouterChatChain('thinkingmachines/inkling-2-small:free', ['thinkingmachines/inkling-2-small:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter/free']), [
    'thinkingmachines/inkling-2-small:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'openrouter/free',
  ]);
});

test('model probes use the real id, headroom for reasoning models, and skip images unless asked', async () => {
  assert.equal(classifyModelProbe(429, 'rate limit'), 'rate_limited');
  assert.equal(classifyModelProbe(404, 'no endpoints found'), 'blocked');
  assert.equal(classifyModelProbe(402, 'Insufficient credits'), 'credits');
  assert.equal(classifyModelProbe(200, ''), 'active');
  const plan = healthProbePlan({
    mappings: [
      { dupoinModel: 'ag/gemini-3-flash', openrouterModel: 'thinkingmachines/inkling-2-small:free', kind: 'chat' },
      { dupoinModel: 'ag/gemini-3.1-flash-image', openrouterModel: 'google/gemini-3.1-flash-image', kind: 'image' },
    ],
    chatFallbacks: ['openrouter/free'],
    defaultChatModel: 'thinkingmachines/inkling-2-small:free',
    defaultImageModel: 'google/gemini-3.1-flash-image',
    defaultEmbeddingModel: 'liquid/lfm-2.5-embedding-350m:free',
    includeImages: false,
  });
  assert.equal(plan.some(target => target.kind === 'image'), false);
  assert.equal(plan.some(target => target.model === 'openrouter/free' && target.kind === 'chat'), true);

  const bodies: Array<{ url: string; body: string }> = [];
  setLlmSettingsReaderForTests(async () => settings({ mode: 'openrouter' }));
  setLlmFetchForTests(async (url, init) => {
    bodies.push({ url: String(url), body: String(init?.body) });
    if (String(url).endsWith('/embeddings')) {
      return jsonResponse(200, { data: [{ embedding: new Array(1024).fill(0.1) }] });
    }
    return jsonResponse(200, { choices: [{ message: { content: 'ok' } }] });
  });
  const chat = await probeModel({ provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', kind: 'chat' });
  assert.equal(JSON.parse(bodies[0].body).model, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.ok(JSON.parse(bodies[0].body).max_tokens >= MODEL_PROBE_MAX_TOKENS);
  assert.equal(chat.status, 'active');
  const embedding = await probeModel({ provider: 'openrouter', model: 'liquid/lfm-2.5-embedding-350m:free', kind: 'embedding' });
  assert.match(bodies[1].url, /\/embeddings$/);
  assert.equal(embedding.dimension, 1024);
  assert.match(embedding.message, /Not stored/);
  assert.equal(JSON.stringify(embedding).includes('sk-or-test-key'), false);

  const gaps: number[] = [];
  await probeModelsInOrder([
    { provider: 'openrouter', model: 'thinkingmachines/inkling-2-small:free', kind: 'chat' },
    { provider: 'openrouter', model: 'openrouter/free', kind: 'chat' },
  ], async ms => { gaps.push(ms); });
  assert.deepEqual(gaps, [MODEL_PROBE_GAP_MS]);
  assert.match(readFileSync('db/migrations/050_llm_model_health.sql', 'utf8'), /llm_model_health/);
  assert.match(readFileSync('db/migrations/050_llm_model_health.sql', 'utf8'), /nvidia\/nemotron-3-ultra-550b-a55b:free/);
  assert.match(readFileSync('src/app/api/admin/llm-provider/probe/route.ts', 'utf8'), /requireAdmin\(request\)/);
  assert.match(readFileSync('src/app/dashboard/models/page.tsx', 'utf8'), /Test all models/);
});

test('an OpenRouter image key without credits fails with a clear message', async () => {
  setLlmSettingsReaderForTests(async () => settings({ mode: 'openrouter' }));
  setLlmFetchForTests(async () => jsonResponse(402, { error: 'Insufficient credits' }));
  await assert.rejects(
    () => postImage({ model: 'ag/gemini-3.1-flash-image', prompt: 'blue square', size: '1024x1024', aspectRatio: '1:1', timeoutMs: 1000 }),
    new RegExp(IMAGE_CREDITS_MESSAGE),
  );
});
