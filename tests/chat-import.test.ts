import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { memoryContentHash, normalizeQuestion } from '../src/lib/ai-research-memory';
import { approveChatImport, cancelChatImport, createChatImport, listChatImports, readChatImport, retryChatImport, type ChatImportRow } from '../src/lib/chat-import';
import { createMemoryImportDeps } from './chat-import-deps';

const codex = JSON.stringify({
  title: 'Campaign voice',
  created_at: 5,
  messages: [
    { role: 'user', content: 'How should Dupoin campaigns sound?' },
    { role: 'assistant', content: 'Use a direct voice.' },
  ],
});

test('create saves the chat before extract and hides the transcript', async () => {
  const harness = createMemoryImportDeps();
  harness.deps.complete = async () => '{"facts":[{"kind":"style","content":"Prefers a direct voice.","confidence":0.9}],"qa":[]}';
  const result = await createChatImport('user-a', 'codex', codex, harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, 200);
  const body = result.body.import as { status: string; transcript?: string; parserFallback: boolean; title: string; draft: { facts: Array<{ content: string }> }; knowledgeEntryId: string };
  assert.equal(body.status, 'review');
  assert.equal(body.title, 'Campaign voice');
  assert.equal(body.parserFallback, false);
  assert.equal(body.transcript, undefined);
  assert.equal(body.draft.facts[0].content, 'Prefers a direct voice.');
  assert.equal(harness.rows.length, 1);
  assert.equal(harness.rows[0].transcript.includes('Dupoin'), true);
  assert.equal(harness.rows[0].knowledgeEntryId, body.knowledgeEntryId);
  assert.deepEqual(harness.logs.map(entry => entry.status), ['extract_failed', 'review']);
  assert.equal(JSON.stringify(harness.logs).includes('Dupoin'), false);
});

test('extract failure still returns the saved chat', async () => {
  const harness = createMemoryImportDeps();
  harness.deps.complete = async () => { throw new Error('boom'); };
  const result = await createChatImport('user-a', 'text', 'Just a note for later.', harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const body = result.body.import as { status: string; error: string; draft: { facts: unknown[] } };
  assert.equal(body.status, 'extract_failed');
  assert.equal(body.error, 'Fact extraction failed.');
  assert.deepEqual(body.draft.facts, []);
  assert.equal(harness.rows.length, 1);
});

test('the same hash is a duplicate for one user and a new import for another, including a concurrent insert', async () => {
  const harness = createMemoryImportDeps();
  harness.deps.complete = async () => '{"facts":[],"qa":[]}';
  const first = await createChatImport('user-a', 'text', 'Same transcript', harness.deps);
  const second = await createChatImport('user-a', 'text', 'Same transcript', harness.deps);
  const other = await createChatImport('user-b', 'text', 'Same transcript', harness.deps);
  assert.equal(second.ok, false);
  if (second.ok || first.ok === false) return;
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'This chat is already imported.');
  assert.equal(second.body.existingImportId, (first.body.import as { id: string }).id);
  assert.equal(other.ok, true);
  assert.equal(harness.rows.length, 2);

  const race = createMemoryImportDeps();
  const existing = harness.rows[0];
  race.rows.push({ ...existing, userId: 'user-c' });
  let lookups = 0;
  race.deps.findByHash = async (userId, contentHash) => {
    lookups += 1;
    if (lookups === 1) return null;
    return race.rows.find(row => row.userId === userId && row.contentHash === contentHash) || null;
  };
  race.deps.insertSavedChat = async () => 'duplicate';
  const raced = await createChatImport('user-c', 'text', 'Same transcript', race.deps);
  assert.equal(raced.ok, false);
  if (!raced.ok) assert.equal(raced.body.existingImportId, existing.id);
});

test('multi-chat JSON writes nothing', async () => {
  const harness = createMemoryImportDeps();
  const result = await createChatImport('user-a', 'codex', JSON.stringify([{ title: 'A' }, { title: 'B' }]), harness.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.body.error, 'Import one chat at a time.');
  assert.equal(harness.rows.length, 0);
});

test('list and read are owner-only and only the detail includes the transcript', async () => {
  const harness = createMemoryImportDeps();
  harness.deps.complete = async () => '{"facts":[],"qa":[]}';
  const created = await createChatImport('user-a', 'text', 'Owner note', harness.deps);
  if (!created.ok) return;
  const id = (created.body.import as { id: string }).id;
  const list = await listChatImports('user-a', harness.deps);
  assert.equal(list.length, 1);
  assert.equal('transcript' in list[0], false);
  assert.equal('draft' in list[0], false);
  const missing = await readChatImport('user-b', id, harness.deps);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.body.error, 'Import was not found.');
  const detail = await readChatImport('user-a', id, harness.deps);
  assert.equal(detail.ok, true);
  if (detail.ok) assert.equal((detail.body.import as { transcript: string }).transcript.includes('Owner note'), true);
});

