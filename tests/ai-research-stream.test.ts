import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAiResearchChatBody } from '../src/lib/ai-research-request';
import { buildResearchSsePayload } from '../src/lib/ai-research-inspector';
import {
  AI_RESEARCH_CONNECTION_DROPPED_MESSAGE,
  AI_RESEARCH_CONNECTION_RETRYING_MESSAGE,
  AI_RESEARCH_SSE_KEEPALIVE_MS,
  aiResearchClientErrorMessage,
  appendResearchTurnMessages,
  isAiResearchConnectionError,
  shouldAutoRetryAiResearchStream,
  shouldSkipWebGatherForTurn,
  sseKeepaliveComment,
  startSseKeepalive,
} from '../src/lib/ai-research-stream';

const read = (path: string) => readFileSync(path, 'utf8');

test('conversational skills skip web gather unless pins, context URLs, or compare are present', () => {
  for (const skill of ['interview', 'goal', 'continue', 'outline', 'eli5'] as const) {
    assert.equal(shouldSkipWebGatherForTurn({
      skill,
      query: 'Help me shape the Q4 retail campaign for new gold traders.',
    }), true, skill);
  }

  assert.equal(shouldSkipWebGatherForTurn({
    skill: 'interview',
    query: 'Continue.',
  }), true);
  assert.equal(shouldSkipWebGatherForTurn({
    skill: 'interview',
    query: 'Use the pinned notes and ask the next question.',
    pinnedSourceUrls: ['https://example.com/brief'],
  }), false);
  assert.equal(shouldSkipWebGatherForTurn({
    skill: 'goal',
    query: 'Turn https://example.com/emas into a goal.',
  }), false);
  assert.equal(shouldSkipWebGatherForTurn({
    skill: 'outline',
    query: 'Outline this, but ignore http://127.0.0.1/admin.',
  }), true);
  assert.equal(shouldSkipWebGatherForTurn({
    skill: 'interview',
    query: 'Ask me one question about the two offers.',
    compare: true,
  }), false);

  for (const skill of ['grill-me', 'compare', 'brief', 'critique', 'sources', 'persona', 'decide'] as const) {
    assert.equal(shouldSkipWebGatherForTurn({
      skill,
      query: 'What should we publish about Dupoin gold spreads this week?',
    }), false, skill);
  }
  assert.equal(shouldSkipWebGatherForTurn({
    query: 'What is the Dupoin gold spread this week?',
  }), false);
});

test('skipped conversational gather is reported as skipped, not an empty search', () => {
  const payload = buildResearchSsePayload({
    query: 'Help me shape the Q4 retail campaign for new gold traders.',
    research: null,
    failed: false,
    skipped: true,
  });
  assert.equal(payload.grounding, 'skipped');
  assert.equal(payload.sourceCount, 0);
});

test('SSE keepalive is a comment ping on a 10 second interval until stopped', () => {
  assert.equal(sseKeepaliveComment(), ': ping\n\n');
  assert.equal(AI_RESEARCH_SSE_KEEPALIVE_MS, 10_000);
  const frames: string[] = [];
  let tick: (() => void) | undefined;
  let delay = 0;
  let cancelled = false;
  const stop = startSseKeepalive(frame => frames.push(frame), {
    schedule: (next, intervalMs) => {
      tick = next;
      delay = intervalMs;
      return () => { cancelled = true; };
    },
  });
  assert.equal(delay, 10_000);
  assert.ok(tick);
  tick();
  tick();
  assert.deepEqual(frames, [': ping\n\n', ': ping\n\n']);
  stop();
  assert.equal(cancelled, true);
  tick();
  assert.deepEqual(frames, [': ping\n\n', ': ping\n\n']);
});

