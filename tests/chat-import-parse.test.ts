import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_CHAT_CHAR_LIMIT,
  IMPORT_FILE_BYTE_LIMIT,
  MultiChatImportError,
  canonicalTranscript,
  chatContentHash,
  decodeUtf8,
  importFileError,
  importPasteError,
  parseImportedChat,
} from '../src/lib/chat-import-parse';

test('Codex mapping follows parent to children and drops system and tool turns', () => {
  const raw = JSON.stringify({
    title: 'Campaign voice',
    create_time: 1,
    mapping: {
      a: { parent: null, children: ['b'], message: { author: { role: 'system' }, content: { parts: ['sys'] } } },
      b: { parent: 'a', children: ['c'], message: { author: { role: 'user' }, content: { parts: ['Hello', 'there'] } } },
      c: { parent: 'b', children: ['d'], message: { author: { role: 'tool' }, content: { parts: ['tool out'] } } },
      d: { parent: 'c', children: [], message: { author: { role: 'assistant' }, content: 'Done' } },
    },
  });
  const parsed = parseImportedChat('codex', raw);
  assert.deepEqual(parsed.messages, [
    { role: 'user', content: 'Hello\nthere' },
    { role: 'assistant', content: 'Done' },
  ]);
  assert.equal(parsed.title, 'Campaign voice');
  assert.equal(parsed.parser, 'codex');
  assert.equal(parsed.parserFallback, false);
  assert.equal(parsed.transcript, canonicalTranscript(parsed.messages));
});

