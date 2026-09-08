import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGatewayCompletion } from '../src/lib/gateway-response';

test('strips a leading empty reasoning tag before the JSON payload (non-streaming)', () => {
  const body = JSON.stringify({ choices: [{ message: { content: '<think></think>{"items":[]}' } }] });
  assert.equal(parseGatewayCompletion(body, 'application/json'), '{"items":[]}');
});

test('strips a leading reasoning tag WITH content before the JSON payload', () => {
  const body = JSON.stringify({ choices: [{ message: { content: '<think>weighing candidates...</think>{"items":[{"a":1}]}' } }] });
  assert.equal(parseGatewayCompletion(body, 'application/json'), '{"items":[{"a":1}]}');
});

test('does not touch content that has no reasoning tag', () => {
  const body = JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] });
  assert.equal(parseGatewayCompletion(body, 'application/json'), '{"items":[]}');
});

test('does not strip a literal "<think>" that appears INSIDE a JSON string value', () => {
  // A field whose value happens to mention the tag as text must survive untouched.
  const body = JSON.stringify({ choices: [{ message: { content: '{"note":"<think>not a wrapper</think>","items":[]}' } }] });
  assert.equal(parseGatewayCompletion(body, 'application/json'), '{"note":"<think>not a wrapper</think>","items":[]}');
});

test('strips a leading reasoning tag across concatenated SSE frames', () => {
  const body = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: '<think>' } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'brief reasoning' } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { content: '</think>{"items"' } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { content: ':[]}' } }] }),
    'data: [DONE]',
  ].join('\n');
  assert.equal(parseGatewayCompletion(body, 'text/event-stream'), '{"items":[]}');
});

test('throws instead of silently returning empty when only an unterminated reasoning tag was sent', () => {
  const body = JSON.stringify({ choices: [{ message: { content: '<think>never closed' } }] });
  assert.throws(() => parseGatewayCompletion(body, 'application/json'), /did not contain completion content/i);
});
