import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MODEL_HEALTH_MAX_TOKENS,
  MODEL_HEALTH_PROMPT,
  describeHealthFailure,
  probeGatewayModel,
  sanitizeHealthError,
  selectModelsToProbe,
} from '../src/lib/model-health';

const read = (path: string) => readFileSync(path, 'utf8');
const SECRET = 'sk-super-secret-gateway-key-value';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('selectModelsToProbe defaults to the AI Research allowlist and rejects unknown ids', () => {
  const allowed = [
    { id: 'pecut-free', name: 'Pecut Free' },
    { id: 'ag/gemini-3-flash-agent', name: 'Gemini 3 Flash Agent' },
  ];
  assert.deepEqual(selectModelsToProbe(allowed), allowed);
  assert.deepEqual(selectModelsToProbe(allowed, 'pecut-free'), [allowed[0]]);
  assert.throws(() => selectModelsToProbe(allowed, 'cc/claude-sonnet-5'), /not enabled for AI Research/);
  assert.throws(() => selectModelsToProbe([], undefined), /No models are enabled/);
});

test('sanitizeHealthError redacts secrets, bearer tokens, and truncates long gateway text', () => {
  const leaked = `invalid Authorization: Bearer ${SECRET} also ${SECRET} and extra ${'x'.repeat(200)}`;
  const sanitized = sanitizeHealthError(leaked, [SECRET]);
  assert.doesNotMatch(sanitized, new RegExp(SECRET));
  assert.doesNotMatch(sanitized, /Bearer sk-/i);
  assert.match(sanitized, /\[redacted\]/);
  assert.ok(sanitized.length <= 160);
});

test('describeHealthFailure maps auth and timeout without echoing secrets', () => {
  assert.equal(
    describeHealthFailure({ httpStatus: 401, raw: `token ${SECRET} expired`, secrets: [SECRET] }),
    'Auth failed (expired or invalid API key)',
  );
  assert.equal(
    describeHealthFailure({ httpStatus: null, raw: '', timedOut: true, secrets: [SECRET] }),
    'Timed out waiting for gateway',
  );
  const fallback = describeHealthFailure({ httpStatus: 502, raw: `upstream ${SECRET}`, secrets: [SECRET] });
  assert.doesNotMatch(fallback, new RegExp(SECRET));
});

test('probeGatewayModel reports OK for a tiny non-streaming completion', async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const result = await probeGatewayModel('pecut-free', {
    name: 'Pecut Free (GorillaWorkout)',
    apiKey: SECRET,
    apiBase: 'https://llm.example.test/v1',
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init: init || {} };
      return jsonResponse(200, { choices: [{ message: { content: 'pong' } }] });
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.httpStatus, 200);
  assert.equal(result.error, null);
  assert.equal(result.model, 'pecut-free');
  assert.equal(result.name, 'Pecut Free (GorillaWorkout)');
  assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(captured?.url, 'https://llm.example.test/v1/chat/completions');
  const body = JSON.parse(String(captured?.init.body));
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, MODEL_HEALTH_MAX_TOKENS);
  assert.equal(body.messages[0].content, MODEL_HEALTH_PROMPT);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
});

test('probeGatewayModel reports FAIL for HTTP errors and strips secrets from the payload', async () => {
  const result = await probeGatewayModel('ag/gemini-3-flash-agent', {
    name: 'Gemini 3 Flash Agent',
    apiKey: SECRET,
    fetchImpl: async () => jsonResponse(401, {
      error: { message: `Incorrect API key provided: ${SECRET}` },
    }),
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.httpStatus, 401);
  assert.equal(result.error, 'Auth failed (expired or invalid API key)');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  assert.doesNotMatch(JSON.stringify(result), /Bearer /);
});

test('probeGatewayModel times out instead of hanging the UI', async () => {
  const result = await probeGatewayModel('cc/claude-sonnet-5', {
    name: 'Claude Sonnet 5',
    apiKey: SECRET,
    timeoutMs: 20,
    fetchImpl: async (_url, init) => new Promise((_, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('missing abort signal'));
        return;
      }
      signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.httpStatus, null);
  assert.equal(result.error, 'Timed out waiting for gateway');
});

test('AI Research health route is feature-gated, rate-limited, and scoped to allowed models', () => {
  const route = read('src/app/api/ai-research/health/route.ts');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const lib = read('src/lib/model-health.ts');

  assert.match(route, /requireFeature\(request, 'ai-research'\)/);
  assert.match(route, /rateLimit\(request, `ai-research-health:\$\{auth\.id\}`\)/);
  assert.match(route, /getFeatureModelOptions\('ai-research'\)/);
  assert.match(route, /selectModelsToProbe/);
  assert.match(route, /probeGatewayModel/);
  assert.match(route, /export const maxDuration = 60/);
  assert.doesNotMatch(route, /console\.(log|info|debug|error).*API_KEY/);
  assert.doesNotMatch(route, /GORILLAWORKOUT_API_KEY/);

  assert.match(page, /\/api\/ai-research\/health/);
  assert.match(page, /healthChecking \? 'Checking…' : 'Check'/);
  assert.match(page, /healthResults/);
  assert.match(page, /type="file"/);
  assert.match(page, /JSON\.stringify\(\{ messages: \[userMsg\], conversationId: activeConvoId \}\)/);

  assert.match(lib, /stream: false/);
  assert.match(lib, /max_tokens: MODEL_HEALTH_MAX_TOKENS/);
  assert.match(lib, /sanitizeHealthError/);
  assert.doesNotMatch(lib, /console\.(log|info|debug).*apiKey|console\.(log|info|debug).*API_KEY/);
});