test('route SQL binds user_id and limits run before insert', async () => {
  const lib = await readFile('src/lib/chat-import.ts', 'utf8');
  const route = await readFile('src/app/api/ai-research/imports/route.ts', 'utf8');
  const detail = await readFile('src/app/api/ai-research/imports/[id]/route.ts', 'utf8');
  for (const name of ['LIST_CHAT_IMPORTS_SQL', 'READ_CHAT_IMPORT_SQL', 'INSERT_CHAT_IMPORT_SQL', 'SAVE_DRAFT_SQL', 'SAVE_EXTRACT_FAILURE_SQL']) {
    assert.match(lib, new RegExp(`${name}[\\s\\S]{0,240}user_id = \\?`));
  }
  assert.match(route, /requireFeature\(request, 'ai-research'\)/);
  assert.match(detail, /requireFeature\(request, 'ai-research'\)/);
  assert.match(route, /Choose a source\./);
  assert.match(route, /Send the chat as JSON or as a file\./);
  const paste = route.indexOf('importPasteError');
  const parse = route.indexOf('parseImportedChat');
  const insert = route.indexOf('createChatImport');
  assert.ok(paste !== -1 && paste < parse && parse < insert);
  const size = route.indexOf('file.size');
  const buffer = route.indexOf('arrayBuffer');
  assert.ok(size !== -1 && buffer !== -1 && size < buffer);
  assert.doesNotMatch(route, /file\.name[\s\S]{0,80}title/);
  assert.doesNotMatch(`${route}\n${detail}\n${lib}`, /console\.(info|warn|error)\([^)]*transcript/);
});

function reviewRow(): ChatImportRow {
  return {
    id: 'import-1',
    userId: 'user-a',
    source: 'text',
    parser: 'text',
    parserFallback: false,
    title: 'Imported chat',
    transcript: 'user\nWorks on Dupoin campaigns.',
    contentHash: 'hash-1',
    status: 'review',
    draft: {
      facts: [{ id: 'f1', kind: 'context', content: 'Works on Dupoin campaigns.', confidence: 0.4, included: true }],
      qa: [{ id: 'q1', question: 'Where is the brand guide?', answerSummary: 'Internal Docs.', included: true }],
    },
    knowledgeEntryId: 'node-1',
    error: null,
    approveResult: null,
    createdAt: '2026-10-06T00:00:00.000Z',
  };
}

test('approve inserts a fact and Q&A, mirrors both, and links learned_from', async () => {
  const harness = createMemoryImportDeps();
  harness.rows.push(reviewRow());
  const result = await approveChatImport('user-a', 'import-1', {
    facts: [{ id: 'f1', kind: 'context', content: 'Works on Dupoin campaigns.', included: true }],
    qa: [{ id: 'q1', question: 'Where is the brand guide?', answerSummary: 'Internal Docs.', included: true }],
  }, harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.body, {
    status: 'approved', factsSaved: 1, factsAlreadySaved: 0, qaSaved: 1, qaAlreadySaved: 0,
  });
  assert.equal(harness.memories[0].userId, 'user-a');
  assert.equal(harness.memories[0].confidence >= 0.8, true);
  assert.equal(harness.memories[0].mentionCount, 1);
  assert.equal(harness.qa[0].questionNorm.length > 0, true);
  assert.equal(harness.mirrors.length, 2);
  assert.equal(harness.edges.length, 2);
  assert.deepEqual(harness.edges.map(edge => edge.importNodeId), ['node-1', 'node-1']);
  assert.equal(harness.rows[0].status, 'approved');
  assert.deepEqual(harness.rows[0].draft, { facts: [], qa: [] });
});

