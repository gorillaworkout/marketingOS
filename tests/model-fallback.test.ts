import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AllModelsFailedError,
  CONTINUATION_INSTRUCTION,
  GLOBAL_FALLBACK_ORDER,
  buildContinuationMessages,
  buildFallbackChain,
  formatFallbackLabel,
  runWithModelFallback,
  streamWithModelFallback,
  type FallbackEvent,
  type StreamAttemptResult,
} from '../src/lib/model-fallback';
import { AVAILABLE_MODELS } from '../src/lib/openai';
import { DEFAULT_FEATURE_ASSIGNMENTS } from '../src/lib/model-routing';

const read = (path: string) => readFileSync(path, 'utf8');

test('global fallback order is Sonnet 5.5, GPT-5.6 Sol, Gemini 3 Flash, Opus 5.5', () => {
  assert.deepEqual([...GLOBAL_FALLBACK_ORDER], [
    'cc/claude-sonnet-5-5',
    'cx/gpt-5.6-sol',
    'ag/gemini-3-flash',
    'cc/claude-opus-5-5',
  ]);
  const catalog = new Set(AVAILABLE_MODELS.map(model => model.id));
  for (const model of GLOBAL_FALLBACK_ORDER) assert.ok(catalog.has(model), model);
});

test('chain tries the chosen model first, then the global order without duplicates', () => {
  assert.deepEqual(buildFallbackChain('ag/gemini-3.1-pro-low'), [
    'ag/gemini-3.1-pro-low',
    'cc/claude-sonnet-5-5',
    'cx/gpt-5.6-sol',
    'ag/gemini-3-flash',
    'cc/claude-opus-5-5',
  ]);
  assert.deepEqual(buildFallbackChain('cx/gpt-5.6-sol'), [
    'cx/gpt-5.6-sol',
    'cc/claude-sonnet-5-5',
    'ag/gemini-3-flash',
    'cc/claude-opus-5-5',
  ]);
  assert.deepEqual(buildFallbackChain('cc/claude-sonnet-5-5'), [...GLOBAL_FALLBACK_ORDER]);
  assert.deepEqual(buildFallbackChain(undefined), [...GLOBAL_FALLBACK_ORDER]);
});

test('chain skips models that already failed', () => {
  assert.deepEqual(
    buildFallbackChain('cx/gpt-5.6-sol', ['cx/gpt-5.6-sol', 'cc/claude-sonnet-5-5']),
    ['ag/gemini-3-flash', 'cc/claude-opus-5-5'],
  );
});

test('non-streaming fallback retries transparently and logs each switch', async () => {
  const tried: string[] = [];
  const logged: FallbackEvent[] = [];
  const outcome = await runWithModelFallback({
    chosenModel: 'ag/gemini-3.1-pro-low',
    attempt: async model => {
      tried.push(model);
      if (model === 'ag/gemini-3.1-pro-low') throw new Error('API error 503: upstream 404');
      if (model === 'cc/claude-sonnet-5-5') throw new Error('The operation was aborted due to timeout');
      return `answer from ${model}`;
    },
    onFallback: event => { logged.push(event); },
    now: () => new Date('2026-10-14T04:00:00Z'),
  });
  assert.deepEqual(tried, ['ag/gemini-3.1-pro-low', 'cc/claude-sonnet-5-5', 'cx/gpt-5.6-sol']);
  assert.equal(outcome.result, 'answer from cx/gpt-5.6-sol');
  assert.equal(outcome.model, 'cx/gpt-5.6-sol');
  assert.equal(logged.length, 2);
  assert.deepEqual(logged[0], {
    failedModel: 'ag/gemini-3.1-pro-low',
    fallbackModel: 'cc/claude-sonnet-5-5',
    error: 'API error 503: upstream 404',
    afterPartial: false,
    at: '2026-10-14T04:00:00.000Z',
  });
  assert.equal(outcome.label, 'Answered by GPT-5.6 Sol (Gemini 3.1 Pro Low and Claude Sonnet 5.5 unavailable)');
});

