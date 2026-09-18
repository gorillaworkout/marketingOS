import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildSimilarEntriesQuery,
  getEmbedding,
  rankSimilarEntries,
} from '../src/lib/embeddings';
import { formatKnowledgeContext } from '../src/lib/openai';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('similar-entry query is always scoped to the requesting user', () => {
  const unscoped = buildSimilarEntriesQuery({ userId: 'user-a' });
  assert.match(unscoped.sql, /FROM knowledge_entries WHERE user_id = \? AND embedding IS NOT NULL/);
  assert.deepEqual(unscoped.params, ['user-a']);
  assert.doesNotMatch(unscoped.sql, /SELECT \* FROM knowledge_entries WHERE embedding IS NOT NULL$/);

  const typed = buildSimilarEntriesQuery({ userId: 'user-a', taskType: 'social-post' });
  assert.match(typed.sql, /AND task_type = \?/);
  assert.deepEqual(typed.params, ['user-a', 'social-post']);
});

test('rankSimilarEntries prefers the closer brief and ignores invalid embeddings', async () => {
  const query = await getEmbedding('risk management for Indonesian traders');
  const mine = {
    id: 'mine',
    user_id: 'user-a',
    embedding: JSON.stringify(await getEmbedding('risk management for Indonesian traders Kelola risiko sebelum entry')),
  };
  const otherUser = {
    id: 'theirs',
    user_id: 'user-b',
    embedding: JSON.stringify(await getEmbedding('chocolate cake recipe with buttercream')),
  };
  const broken = { id: 'broken', user_id: 'user-a', embedding: 'not-json' };

  const ranked = rankSimilarEntries(query, [otherUser, broken, mine], 5);
  assert.deepEqual(ranked.map(entry => entry.id), ['mine', 'theirs']);
  assert.equal(ranked[0].user_id, 'user-a');
});

test('formatKnowledgeContext builds a RAG prompt block and stays empty without hits', () => {
  assert.equal(formatKnowledgeContext([]), '');

  const block = formatKnowledgeContext([
    {
      task_type: 'social-post',
      platform: 'Instagram',
      audience: 'traders',
      brief: 'Edukasi risk management',
      selected_output: 'Rencana dulu, baru entry. Kelola risiko sebelum membuka posisi.',
    },
  ]);

  assert.match(block, /KNOWLEDGE GRAPH/);
  assert.match(block, /Similar approved selections for this user/);
  assert.match(block, /social-post\/Instagram\/traders/);
  assert.match(block, /Edukasi risk management/);
  assert.match(block, /Rencana dulu, baru entry/);
  assert.match(block, /Do NOT copy them/);
});

test('findSimilarEntries and fetchKnowledgeContext require a user scope', () => {
  const embeddings = read('src/lib/embeddings.ts');
  const openai = read('src/lib/openai.ts');

  assert.match(embeddings, /export async function findSimilarEntries/);
  assert.match(embeddings, /userId: string/);
  assert.match(embeddings, /buildSimilarEntriesQuery\(scope\)/);
  assert.match(embeddings, /userId: entry\.user_id/);
  assert.doesNotMatch(embeddings, /SELECT \* FROM knowledge_entries WHERE embedding IS NOT NULL['`;]/);

  assert.match(openai, /export async function fetchKnowledgeContext\(/);
  assert.match(openai, /findSimilarEntries\(query, \{ userId, taskType, limit \}\)/);
  assert.match(openai, /formatKnowledgeContext\(entries\)/);
});

test('Social Post, Video Script, and Event Plan inject knowledge RAG without dropping style/memory', () => {
  const social = read('src/app/api/social-post/generate/route.ts');
  const video = read('src/app/api/video-script/generate/route.ts');
  const eventPlan = read('src/app/api/event-plan/generate/route.ts');

  for (const source of [social, video, eventPlan]) {
    assert.match(source, /fetchContextMemory/);
    assert.match(source, /fetchStyleContext/);
    assert.match(source, /fetchKnowledgeContext/);
    assert.match(source, /styleContext/);
    assert.match(source, /\$\{contextMemory\}/);
    assert.match(source, /\$\{knowledgeContext\}/);
  }

  assert.match(social, /fetchKnowledgeContext\(userId, brief, 'social-post', 5\)/);
  assert.match(video, /fetchKnowledgeContext\(userId, event, 'video-script', 5\)/);
  assert.match(eventPlan, /fetchKnowledgeContext\(/);
  assert.match(eventPlan, /'event-plan'/);
});
