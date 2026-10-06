import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  IMPORT_CANCEL_NOTE,
  IMPORT_DUPLICATE_NOTE,
  IMPORT_EXTRACT_FAILED_NOTE,
  IMPORT_MEMORY_OFF_NOTE,
  IMPORT_PLAIN_TEXT_NOTE,
  IMPORT_SAVED_NOTE,
  IMPORT_SOURCE_LABEL,
  importDateLabel,
  importListActions,
} from '../src/lib/chat-import-ui';

test('import list actions and copy match the Phase A flow', () => {
  assert.deepEqual(importListActions('review'), ['view', 'review']);
  assert.deepEqual(importListActions('extract_failed'), ['view', 'retry']);
  assert.deepEqual(importListActions('chat_only'), ['view', 'retry']);
  assert.deepEqual(importListActions('approved'), ['view']);
  assert.equal(IMPORT_SOURCE_LABEL.codex, 'Codex / ChatGPT');
  assert.equal(IMPORT_SOURCE_LABEL.claude, 'Claude');
  assert.equal(IMPORT_SOURCE_LABEL.text, 'Plain text');
  assert.match(importDateLabel('2026-10-06T12:00:00.000Z'), /Oct/);
  assert.equal(importDateLabel('not-a-date'), '');
  assert.equal(IMPORT_MEMORY_OFF_NOTE, 'Memory is off. This chat is still saved. Approved facts and answers are stored, and Dupoin AI will not use them until you turn memory on.');
  assert.equal(IMPORT_CANCEL_NOTE, 'Draft discarded. The chat stays in your knowledge graph.');
  assert.equal(IMPORT_SAVED_NOTE, 'Full chat saved to your knowledge graph.');
  assert.equal(IMPORT_PLAIN_TEXT_NOTE, 'This chat was saved as plain text.');
  assert.equal(IMPORT_EXTRACT_FAILED_NOTE, 'The chat was saved. Fact extraction failed.');
  assert.equal(IMPORT_DUPLICATE_NOTE, 'This chat is already imported.');
});

test('the memory panel can import when memory is empty or off', async () => {
  const panel = await readFile('src/components/AiResearchMemoryPanel.tsx', 'utf8');
  const modal = await readFile('src/components/AiResearchImportModal.tsx', 'utf8');
  assert.match(panel, /Import chat/);
  assert.match(panel, /data-testid="ai-research-import-open"/);
  assert.match(panel, /data-testid="ai-research-import-list"/);
  assert.match(panel, /\/api\/ai-research\/imports/);
  assert.doesNotMatch(panel, /ai-research-import-open"[\s\S]{0,120}disabled=\{!enabled\}/);
  assert.doesNotMatch(panel, /ai-research-import-open"[\s\S]{0,160}memories\.length === 0/);
  assert.match(modal, /data-testid="ai-research-import-modal"/);
  assert.match(modal, /IMPORT_SAVED_NOTE/);
  assert.match(modal, /IMPORT_CANCEL_NOTE/);
  assert.match(modal, /IMPORT_MEMORY_OFF_NOTE/);
  assert.match(modal, /IMPORT_PLAIN_TEXT_NOTE/);
  assert.match(modal, /IMPORT_EXTRACT_FAILED_NOTE/);
  assert.match(modal, /IMPORT_DUPLICATE_NOTE/);
  assert.match(modal, />Import</);
  assert.match(modal, />Paste</);
  assert.match(modal, />Upload</);
  assert.match(modal, />Approve</);
  assert.match(modal, />Cancel</);
  assert.match(modal, /View chat/);
  assert.match(modal, /Retry extract/);
  assert.match(modal, /Open in Knowledge Graph/);
  assert.match(modal, /knowledgeGraphFocusUrl/);
  assert.match(modal, /role === 'admin'/);
  assert.match(modal, /action: 'check'/);
  assert.match(modal, /maxLength=\{280\}/);
  assert.match(modal, /Role/);
  assert.match(modal, /Interests/);
  assert.match(modal, /Preferences/);
  assert.match(modal, /Style/);
  assert.match(modal, /Context/);
  assert.doesNotMatch(modal, /ai_research_conversations|extractUserMemories|indexQaTurn/);
});