test('no label when the chosen model answers', async () => {
  const outcome = await runWithModelFallback({ chosenModel: 'cx/gpt-5.6-sol', attempt: async () => 'ok' });
  assert.equal(outcome.label, null);
  assert.deepEqual(outcome.events, []);
});

test('the error surfaces only when every model fails', async () => {
  const tried: string[] = [];
  await assert.rejects(
    runWithModelFallback({
      chosenModel: 'cx/gpt-5.6-sol',
      attempt: async model => { tried.push(model); throw new Error(`down: ${model}`); },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AllModelsFailedError);
      assert.equal(error.attempts.length, 4);
      assert.match(error.message, /All models failed/);
      return true;
    },
  );
  assert.deepEqual(tried, buildFallbackChain('cx/gpt-5.6-sol'));
});

test('a user abort stops the fallback loop', async () => {
  const tried: string[] = [];
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(runWithModelFallback({
    chosenModel: 'cx/gpt-5.6-sol',
    attempt: async model => { tried.push(model); throw abort; },
    shouldAbort: error => error === abort,
  }));
  assert.deepEqual(tried, ['cx/gpt-5.6-sol']);
});

test('continuation messages carry the partial text and a continue-without-repeating instruction', () => {
  const original = [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Explain gold prices.' },
  ];
  const messages = buildContinuationMessages(original, 'Gold rose because the dol');
  assert.equal(messages.length, 4);
  assert.deepEqual(messages.slice(0, 2), original);
  assert.deepEqual(messages[2], { role: 'assistant', content: 'Gold rose because the dol' });
  assert.equal(messages[3].role, 'user');
  const instruction = (messages[3] as { content: string }).content;
  assert.ok(instruction.startsWith(CONTINUATION_INSTRUCTION));
  assert.match(instruction, /exactly where that text stopped/);
  assert.match(instruction, /Do not repeat/);
  assert.match(instruction, /Gold rose because the dol/);
});

test('mid-stream failure: next model continues from the partial text on the same stream', async () => {
  const streamed: string[] = [];
  const calls: Array<{ model: string; messages: unknown[] }> = [];
  const switches: FallbackEvent[] = [];
  const original = [{ role: 'user', content: 'Write about XAUUSD.' }];
  const outcome = await streamWithModelFallback<{ role: string; content: string }, { n: number }>({
    chosenModel: 'cc/claude-sonnet-5-5',
    messages: original,
    attempt: async (model, messages): Promise<StreamAttemptResult<{ n: number }>> => {
      calls.push({ model, messages });
      if (model === 'cc/claude-sonnet-5-5') {
        streamed.push('Gold is ');
        return { ok: false, error: 'socket hang up', content: 'Gold is ', usage: { n: 1 } };
      }
      streamed.push('trading higher.');
      return { ok: true, content: 'trading higher.', usage: { n: 2 } };
    },
    onSwitch: event => switches.push(event),
    mergeUsage: (a, b) => (a || b ? { n: (a?.n || 0) + (b?.n || 0) } : null),
  });
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.equal(outcome.content, 'Gold is trading higher.');
  assert.equal(streamed.join(''), 'Gold is trading higher.');
  assert.deepEqual(outcome.usage, { n: 3 });
  assert.equal(outcome.finalModel, 'cx/gpt-5.6-sol');
  assert.deepEqual(calls.map(call => call.model), ['cc/claude-sonnet-5-5', 'cx/gpt-5.6-sol']);
  assert.deepEqual(calls[0].messages, original);
  assert.deepEqual(calls[1].messages, buildContinuationMessages(original, 'Gold is '));
  assert.equal(switches.length, 1);
  assert.equal(switches[0].afterPartial, true);
  assert.equal(outcome.label, 'Continued by GPT-5.6 Sol after Claude Sonnet 5.5 failed');
});

