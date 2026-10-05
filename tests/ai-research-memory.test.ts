import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_FEATURE_ASSIGNMENTS } from '../src/lib/model-routing';
import {
  AI_RESEARCH_KNOWLEDGE_MIN_SCORE,
  AI_RESEARCH_RETRIEVAL_TASK_TYPES,
} from '../src/lib/knowledge-task-types';
import {
  EMBEDDING_DIM,
  buildSimilarEntriesQuery,
  cosineSimilarity,
  getEmbedding,
  knowledgeEmbeddingInput,
  rankSimilarEntries,
  tokenizeForEmbedding,
} from '../src/lib/embeddings';
import { chooseNearDuplicateId, knowledgeEmbeddingInput as persistEmbeddingInput, shouldUpdateStylePreferences } from '../src/lib/knowledge-persist';
import { knowledgeFeatureLabel } from '../src/lib/knowledge-graph-colors';
import {
  AI_RESEARCH_MEMORY_MODEL,
  PRIOR_ANSWERS_HEADER,
  PROFILE_CHAR_LIMIT,
  RELATED_QUESTION_SCORE,
  SAME_QUESTION_SCORE,
  USER_PROFILE_HEADER,
  extractUserMemories,
  findSimilarPastQuestions,
  foldExtractedMemories,
  formatJakartaDate,
  formatPriorAnswersBlock,
  formatUserProfileBlock,
  indexQaTurn,
  isPromotedMemory,
  isSensitiveMemory,
  loadUserProfileBlock,
  memoryContentHash,
  parseExtractedMemories,
  priorQuestionChipLabel,
  questionRelation,
  rankPastQuestions,
  type MemoryRow,
  type QaRow,
} from '../src/lib/ai-research-memory';
import {
  clearUserMemoryGraph,
  mirrorQaTurn,
  mirrorUserMemory,
  planMemoryFactEdges,
  planSimilarQaEdges,
  removeQaTurnsFromGraph,
  type GraphNode,
  type MemoryGraphStore,
  type PlannedEdge,
} from '../src/lib/ai-research-memory-graph';

const read = (file: string) => readFileSync(file, 'utf8');