test('an included sensitive row and an unknown fact id write nothing', async () => {
  for (const body of [
    { facts: [{ id: 'f1', kind: 'context', content: 'my password is hunter2', included: true }], qa: [] },
    { facts: [{ id: 'missing', kind: 'context', content: 'Works on Dupoin campaigns.', included: true }], qa: [] },
  ]) {
    const harness = createMemoryImportDeps();
    harness.rows.push(reviewRow());
    const result = await approveChatImport('user-a', 'import-1', body, harness.deps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
    assert.equal(harness.memories.length, 0);
    assert.equal(harness.rows[0].status, 'review');
  }
});

test('unchecked rows are omitted and an existing fact or question is not inserted twice', async () => {
  const harness = createMemoryImportDeps();
  harness.rows.push(reviewRow());
  const hash = memoryContentHash('context', 'Works on Dupoin campaigns.');
  harness.memories.push({ id: 'old-fact', userId: 'user-a', kind: 'context', content: 'Works on Dupoin campaigns.', contentHash: hash, mentionCount: 2, confidence: 0.9 });
  harness.qa.push({ id: 'old-qa', userId: 'user-a', questionNorm: normalizeQuestion('Where is the brand guide?') });
  const result = await approveChatImport('user-a', 'import-1', {
    facts: [{ id: 'f1', kind: 'context', content: 'Works on Dupoin campaigns.', included: true }],
    qa: [{ id: 'q1', question: 'Where is the brand guide?', answerSummary: 'Internal Docs.', included: false }],
  }, harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.body.factsSaved, 0);
  assert.equal(result.body.factsAlreadySaved, 1);
  assert.equal(result.body.qaSaved, 0);
  assert.equal(harness.memories.length, 1);
  assert.equal(harness.memories[0].mentionCount, 3);
  assert.equal(harness.qa.length, 1);
  assert.equal(harness.edges.length, 1);
});

test('a second approve does not insert and cancel keeps the chat', async () => {
  const harness = createMemoryImportDeps();
  harness.rows.push(reviewRow());
  await approveChatImport('user-a', 'import-1', { facts: [], qa: [] }, harness.deps);
  const again = await approveChatImport('user-a', 'import-1', {
    facts: [{ id: 'f1', kind: 'context', content: 'Works on Dupoin campaigns.', included: true }],
    qa: [],
  }, harness.deps);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.body.alreadyApproved, true);
  assert.equal(harness.memories.length, 0);

  const cancelHarness = createMemoryImportDeps();
  cancelHarness.rows.push({ ...reviewRow(), status: 'extract_failed', error: 'Fact extraction failed.' });
  const cancelled = await cancelChatImport('user-a', 'import-1', cancelHarness.deps);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelHarness.rows[0].status, 'chat_only');
  assert.equal(cancelHarness.rows[0].error, null);
  assert.equal(cancelHarness.rows[0].knowledgeEntryId, 'node-1');
  const repeat = await cancelChatImport('user-a', 'import-1', cancelHarness.deps);
  assert.equal(repeat.ok, true);
  const approved = await cancelChatImport('user-a', 'import-1', harness.deps);
  assert.equal(approved.ok, false);
  if (!approved.ok) assert.equal(approved.body.error, 'This import is already approved.');
  const other = await approveChatImport('user-b', 'import-1', { facts: [], qa: [] }, harness.deps);
  assert.equal(other.ok, false);
  if (!other.ok) assert.equal(other.body.error, 'Import was not found.');
});

test('approve and cancel SQL bind user_id and do not call the live extractors', async () => {
  const lib = await readFile('src/lib/chat-import.ts', 'utf8');
  const approve = await readFile('src/app/api/ai-research/imports/[id]/approve/route.ts', 'utf8');
  const cancel = await readFile('src/app/api/ai-research/imports/[id]/cancel/route.ts', 'utf8');
  assert.match(lib, /APPROVE_CHAT_IMPORT_SQL[\s\S]{0,300}user_id = \?/);
  assert.match(lib, /CANCEL_CHAT_IMPORT_SQL[\s\S]{0,300}user_id = \?/);
  assert.match(lib, /mirrorUserMemory/);
  assert.match(lib, /mirrorQaTurn/);
  assert.doesNotMatch(lib, /extractUserMemories|indexQaTurn/);
  assert.match(approve, /requireFeature\(request, 'ai-research'\)/);
  assert.match(cancel, /requireFeature\(request, 'ai-research'\)/);
  assert.match(approve, /Extract facts before approving\./);
  assert.match(lib, /Extract facts before approving\./);
  assert.match(lib, /This import is already approved\./);
});

test('a failed extract can be retried into review', async () => {
  const harness = createMemoryImportDeps();
  harness.deps.complete = async () => { throw new Error('down'); };
  const created = await createChatImport('user-a', 'text', 'Remember the Dupoin voice guide.', harness.deps);
  if (!created.ok) return;
  const id = (created.body.import as { id: string }).id;
  assert.equal(harness.rows[0].status, 'extract_failed');
  harness.deps.complete = async () => '{"facts":[{"kind":"style","content":"Prefers a direct voice.","confidence":0.8}],"qa":[]}';
  const retried = await retryChatImport('user-a', id, harness.deps);
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal((retried.body.import as { status: string; transcript?: string }).status, 'review');
  assert.equal((retried.body.import as { transcript?: string }).transcript, undefined);
  assert.equal(harness.rows[0].draft.facts[0].content, 'Prefers a direct voice.');
  const blocked = await retryChatImport('user-a', id, harness.deps);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.body.error, 'Nothing to extract.');
  const stranger = await retryChatImport('user-b', id, harness.deps);
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.body.error, 'Import was not found.');
});

test('extract route SQL binds user_id', async () => {
  const lib = await readFile('src/lib/chat-import.ts', 'utf8');
  const route = await readFile('src/app/api/ai-research/imports/[id]/extract/route.ts', 'utf8');
  assert.match(lib, /EXTRACT_SUCCESS_SQL[\s\S]{0,240}user_id = \?/);
  assert.match(lib, /EXTRACT_FAILURE_SQL[\s\S]{0,240}user_id = \?/);
  assert.match(route, /requireFeature\(request, 'ai-research'\)/);
  assert.match(route, /retryChatImport\(auth\.id/);
  assert.match(lib, /Nothing to extract\./);
});
