import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { knowledgeEmbeddingInput } from '../src/lib/embeddings';
import { shouldUpdateStylePreferences } from '../src/lib/knowledge-persist';
import { KNOWLEDGE_FEATURE_COLORS, knowledgeFeatureColor, knowledgeFeatureLabel } from '../src/lib/knowledge-graph-colors';
import { AI_RESEARCH_RETRIEVAL_TASK_TYPES, IMPORTED_CHAT_TASK_TYPE, KNOWLEDGE_TASK_TYPES } from '../src/lib/knowledge-task-types';

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