test('failure before any text retries with the original messages', async () => {
  const calls: Array<{ model: string; messages: unknown[] }> = [];
  const original = [{ role: 'user', content: 'Hi' }];
  const outcome = await streamWithModelFallback({
    chosenModel: 'cx/gpt-5.6-sol',
    messages: original,
    attempt: async (model, messages) => {
      calls.push({ model, messages });
      if (model === 'cx/gpt-5.6-sol') return { ok: false, error: 'API error 502: Bad Gateway', content: '' };
      return { ok: true, content: 'Hello!' };
    },
  });
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.deepEqual(calls[1], { model: 'cc/claude-sonnet-5-5', messages: original });
  assert.equal(outcome.label, 'Answered by Claude Sonnet 5.5 (GPT-5.6 Sol unavailable)');
});

test('mid-stream continuation accumulates across several failing models', async () => {
  const calls: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
  const outcome = await streamWithModelFallback({
    chosenModel: 'cc/claude-sonnet-5-5',
    messages: [{ role: 'user', content: 'Go' }],
    attempt: async (model, messages) => {
      calls.push({ model, messages: messages as Array<{ role: string; content: string }> });
      if (model === 'cc/claude-sonnet-5-5') return { ok: false, error: 'reset', content: 'One ' };
      if (model === 'cx/gpt-5.6-sol') return { ok: false, error: 'stall', content: 'two ' };
      return { ok: true, content: 'three.' };
    },
  });
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.equal(outcome.content, 'One two three.');
  assert.equal(calls[2].model, 'ag/gemini-3-flash');
  assert.equal(calls[2].messages[1].content, 'One two ');
});

test('streaming abort is final and every-model failure returns one error', async () => {
  const aborted = await streamWithModelFallback({
    chosenModel: 'cx/gpt-5.6-sol',
    messages: [],
    attempt: async () => ({ ok: false, aborted: true }),
  });
  assert.deepEqual(aborted, { ok: false, aborted: true, content: '' });

  const failed = await streamWithModelFallback({
    chosenModel: 'cx/gpt-5.6-sol',
    messages: [],
    attempt: async model => ({ ok: false, error: `down ${model}`, content: '' }),
  });
  assert.equal(failed.ok, false);
  if (failed.ok || failed.aborted) return;
  assert.ok(failed.error instanceof AllModelsFailedError);
  assert.equal(failed.error.attempts.length, 4);
});

test('labels are English and name the final and failed models', () => {
  const at = '2026-10-14T00:00:00.000Z';
  assert.equal(formatFallbackLabel('cx/gpt-5.6-sol', []), null);
  assert.equal(
    formatFallbackLabel('cx/gpt-5.6-sol', [{ failedModel: 'cc/claude-sonnet-5-5', fallbackModel: 'cx/gpt-5.6-sol', error: 'x', afterPartial: true, at }]),
    'Continued by GPT-5.6 Sol after Claude Sonnet 5.5 failed',
  );
});

test('every gateway path is wired through the fallback', () => {
  const openai = read('src/lib/openai.ts');
  assert.match(openai, /runWithModelFallback\(/);
  assert.match(openai, /AbortSignal\.timeout\(LLM_REQUEST_TIMEOUT_MS\)/);
  const chat = read('src/app/api/ai-research/chat/route.ts');
  assert.match(chat, /streamWithModelFallback</);
  assert.match(chat, /type: 'model-fallback'/);
  assert.match(chat, /fallbackLabel: streamed\.fallbackLabel/);
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(page, /ai-research-fallback-label/);
});

test('migration 031 creates the admin fallback log idempotently', () => {
  const sql = read('db/migrations/031_model_fallback_events.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS model_fallback_events/);
  for (const column of ['feature', 'failed_model', 'fallback_model', 'error', 'created_at']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(read('src/app/api/admin/model-fallbacks/route.ts'), /requireAdmin/);
});

test('Event Plan hardcoded default is Claude Sonnet 5.5', () => {
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['event-plan'].defaultModel, 'cc/claude-sonnet-5-5');
});