test('a one-element Codex or Claude array imports that conversation', () => {
  const codex = parseImportedChat('codex', JSON.stringify([
    { title: 'Only', messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Yo' }] },
  ]));
  assert.equal(codex.messages.length, 2);
  assert.equal(codex.title, 'Only');
  assert.equal(codex.parser, 'codex');
  const claude = parseImportedChat('claude', JSON.stringify({
    conversations: [{ name: 'Brand', chat_messages: [{ sender: 'human', text: 'Q' }] }],
  }));
  assert.equal(claude.title, 'Brand');
  assert.equal(claude.parser, 'claude');
  assert.deepEqual(claude.messages, [{ role: 'user', content: 'Q' }]);
});

test('two conversations are a hard error and are not hashed as one blob', () => {
  const raw = JSON.stringify([
    { title: 'A', messages: [{ role: 'user', content: 'one' }] },
    { title: 'B', messages: [{ role: 'user', content: 'two' }] },
  ]);
  assert.throws(() => parseImportedChat('codex', raw), (error: unknown) => {
    assert.ok(error instanceof MultiChatImportError);
    assert.equal((error as Error).message, 'Import one chat at a time.');
    return true;
  });
  assert.throws(() => parseImportedChat('claude', JSON.stringify({ conversations: [{}, {}] })), MultiChatImportError);
  assert.equal(raw.includes('one') && raw.includes('two'), true);
});

test('Claude human and assistant map, and text blocks join', () => {
  const parsed = parseImportedChat('claude', JSON.stringify({
    title: 'Fallback title',
    name: 'Brand',
    chat_messages: [
      { sender: 'human', content: [{ type: 'text', text: 'Where?' }, { type: 'tool_use', text: 'no' }, { type: 'text', text: 'Which doc?' }] },
      { sender: 'assistant', text: 'In Docs.' },
      { sender: 'system', text: 'ignore' },
    ],
  }));
  assert.equal(parsed.title, 'Brand');
  assert.deepEqual(parsed.messages, [
    { role: 'user', content: 'Where?\nWhich doc?' },
    { role: 'assistant', content: 'In Docs.' },
  ]);
});

test('plain text splits on speaker labels and otherwise stays one user message', () => {
  const split = parseImportedChat('text', 'You: hi\nstill you\nChatGPT: hello\nCodex: more');
  assert.equal(split.parserFallback, false);
  assert.deepEqual(split.messages, [
    { role: 'user', content: 'hi\nstill you' },
    { role: 'assistant', content: 'hello' },
    { role: 'assistant', content: 'more' },
  ]);
  const prose = parseImportedChat('text', 'Just prose\nwith lines');
  assert.deepEqual(prose.messages, [{ role: 'user', content: 'Just prose\nwith lines' }]);
  const jsonAsText = parseImportedChat('text', '{"messages":[{"role":"user","content":"Hi"}]}');
  assert.equal(jsonAsText.parser, 'text');
  assert.equal(jsonAsText.messages.length, 1);
  assert.match(jsonAsText.messages[0].content, /messages/);
});

test('invalid Codex JSON falls back to plain text and still has a transcript', () => {
  const parsed = parseImportedChat('codex', 'You: hi\nAssistant: there');
  assert.equal(parsed.parser, 'text');
  assert.equal(parsed.parserFallback, true);
  assert.equal(parsed.messages.length, 2);
  assert.ok(parsed.transcript.includes('user\nhi'));
  assert.ok(parsed.contentHash.length === 64);
});

test('the hash ignores title and timestamps, keeps case, and ignores line-ending noise', () => {
  const left = parseImportedChat('codex', JSON.stringify({
    title: 'A', created_at: 1, messages: [{ role: 'user', content: 'Same' }],
  }));
  const right = parseImportedChat('codex', JSON.stringify({
    title: 'B', created_at: 99, messages: [{ role: 'user', content: 'Same' }],
  }));
  const lower = parseImportedChat('codex', JSON.stringify({
    title: 'A', messages: [{ role: 'user', content: 'same' }],
  }));
  assert.equal(left.contentHash, right.contentHash);
  assert.notEqual(left.contentHash, lower.contentHash);
  assert.equal(
    chatContentHash([{ role: 'user', content: 'Hello \r\nWorld  \n' }]),
    chatContentHash([{ role: 'user', content: 'Hello \nWorld' }]),
  );
});

test('several null-parent Codex nodes walk in object key order', () => {
  const parsed = parseImportedChat('codex', JSON.stringify({
    mapping: {
      z: { parent: null, children: [], message: { role: 'user', content: 'second' } },
      a: { parent: null, children: [], message: { role: 'assistant', content: 'first' } },
    },
  }));
  assert.deepEqual(parsed.messages.map(message => message.content), ['second', 'first']);
});

test('title falls back to the first user message, then Imported chat', () => {
  const fromUser = parseImportedChat('text', `User: ${'x'.repeat(100)}`);
  assert.equal(fromUser.title, 'x'.repeat(80));
  const emptyLabel = parseImportedChat('codex', JSON.stringify({
    messages: [{ role: 'assistant', content: 'Only the assistant spoke' }],
  }));
  assert.equal(emptyLabel.title, 'Imported chat');
});

test('paste and file limits fail before any caller would insert', () => {
  assert.deepEqual(importPasteError(''), { status: 400, error: 'Add a chat to import.' });
  assert.deepEqual(importPasteError('   '), { status: 400, error: 'Add a chat to import.' });
  assert.equal(importPasteError('hello'), null);
  assert.deepEqual(importPasteError('x'.repeat(IMPORT_CHAT_CHAR_LIMIT + 1)), {
    status: 413,
    error: 'Paste is limited to 200,000 characters.',
  });
  assert.deepEqual(importFileError({ filename: 'notes.PDF', bytes: 10, text: 'hi' }), {
    status: 400,
    error: 'Use a .md, .txt, or .json file.',
  });
  assert.equal(importFileError({ filename: 'chat.JSON', bytes: 4, text: 'hi' }), null);
  assert.deepEqual(importFileError({ filename: 'chat.txt', bytes: IMPORT_FILE_BYTE_LIMIT + 1, text: 'hi' }), {
    status: 413,
    error: 'File is limited to 5 MB.',
  });
  assert.deepEqual(importFileError({ filename: 'chat.md', bytes: 4, text: null }), {
    status: 400,
    error: 'That file is not valid UTF-8 text.',
  });
  assert.deepEqual(importFileError({ filename: 'chat.txt', bytes: 12, text: 'x'.repeat(IMPORT_CHAT_CHAR_LIMIT + 1) }), {
    status: 413,
    error: 'Chat is limited to 200,000 characters.',
  });
  assert.equal(decodeUtf8(new Uint8Array([0xff, 0xfe])), null);
  assert.equal(decodeUtf8(new TextEncoder().encode('You: hi')), 'You: hi');
});
