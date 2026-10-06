import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChatImport, listChatImports, readChatImport } from '../src/lib/chat-import';
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
