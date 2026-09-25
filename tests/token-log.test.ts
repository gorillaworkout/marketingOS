import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  consumeChatCompletionSseLines,
  estimateTokensFromChars,
  EXTRA_TASK_TYPE_LABELS,
  gatewayMessagesText,
  mergeGatewayUsage,
  parseGatewayResponseUsage,
  parseGatewayUsage,
  parseImageGenerationUsage,
  parseReportedCost,
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

test('parses usage from JSON and SSE chat-completion bodies', () => {
  assert.deepEqual(parseGatewayResponseUsage(
    JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }),
    'application/json',
  ), { inputTokens: 7, outputTokens: 2 });
  assert.equal(parseGatewayResponseUsage('not-json', 'application/json'), null);

  const sse = [
    'data: {"choices":[{"delta":{"content":"Hi"}}]}',
    'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":9,"completion_tokens":1}}',
    'data: [DONE]',
  ].join('\n');
  assert.deepEqual(parseGatewayResponseUsage(sse, 'text/event-stream'), { inputTokens: 9, outputTokens: 1 });
  assert.deepEqual(mergeGatewayUsage({ inputTokens: 1, outputTokens: 2 }, { inputTokens: 3, outputTokens: 4 }), {
    inputTokens: 4, outputTokens: 6,
  });
  assert.deepEqual(mergeGatewayUsage(null, { inputTokens: 1, outputTokens: 0 }), { inputTokens: 1, outputTokens: 0 });
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

test('image generation usage prefers reported tokens/cost and otherwise logs zeros', () => {
  assert.deepEqual(parseImageGenerationUsage({
    data: [{ b64_json: 'AAAA' }],
    usage: { input_tokens: 40, output_tokens: 12 },
  }), { inputTokens: 40, outputTokens: 12, cost: 0 });
  assert.deepEqual(parseImageGenerationUsage({
    usage: { prompt_tokens: 8, completion_tokens: 2, cost: 0.012 },
  }), { inputTokens: 8, outputTokens: 2, cost: 0.012 });
  assert.deepEqual(parseImageGenerationUsage({
    usage: { total_tokens: 64 },
  }), { inputTokens: 64, outputTokens: 0, cost: 0 });
  assert.deepEqual(parseImageGenerationUsage({
    data: [{ b64_json: 'AAAA' }],
    cost: '1.5',
  }), { inputTokens: 0, outputTokens: 0, cost: 1.5 });
  assert.deepEqual(parseImageGenerationUsage({ data: [{ b64_json: 'AAAA' }] }), {
    inputTokens: 0, outputTokens: 0, cost: 0,
  });
  assert.equal(parseReportedCost({ usage: { total_cost: 0.2 } }), 0.2);
  const prompt = 'a'.repeat(10_000);
  const estimated = parseImageGenerationUsage({ data: [{ b64_json: 'x' }] });
  assert.equal(estimated.inputTokens, 0);
  assert.notEqual(estimated.inputTokens, estimateTokensFromChars(prompt));
});

test('labels ai-research and image-gen clearly and logs them from their routes', () => {
  assert.equal(taskTypeLabel('ai-research'), 'AI Research Assistant');
  assert.equal(taskTypeLabel('social-post'), 'Social Post');
  assert.equal(taskTypeLabel('image-gen'), 'Image Generation');
  assert.equal(taskTypeLabel('internal-docs'), 'FAQ & Guides');
  assert.equal(EXTRA_TASK_TYPE_LABELS['image-gen'], 'Image Generation');
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

  const image = readFileSync('src/app/api/generate-image/route.ts', 'utf8');
  assert.match(image, /logTokenUsage/);
  assert.match(image, /parseImageGenerationUsage/);
  assert.match(image, /taskType:\s*'image-gen'/);
  assert.match(image, /provider:\s*'gorillaworkout'/);
  assert.match(image, /accountSource:\s*'office'/);
  assert.doesNotMatch(image, /INSERT INTO token_logs/);
  assert.match(image, /export function explainImageFailure/);

  const openai = readFileSync('src/lib/openai.ts', 'utf8');
  assert.match(openai, /resolveTokenUsage/);
  assert.match(openai, /parseGatewayResponseUsage/);

  const tokensPage = readFileSync('src/app/dashboard/tokens/page.tsx', 'utf8');
  assert.match(tokensPage, /taskTypeLabel\(log\.task_type\)/);

  const analytics = readFileSync('src/app/dashboard/analytics/page.tsx', 'utf8');
  assert.match(analytics, /\/api\/admin\/usage\/by-feature/);
  assert.match(analytics, /Feature Usage/);
});
