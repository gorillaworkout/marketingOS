import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GATEWAY_BROWSER_USER_AGENT,
  MODEL_HEALTH_MAX_TOKENS,
  MODEL_HEALTH_PROMPT,
  describeHealthFailure,
  extractGatewaySnippet,
  looksStaleOrDeprecated,
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

function htmlResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
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
  assert.ok(sanitized.length <= 180);
});

test('extractGatewaySnippet pulls JSON errors, completion text, and Cloudflare 1010', () => {
  assert.equal(
    extractGatewaySnippet(JSON.stringify({
      error: { type: 'FreeTierError', message: "OpenCode's free tier can only be used from within OpenCode" },
    })),
    "FreeTierError: OpenCode's free tier can only be used from within OpenCode",
  );
  assert.equal(
    extractGatewaySnippet(JSON.stringify({ choices: [{ message: { content: 'pong' } }] })),
    'pong',
  );
  assert.equal(
    extractGatewaySnippet('<html>Attention Required! error code 1010 Cloudflare</html>'),
    'Cloudflare blocked the probe (error 1010)',
  );
});

test('looksStaleOrDeprecated flags Gemini switch/deprecation notices but not a healthy ping', () => {
  assert.equal(looksStaleOrDeprecated('pong'), false);
  assert.equal(
    looksStaleOrDeprecated('Gemini 3.5 Flash is no longer available. Please switch to Gemini 3.7 Flash.'),
    true,
  );
});

test('describeHealthFailure maps auth, timeout, and Cloudflare without echoing secrets', () => {
  assert.match(
    describeHealthFailure({ httpStatus: 401, raw: `token ${SECRET} expired`, secrets: [SECRET] }),
    /Auth failed/,
  );
  assert.doesNotMatch(
    describeHealthFailure({ httpStatus: 401, raw: `token ${SECRET} expired`, secrets: [SECRET] }),
    new RegExp(SECRET),
  );
  assert.equal(
    describeHealthFailure({ httpStatus: null, raw: '', timedOut: true, secrets: [SECRET] }),
    'Timed out waiting for gateway',
  );
  assert.equal(
    describeHealthFailure({
      httpStatus: 403,
      raw: '<html>error code 1010 Cloudflare</html>',
      secrets: [SECRET],
    }),
    'Cloudflare blocked the probe (error 1010)',
  );
});

test('probeGatewayModel reports OK for a tiny non-streaming completion and sends a browser User-Agent', async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const result = await probeGatewayModel('cc/claude-sonnet-5', {
    name: 'Claude Sonnet 5',
    apiKey: SECRET,
    apiBase: 'https://llmdupoin.gorillaworkout.id/v1',
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init: init || {} };
      return jsonResponse(200, { choices: [{ message: { content: 'pong' } }] });
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.httpStatus, 200);
  assert.equal(result.error, null);
  assert.equal(result.snippet, 'pong');
  assert.equal(captured?.url, 'https://llmdupoin.gorillaworkout.id/v1/chat/completions');
  const headers = new Headers(captured?.init.headers);
  assert.equal(headers.get('User-Agent'), GATEWAY_BROWSER_USER_AGENT);
  assert.match(GATEWAY_BROWSER_USER_AGENT, /Mozilla\/5\.0/);
  assert.match(GATEWAY_BROWSER_USER_AGENT, /Chrome\//);
  const body = JSON.parse(String(captured?.init.body));
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, MODEL_HEALTH_MAX_TOKENS);
  assert.equal(body.messages[0].content, MODEL_HEALTH_PROMPT);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
});

test('probeGatewayModel reports FAIL with HTTP 400 FreeTierError snippet and strips secrets', async () => {
  const result = await probeGatewayModel('pecut-free', {
    name: 'Pecut Free (GorillaWorkout)',
    apiKey: SECRET,
    fetchImpl: async () => jsonResponse(400, {
      error: {
        type: 'FreeTierError',
        message: `OpenCode's free tier can only be used from within OpenCode (${SECRET})`,
      },
    }),
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.httpStatus, 400);
  assert.match(result.error || '', /FreeTierError/);
  assert.match(result.error || '', /OpenCode's free tier/);
  assert.match(result.snippet || '', /OpenCode's free tier/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
});

test('probeGatewayModel flags HTTP 200 deprecation replies as stale and keeps a snippet', async () => {
  const notice = 'Gemini 3.5 Flash is no longer available. Please switch to Gemini 3.7 Flash.';
  const result = await probeGatewayModel('ag/gemini-3-flash-agent', {
    name: 'Gemini 3 Flash Agent',
    apiKey: SECRET,
    fetchImpl: async () => jsonResponse(200, { choices: [{ message: { content: notice } }] }),
  });
  assert.equal(result.status, 'stale');
  assert.equal(result.httpStatus, 200);
  assert.match(result.error || '', /deprecation|switch notice/i);
  assert.match(result.snippet || '', /Gemini 3\.5 Flash is no longer available/);
  assert.match(result.snippet || '', /Gemini 3\.7 Flash/);
});

test('probeGatewayModel reports FAIL for HTTP 401 and strips secrets from the payload', async () => {
  const result = await probeGatewayModel('ag/gemini-3-flash-agent', {
    name: 'Gemini 3 Flash Agent',
    apiKey: SECRET,
    fetchImpl: async () => jsonResponse(401, {
      error: { message: `Incorrect API key provided: ${SECRET}` },
    }),
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.httpStatus, 401);
  assert.match(result.error || '', /Auth failed/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  assert.doesNotMatch(JSON.stringify(result), /Bearer /);
});

test('probeGatewayModel maps Cloudflare 1010 HTML to a short fail snippet', async () => {
  const result = await probeGatewayModel('cc/claude-sonnet-5', {
    name: 'Claude Sonnet 5',
    apiKey: SECRET,
    fetchImpl: async () => htmlResponse(403, '<html><body>error code 1010 Cloudflare</body></html>'),
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.httpStatus, 403);
  assert.equal(result.error, 'Cloudflare blocked the probe (error 1010)');
  assert.equal(result.snippet, 'Cloudflare blocked the probe (error 1010)');
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
  assert.match(page, /status === 'stale'/);
  assert.match(page, /result\.snippet/);
  assert.match(page, /type="file"/);
  assert.match(page, /JSON\.stringify\(\{ messages: \[userMsg\], conversationId: activeConvoId \}\)/);

  assert.match(lib, /process\.env\.GORILLAWORKOUT_API_BASE/);
  assert.match(lib, /process\.env\.GORILLAWORKOUT_API_KEY/);
  assert.match(lib, /llmdupoin\.gorillaworkout\.id/);
  assert.match(lib, /User-Agent': GATEWAY_BROWSER_USER_AGENT/);
  assert.match(lib, /stream: false/);
  assert.match(lib, /max_tokens: MODEL_HEALTH_MAX_TOKENS/);
  assert.match(lib, /looksStaleOrDeprecated/);
  assert.doesNotMatch(lib, /console\.(log|info|debug).*apiKey|console\.(log|info|debug).*API_KEY/);
});
