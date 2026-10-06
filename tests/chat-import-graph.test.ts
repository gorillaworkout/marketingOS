import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { knowledgeEmbeddingInput } from '../src/lib/embeddings';
import { shouldUpdateStylePreferences } from '../src/lib/knowledge-persist';
import { KNOWLEDGE_FEATURE_COLORS, knowledgeFeatureColor, knowledgeFeatureLabel } from '../src/lib/knowledge-graph-colors';
import { AI_RESEARCH_RETRIEVAL_TASK_TYPES, IMPORTED_CHAT_TASK_TYPE, KNOWLEDGE_TASK_TYPES } from '../src/lib/knowledge-task-types';
import {
  INSERT_IMPORTED_CHAT_NODE_SQL,
  importedChatNodeFields,
  isUniqueViolation,
  planImportLearnedFromEdges,
} from '../src/lib/chat-import-graph';

test('imported chat is a graph task type with a unique legend color and is not retrieved as research', () => {
  assert.equal(IMPORTED_CHAT_TASK_TYPE, 'imported-chat');
  assert.equal(KNOWLEDGE_TASK_TYPES[KNOWLEDGE_TASK_TYPES.length - 1], 'imported-chat');
  assert.equal(KNOWLEDGE_TASK_TYPES.includes('ai-research-qa'), true);
  assert.equal(knowledgeFeatureLabel('imported-chat'), 'Imported Chat');
  assert.equal(knowledgeFeatureColor('imported-chat'), '#E11D48');
  assert.equal(KNOWLEDGE_FEATURE_COLORS['imported-chat'], '#E11D48');
  assert.deepEqual([...AI_RESEARCH_RETRIEVAL_TASK_TYPES], ['ai-research', 'market-research', 'internal-docs', 'article-market-news']);
  assert.equal(AI_RESEARCH_RETRIEVAL_TASK_TYPES.includes('imported-chat' as never), false);
  assert.equal(shouldUpdateStylePreferences('imported-chat', 'approve'), false);
  assert.equal(shouldUpdateStylePreferences('imported-chat', 'select'), false);
  assert.equal(shouldUpdateStylePreferences('imported-chat', 'publish'), false);
  assert.equal(shouldUpdateStylePreferences('social-post', 'select'), true);
  assert.equal(knowledgeEmbeddingInput('imported-chat', 'Campaign voice', 'user\nHello'), 'Campaign voice\nuser\nHello');
  assert.equal(knowledgeEmbeddingInput('social-post', 'brief', 'caption'), 'caption');
});

test('style samples skip imported chats along with memory and Q&A', async () => {
  const persist = await readFile('src/lib/knowledge-persist.ts', 'utf8');
  assert.match(persist, /task_type NOT IN \('user-memory', 'ai-research-qa', 'imported-chat'\)/);
});

test('the imported chat node stores the transcript hash and a short prefix', () => {
  const fields = importedChatNodeFields({
    id: 'import-1',
    title: ` ${'T'.repeat(300)} `,
    transcript: 'Z'.repeat(9_000),
    contentHash: 'abc123',
    knowledgeEntryId: 'node-1',
  });
  assert.equal(fields.id, 'node-1');
  assert.equal(fields.taskId, 'import-1');
  assert.equal(fields.taskType, 'imported-chat');
  assert.equal(fields.conversationId, null);
  assert.equal(fields.qualityScore, 0.7);
  assert.equal(fields.contentHash, 'abc123');
  assert.notEqual(fields.contentHash, fields.taskId);
  assert.equal(fields.brief.length, 240);
  assert.equal(fields.selectedOutput.length, 8_000);
  assert.equal(fields.embeddingInput, `${fields.brief}\n${fields.selectedOutput}`);
  assert.match(INSERT_IMPORTED_CHAT_NODE_SQL, /INSERT INTO knowledge_entries/);
  assert.match(INSERT_IMPORTED_CHAT_NODE_SQL, /content_hash/);
  assert.match(INSERT_IMPORTED_CHAT_NODE_SQL, /task_id/);
});

test('learned_from edges point at the import node with no cap of 8', () => {
  const edges = planImportLearnedFromEdges({
    importNodeId: 'node-1',
    sourceNodeIds: Array.from({ length: 9 }, (_, index) => `mem-${index}`),
  });
  assert.equal(edges.length, 9);
  assert.deepEqual(edges[8], { sourceId: 'mem-8', targetId: 'node-1', relationship: 'learned_from', weight: 1 });
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ code: '23503' }), false);
  assert.equal(isUniqueViolation(new Error('duplicate')), false);
});