test('connection drops get a retry message and one automatic retry', () => {
  const dropped = new TypeError('Failed to fetch');
  assert.equal(isAiResearchConnectionError(dropped), true);
  assert.equal(isAiResearchConnectionError(new Error('ERR_NETWORK_CHANGED')), true);
  assert.equal(isAiResearchConnectionError(new Error('Load failed')), true);
  const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  assert.equal(isAiResearchConnectionError(abort), false);
  assert.equal(isAiResearchConnectionError(new Error('Unknown research skill.')), false);
  assert.equal(aiResearchClientErrorMessage(dropped), AI_RESEARCH_CONNECTION_DROPPED_MESSAGE);
  assert.match(AI_RESEARCH_CONNECTION_DROPPED_MESSAGE, /connection dropped/i);
  assert.match(AI_RESEARCH_CONNECTION_DROPPED_MESSAGE, /retry/i);
  assert.match(AI_RESEARCH_CONNECTION_RETRYING_MESSAGE, /retry/i);
  assert.equal(aiResearchClientErrorMessage(new Error('Server error (400)')), 'Server error (400)');

  assert.equal(shouldAutoRetryAiResearchStream({
    error: dropped,
    alreadyRetried: false,
    receivedContent: false,
  }), true);
  assert.equal(shouldAutoRetryAiResearchStream({
    error: dropped,
    alreadyRetried: true,
    receivedContent: false,
  }), false);
  assert.equal(shouldAutoRetryAiResearchStream({
    error: dropped,
    alreadyRetried: false,
    receivedContent: true,
  }), false);
  assert.equal(shouldAutoRetryAiResearchStream({
    error: abort,
    alreadyRetried: false,
    receivedContent: false,
  }), false);
  assert.equal(shouldAutoRetryAiResearchStream({
    error: new Error('API error 500: no'),
    alreadyRetried: false,
    receivedContent: false,
  }), false);
});

test('a retry does not append the same user turn twice', () => {
  const stored = [
    { role: 'user' as const, content: 'Interview me about the launch.' },
    { role: 'assistant' as const, content: 'Known so far\n- Launch' },
    { role: 'user' as const, content: 'Retail beginners.' },
  ];
  const incoming = [{ role: 'user' as const, content: 'Retail beginners.' }];
  assert.deepEqual(appendResearchTurnMessages(stored, incoming, true), stored);
  assert.deepEqual(appendResearchTurnMessages(stored, incoming, false), [...stored, ...incoming]);
  assert.deepEqual(
    appendResearchTurnMessages(stored, [{ role: 'user', content: 'Add a deadline.' }], true),
    [...stored, { role: 'user', content: 'Add a deadline.' }],
  );
  const parsed = parseAiResearchChatBody({
    retry: true,
    skill: 'interview',
    messages: [{ role: 'user', content: 'Retail beginners.' }],
  });
  assert.equal(parsed.retry, true);
  assert.equal(parseAiResearchChatBody({
    messages: [{ role: 'user', content: 'Retail beginners.' }],
  }).retry, false);
});

test('chat route keeps SSE alive through gather and skips conversational web gather', () => {
  const route = read('src/app/api/ai-research/chat/route.ts');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(route, /startSseKeepalive/);
  assert.match(route, /shouldSkipWebGatherForTurn/);
  assert.match(route, /appendResearchTurnMessages/);
  assert.equal(route.split('history: modelHistory').length - 1, 2);
  assert.match(route, /no-transform/);
  assert.match(route, /if \(skipWebGather\) return \{ research: null, failed: false \}/);
  assert.match(route, /if \(mode === 'deep' && !compare\)/);
  assert.match(route, /if \(skipWebGather\) \{\s*emit\(buildDeepStatusEvent\(\{ phase: 'synthesize', skippedSearch: true \}\)\)/);
  assert.match(page, /shouldAutoRetryAiResearchStream/);
  assert.match(page, /aiResearchClientErrorMessage/);
  assert.match(page, /AI_RESEARCH_CONNECTION_RETRYING_MESSAGE/);
  assert.match(page, /retry: attempt > 1/);
});