function memory(partial: Partial<MemoryRow> & Pick<MemoryRow, 'id' | 'userId' | 'kind' | 'content'>): MemoryRow {
  const now = '2026-09-28T02:00:00.000Z';
  return {
    contentHash: memoryContentHash(partial.kind, partial.content),
    embedding: null,
    sourceConversationId: null,
    mentionCount: 1,
    confidence: 0.9,
    lastUsedAt: now,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

test('question thresholds mark the same question, a related one, and noise', () => {
  assert.equal(questionRelation(0.8), 'same');
  assert.equal(questionRelation(SAME_QUESTION_SCORE), 'same');
  assert.equal(questionRelation(0.6), 'related');
  assert.equal(questionRelation(RELATED_QUESTION_SCORE), 'related');
  assert.equal(questionRelation(0.59), null);
  assert.equal(priorQuestionChipLabel('Sep 28'), 'You asked something similar on Sep 28 — View answer');
});

test('Jakarta dates use Asia/Jakarta and drop the year when it is the current year', () => {
  const now = new Date('2026-10-05T00:00:00.000Z');
  assert.equal(formatJakartaDate('2026-09-27T18:00:00.000Z', now), 'Sep 28');
  assert.equal(formatJakartaDate('2025-09-28T02:00:00.000Z', now), 'Sep 28, 2025');
});

test('past questions stay inside one user, skip the current chat, and keep the top three', async () => {
  const question = 'How do I center a div in CSS?';
  const embedding = await getEmbedding(question);
  const older = '2026-09-28T02:00:00.000Z';
  const rows: QaRow[] = [
    {
      id: 'qa-a',
      userId: 'user-a',
      conversationId: 'conv-old',
      question: 'How can I center a div using CSS?',
      questionNorm: 'how can i center a div using css',
      answerSummary: 'Use flexbox on the parent.',
      sources: [],
      embedding: await getEmbedding('How can I center a div using CSS?'),
      createdAt: older,
    },
    {
      id: 'qa-current',
      userId: 'user-a',
      conversationId: 'conv-now',
      question,
      questionNorm: 'how do i center a div in css',
      answerSummary: 'Current turn.',
      sources: [],
      embedding,
      createdAt: '2026-10-05T01:00:00.000Z',
    },
    {
      id: 'qa-b',
      userId: 'user-b',
      conversationId: 'conv-b',
      question: 'How can I center a div using CSS?',
      questionNorm: 'how can i center a div using css',
      answerSummary: 'User B answer.',
      sources: [],
      embedding: await getEmbedding('How can I center a div using CSS?'),
      createdAt: older,
    },
    {
      id: 'qa-noise',
      userId: 'user-a',
      conversationId: 'conv-gold',
      question: 'What is the gold price today?',
      questionNorm: 'what is the gold price today',
      answerSummary: 'Gold moved.',
      sources: [],
      embedding: await getEmbedding('What is the gold price today?'),
      createdAt: older,
    },
  ];
  const matches = rankPastQuestions(rows, {
    userId: 'user-a',
    questionEmbedding: embedding,
    excludeConversationId: 'conv-now',
    now: new Date('2026-10-05T00:00:00.000Z'),
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].userId, 'user-a');
  assert.equal(matches[0].conversationId, 'conv-old');
  assert.equal(matches[0].relation, 'same');
  assert.equal(matches[0].date, 'Sep 28');
  assert.ok(matches[0].score >= SAME_QUESTION_SCORE);

  let listed = 0;
  const lookedUp = await findSimilarPastQuestions('user-a', question, 'conv-now', {
    isEnabled: async () => true,
    listQa: async () => {
      listed += 1;
      return rows;
    },
  });
  assert.equal(listed, 1);
  assert.deepEqual(lookedUp.map(item => item.userId), ['user-a']);
  assert.ok(lookedUp.every(item => item.conversationId !== 'conv-b'));
});

test('memory off does not read or write the QA index or the profile', async () => {
  let reads = 0;
  let writes = 0;
  let completions = 0;
  const io = {
    isEnabled: async () => false,
    listQa: async () => { reads += 1; return []; },
    insertQa: async () => { writes += 1; },
    listMemories: async () => { reads += 1; return []; },
    complete: async () => { completions += 1; return '{"memories":[]}'; },
    upsertMemory: async () => { writes += 1; },
  };
  await indexQaTurn({ userId: 'user-a', question: 'How do hooks work?', answer: 'They store state.' }, io);
  await extractUserMemories({ userId: 'user-a', question: 'I am a frontend engineer', answer: 'Noted.' }, io);
  assert.deepEqual(await findSimilarPastQuestions('user-a', 'How do hooks work?', null, io), []);
  assert.equal(await loadUserProfileBlock('user-a', io), '');
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.equal(completions, 0);
});

test('memories merge by hash, promote an interest only after it recurs, and ignore sensitive text', async () => {
  assert.equal(isSensitiveMemory('my password is hunter2'), true);
  assert.equal(isSensitiveMemory('Frontend engineer'), false);
  assert.deepEqual(parseExtractedMemories('not json'), []);

  const first = await foldExtractedMemories('user-a', [], [
    { kind: 'role', content: 'Frontend engineer', confidence: 0.95, explicit: true },
    { kind: 'interest', content: 'React and Next.js', confidence: 0.9, explicit: false },
    { kind: 'role', content: 'password is hunter2', confidence: 0.99, explicit: true },
  ], { nowIso: '2026-10-01T00:00:00.000Z', createId: () => 'mem-role' });
  assert.equal(first.length, 2);
  assert.equal(first.filter(row => row.userId === 'user-a' && row.kind === 'role')[0].content, 'Frontend engineer');
  const interest = first.find(row => row.kind === 'interest');
  assert.ok(interest);
  assert.equal(interest.mentionCount, 1);
  assert.equal(isPromotedMemory(interest), false);
  assert.doesNotMatch(formatUserProfileBlock(first), /React/);
  assert.match(formatUserProfileBlock(first), /Role: Frontend engineer/);

  const second = await foldExtractedMemories('user-a', first, [
    { kind: 'interest', content: 'React Next.js', confidence: 0.4, explicit: false },
    { kind: 'role', content: 'Frontend engineer', confidence: 0.5, explicit: false },
  ], { nowIso: '2026-10-02T00:00:00.000Z', createId: () => 'should-not-insert' });
  const roles = second.filter(row => row.kind === 'role');
  assert.equal(roles.length, 1);
  assert.equal(roles[0].id, 'mem-role');
  assert.equal(roles[0].mentionCount, 2);
  const interests = second.filter(row => row.kind === 'interest');
  assert.equal(interests.length, 1);
  assert.equal(interests[0].mentionCount, 2);
  assert.equal(isPromotedMemory(interests[0]), true);
  assert.match(formatUserProfileBlock([...first.filter(row => row.kind === 'role'), ...second]), /React/);
});

test('user A never receives user B memories from extraction or the profile block', async () => {
  const userB = memory({
    id: 'mem-b',
    userId: 'user-b',
    kind: 'role',
    content: 'Backend engineer at a secret desk',
    confidence: 0.99,
    mentionCount: 4,
  });
  const writes: MemoryRow[] = [];
  await extractUserMemories({
    userId: 'user-a',
    question: 'I am a frontend engineer',
    answer: 'I will tailor examples to frontend work.',
  }, {
    isEnabled: async () => true,
    complete: async () => JSON.stringify({
      memories: [{ kind: 'role', content: 'Frontend engineer', confidence: 0.95, explicit: true }],
    }),
    listMemories: async () => [userB],
    upsertMemory: async row => { writes.push(row); },
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].userId, 'user-a');
  assert.equal(writes[0].content, 'Frontend engineer');
  assert.notEqual(writes[0].id, 'mem-b');

  const block = await loadUserProfileBlock('user-a', {
    isEnabled: async () => true,
    listMemories: async () => [userB, writes[0]],
  });
  assert.ok(block.includes(USER_PROFILE_HEADER));
  assert.match(block, /Frontend engineer/);
  assert.doesNotMatch(block, /Backend engineer/);
  assert.ok(block.length <= PROFILE_CHAR_LIMIT);
});

test('profile and prior-answer blocks stay bounded and are not public sources', async () => {
  const memories = Array.from({ length: 20 }, (_, index) => memory({
    id: `mem-${index}`,
    userId: 'user-a',
    kind: 'context',
    content: `Context fact number ${index} `.repeat(12).trim(),
    confidence: 0.9,
    mentionCount: index + 1,
  }));
  const profile = formatUserProfileBlock(memories);
  assert.ok(profile.includes(USER_PROFILE_HEADER));
  assert.ok(profile.length <= PROFILE_CHAR_LIMIT);
  const prior = formatPriorAnswersBlock([{
    question: 'How do I center a div in CSS?',
    date: 'Sep 28',
    relation: 'same',
    answerSummary: 'Use flexbox.',
  }]);
  assert.ok(prior.includes(PRIOR_ANSWERS_HEADER));
  assert.match(prior, /Sep 28/);
  assert.match(prior, /Never cite these prior answers as a public source/);
});

test('retrieval drops weak scores and social captions, and legacy vectors do not crash', async () => {
  assert.deepEqual(
    [...AI_RESEARCH_RETRIEVAL_TASK_TYPES],
    ['ai-research', 'market-research', 'internal-docs', 'article-market-news'],
  );
  assert.ok(AI_RESEARCH_KNOWLEDGE_MIN_SCORE > 0);
  const scoped = buildSimilarEntriesQuery({
    userId: 'user-a',
    taskTypes: AI_RESEARCH_RETRIEVAL_TASK_TYPES,
  });
  assert.match(scoped.sql, /user_id = \?/);
  assert.match(scoped.sql, /task_type IN \(\?, \?, \?, \?\)/);
  assert.equal(scoped.params.includes('social-post'), false);
  assert.equal(scoped.params[0], 'user-a');

  const query = await getEmbedding('How do I center a div in CSS?');
  const ranked = rankSimilarEntries(query, [
    { id: 'promo', embedding: JSON.stringify(await getEmbedding('Dupoin instagram weekend promo caption')) },
    { id: 'css', embedding: JSON.stringify(await getEmbedding('How can I center a div using CSS?')) },
    { id: 'legacy', embedding: JSON.stringify(Array.from({ length: 256 }, () => 0.2)) },
    { id: 'broken', embedding: '{not-json' },
  ], 5, { minScore: SAME_QUESTION_SCORE });
  assert.deepEqual(ranked.map(entry => entry.id), ['css']);
  assert.equal(cosineSimilarity(query, Array.from({ length: 256 }, () => 0.2)), 0);
  assert.doesNotThrow(() => rankSimilarEntries(query, [{ id: 'legacy', embedding: JSON.stringify(Array.from({ length: 256 }, () => 1)) }], 3));
  assert.equal((await getEmbedding('react hooks')).length, EMBEDDING_DIM);
  assert.deepEqual(tokenizeForEmbedding('The yang dan React pengembang'), ['react', 'pengembang']);
  assert.equal(knowledgeEmbeddingInput('ai-research', 'What is React?', 'A UI library'), 'What is React?\nA UI library');
  assert.equal(knowledgeEmbeddingInput('social-post', 'brief', 'caption'), 'caption');
  assert.equal(persistEmbeddingInput, knowledgeEmbeddingInput);
  assert.equal(chooseNearDuplicateId([{ id: 'low', score: 0.5 }, { id: 'high', score: 0.9 }]), 'high');
  assert.equal(chooseNearDuplicateId([{ id: 'low', score: 0.5 }]), null);
  assert.equal(shouldUpdateStylePreferences('user-memory', 'select'), false);
  assert.equal(shouldUpdateStylePreferences('ai-research-qa', 'pin'), false);
});

test('knowledge graph copies stay on the owning user and link only that user\'s facts', async () => {
  assert.equal(knowledgeFeatureLabel('user-memory'), 'User Memory');
  assert.equal(knowledgeFeatureLabel('ai-research-qa'), 'Research Q&A');

  const nodes: GraphNode[] = [{
    id: 'fact-b',
    userId: 'user-b',
    taskType: 'ai-research',
    taskId: 'fact-b',
    brief: 'User B fact',
    selectedOutput: 'Only user B',
    conversationId: 'conv-shared-name',
    embedding: null,
  }, {
    id: 'fact-a',
    userId: 'user-a',
    taskType: 'ai-research',
    taskId: 'fact-a',
    brief: 'User A fact',
    selectedOutput: 'Dupoin licence detail',
    conversationId: 'conv-a',
    embedding: null,
  }];
  const edges: PlannedEdge[] = [];
  const store: MemoryGraphStore = {
    async findByTask(userId, taskType, taskId) {
      return nodes.find(node => node.userId === userId && node.taskType === taskType && node.taskId === taskId) || null;
    },
    async save(node) {
      const index = nodes.findIndex(item => item.id === node.id);
      if (index >= 0) nodes[index] = node;
      else nodes.push(node);
    },
    async listForUser(_userId, taskTypes) {
      return nodes.filter(node => taskTypes.includes(node.taskType));
    },
    async addEdges(next) { edges.push(...next); },
    async removeByTask(userId, taskType, taskId) {
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (node.userId === userId && node.taskType === taskType && node.taskId === taskId) nodes.splice(index, 1);
      }
    },
    async removeTaskType(userId, taskType) {
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        if (nodes[index].userId === userId && nodes[index].taskType === taskType) nodes.splice(index, 1);
      }
    },
  };

  const memoryId = await mirrorUserMemory({
    userId: 'user-a',
    memoryId: 'mem-a',
    kind: 'role',
    content: 'Frontend engineer',
    conversationId: 'conv-a',
    embedding: await getEmbedding('Frontend engineer'),
  }, store);
  assert.ok(memoryId);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].targetId, 'fact-a');
  assert.equal(edges[0].relationship, 'learned_from');
  assert.equal(nodes.filter(node => node.userId === 'user-b' && node.taskType === 'user-memory').length, 0);

  const qaEmbedding = await getEmbedding('How do I center a div in CSS?');
  const unrelated = planSimilarQaEdges({
    entryId: 'qa-a',
    userId: 'user-a',
    embedding: qaEmbedding,
    others: [
      { id: 'qa-b', userId: 'user-b', taskType: 'ai-research-qa', embedding: qaEmbedding },
      { id: 'qa-a2', userId: 'user-a', taskType: 'ai-research-qa', embedding: await getEmbedding('What is the gold price today?') },
      { id: 'qa-a3', userId: 'user-a', taskType: 'ai-research-qa', embedding: await getEmbedding('How can I center a div using CSS?') },
    ],
  });
  assert.deepEqual(unrelated.map(edge => edge.targetId), ['qa-a3']);

  await mirrorQaTurn({
    userId: 'user-a',
    qaId: 'qa-row-a',
    conversationId: 'conv-a',
    question: 'How do I center a div in CSS?',
    answerSummary: 'Use flexbox.',
    embedding: qaEmbedding,
  }, store);
  nodes.push({
    id: 'qa-node-b',
    userId: 'user-b',
    taskType: 'ai-research-qa',
    taskId: 'qa-row-b',
    brief: 'secret question',
    selectedOutput: 'secret answer',
    conversationId: 'conv-a',
    embedding: qaEmbedding,
  });
  await removeQaTurnsFromGraph('user-a', ['qa-row-a', 'qa-row-b'], store);
  assert.equal(nodes.some(node => node.taskId === 'qa-row-a'), false);
  assert.equal(nodes.some(node => node.taskId === 'qa-row-b'), true);

  await clearUserMemoryGraph('user-a', store);
  assert.equal(nodes.some(node => node.userId === 'user-a' && node.taskType === 'user-memory'), false);
  assert.equal(nodes.some(node => node.id === 'fact-b'), true);
  assert.equal(nodes.some(node => node.id === 'fact-a'), true);

  const leaked = planMemoryFactEdges({
    memoryEntryId: 'mem-node',
    userId: 'user-a',
    conversationId: 'conv-shared-name',
    facts: nodes.filter(node => node.taskType === 'ai-research').map(node => ({
      id: node.id,
      userId: node.userId,
      conversationId: node.conversationId,
      taskType: node.taskType,
    })),
  });
  assert.deepEqual(leaked, []);
});

