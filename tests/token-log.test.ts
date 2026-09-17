import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  consumeChatCompletionSseLines,
  estimateTokensFromChars,
  gatewayMessagesText,
  parseGatewayUsage,
  resolveTokenUsage,
  taskTypeLabel,
} from '../src/lib/token-usage';

test('estimates tokens the same way generateContent does (~chars/4)', () => {
  assert.equal(estimateTokensFromChars('abcd'), 1);
  assert.equal(estimateTokensFromChars('abcde'), 2);
  assert.equal(estimateTokensFromChars(''), 0);
  const prompt = 'hello world';
  assert.equal(estimateTokensFromChars(prompt), Math.ceil(prompt.length / 4));
});

test('prefers gateway-reported usage and falls back to a char estimate', () => {
  assert.deepEqual(parseGatewayUsage({
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  }), { inputTokens: 12, outputTokens: 8 });
  assert.deepEqual(parseGatewayUsage({
    usage: { input_tokens: '3', output_tokens: '4' },
  }), { inputTokens: 3, outputTokens: 4 });
  assert.equal(parseGatewayUsage({ choices: [] }), null);
  assert.equal(parseGatewayUsage({ usage: { total_tokens: 10 } }), null);

  assert.deepEqual(resolveTokenUsage({
    reported: { inputTokens: 40, outputTokens: 10 },
    inputText: 'ignored',
    outputText: 'also ignored',
  }), { inputTokens: 40, outputTokens: 10 });

  const inputText = 'abcd';
  const outputText = 'abcdefgh';
  assert.deepEqual(resolveTokenUsage({
    reported: null,
    inputText,
    outputText,
  }), {
    inputTokens: estimateTokensFromChars(inputText),
    outputTokens: estimateTokensFromChars(outputText),
  });
  assert.deepEqual(resolveTokenUsage({
    reported: { inputTokens: 0, outputTokens: 0 },
    inputText,
    outputText,
  }), {
    inputTokens: estimateTokensFromChars(inputText),
    outputTokens: estimateTokensFromChars(outputText),
  });
});

test('reads usage from a final SSE chunk and ignores image payloads in estimates', () => {
  const parsed = consumeChatCompletionSseLines([
    'data: {"choices":[{"delta":{"content":"Hello"}}]}',
    'data: {"choices":[{"delta":{"content":" world"}}]}',
    'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":20,"completion_tokens":5}}',
    'data: [DONE]',
  ]);
  assert.equal(parsed.content, 'Hello world');
  assert.deepEqual(parsed.usage, { inputTokens: 20, outputTokens: 5 });
  assert.equal(parsed.reachedDone, true);

  const text = gatewayMessagesText([
    { role: 'system', content: 'sys' },
    { role: 'user', content: [
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ] },
  ]);
  assert.equal(text, 'syslook');
  assert.doesNotMatch(text, /AAAA/);
});

test('labels ai-research clearly and logs it from the streaming chat route', () => {
  assert.equal(taskTypeLabel('ai-research'), 'AI Research Assistant');
  assert.equal(taskTypeLabel('social-post'), 'Social Post');
  assert.equal(taskTypeLabel(''), 'Legacy');
  assert.equal(taskTypeLabel(null), 'Legacy');

  const chat = readFileSync('src/app/api/ai-research/chat/route.ts', 'utf8');
  assert.match(chat, /logTokenUsage/);
  assert.match(chat, /taskType:\s*'ai-research'/);
  assert.match(chat, /stream_options:\s*\{\s*include_usage:\s*true\s*\}/);
  assert.match(chat, /resolveTokenUsage/);
  assert.match(chat, /taskId:\s*null/);
  assert.match(chat, /provider:\s*'gorillaworkout'/);
  assert.match(chat, /accountSource:\s*'office'/);
  assert.doesNotMatch(chat, /INSERT INTO token_logs/);

  const tokensPage = readFileSync('src/app/dashboard/tokens/page.tsx', 'utf8');
  assert.match(tokensPage, /taskTypeLabel\(log\.task_type\)/);

  const analytics = readFileSync('src/app/dashboard/analytics/page.tsx', 'utf8');
  assert.match(analytics, /\/api\/admin\/usage\/by-feature/);
  assert.match(analytics, /Feature Usage/);
});
