import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGatewayCompletion } from '../src/lib/gateway-response';

test('parses a standard JSON chat completion', () => {
  const body = JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] });
  assert.equal(parseGatewayCompletion(body, 'application/json'), '{"ok":true}');
});

test('assembles OpenAI-compatible SSE delta frames', () => {
  const body = [
    'event: message',
    'data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"true}"}}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  assert.equal(parseGatewayCompletion(body, 'text/event-stream'), '{"ok":true}');
});

test('reads a full message content from an SSE frame', () => {
  const body = 'data: {"choices":[{"message":{"content":"finished"}}]}\n\ndata: [DONE]\n\n';
  assert.equal(parseGatewayCompletion(body, 'text/event-stream; charset=utf-8'), 'finished');
});

test('rejects an SSE response without completion content', () => {
  assert.throws(
    () => parseGatewayCompletion('data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n\n', 'text/event-stream'),
    /completion content/i,
  );
});