test('AI Research wires memory into both prompts, the panel, and the knowledge graph', () => {
  const route = read('src/app/api/ai-research/chat/route.ts');
  const prompt = read('src/lib/ai-research.ts');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const panel = read('src/components/AiResearchMemoryPanel.tsx');
  const memoryApi = read('src/app/api/ai-research/memory/route.ts');
  const admin = read('src/app/api/admin/knowledge-graph/entries/[id]/route.ts');
  const graphApi = read('src/app/api/knowledge/graph/route.ts');
  const memoryLib = read('src/lib/ai-research-memory.ts');

  assert.ok(DEFAULT_FEATURE_ASSIGNMENTS['ai-research'].allowedModels.includes(AI_RESEARCH_MEMORY_MODEL));
  assert.match(prompt, /USER PROFILE \(learned memory\)/);
  assert.match(prompt, /PRIOR ANSWERS FROM THIS USER/);
  assert.match(prompt, /Never cite learned memory/);
  assert.match(prompt, /Still show all retrieved grounded data/);
  assert.doesNotMatch(route, /Proyek tidak ditemukan/);
  assert.match(route, /Project not found/);
  assert.match(route, /type: 'memory'/);
  assert.match(route, /learned\.profileBlock/);
  assert.match(route, /learned\.priorBlock/);
  assert.match(route, /indexQaTurn/);
  assert.match(route, /extractUserMemories/);
  assert.match(route, /deleteQaForConversation/);
  assert.equal((route.match(/learned\.profileBlock/g) || []).length, 2);

  assert.match(page, /data-testid="ai-research-memory-open"/);
  assert.match(page, /AiResearchPriorQuestionChip/);
  assert.match(page, /AiResearchPriorPreview/);
  assert.match(panel, /You asked something similar on/);
  assert.match(panel, /Your current chat stays open/);
  assert.match(panel, /Memory is on/);
  assert.match(panel, /Clear all/);
  assert.match(panel, /Role/);
  assert.match(panel, /Interests/);
  assert.match(panel, /Preferences/);
  assert.match(panel, /Style/);
  assert.doesNotMatch(`${page}\n${panel}\n${memoryApi}`, /Proyek|tidak ditemukan|Hapus/);

  assert.match(memoryApi, /listMemorySettings\(auth\.id\)/);
  assert.match(memoryApi, /clearMemories\(auth\.id\)/);
  assert.match(memoryApi, /updateMemoryContent\(auth\.id/);
  assert.match(memoryLib, /mirrorUserMemory/);
  assert.match(memoryLib, /mirrorQaTurn/);
  assert.match(memoryLib, /clearUserMemoryGraph/);
  assert.match(memoryLib, /removeQaTurnsFromGraph/);
  assert.match(memoryLib, /removeUserMemoryFromGraph/);
  assert.match(admin, /prepareLinkedMemoryTitle/);
  assert.match(admin, /commitLinkedMemoryTitle/);
  assert.match(admin, /deleteLinkedMemoryRow/);
  assert.match(graphApi, /FROM knowledge_entries WHERE user_id = \?/);
});
