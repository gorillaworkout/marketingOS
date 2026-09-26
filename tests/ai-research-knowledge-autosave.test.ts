import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  persistCompletedResearchAnswer,
  selectResearchKnowledgePieces,
  type PersistKnowledgeInput,
  type PersistKnowledgeResult,
} from '../src/lib/knowledge-persist';

const read = (path: string) => readFileSync(path, 'utf8');

const sources = [
  { title: 'Gold market wrap', url: 'https://www.reuters.com/markets/gold' },
  { title: 'Rupiah pagi ini', url: 'https://www.bi.go.id/en/moneter/informasi-kurs' },
  { title: 'Minyak mentah', url: 'https://www.kontan.co.id/news/minyak' },
  { title: 'Indeks penutupan', url: 'https://www.bisnis.com/market/indeks' },
];

function saved(input: PersistKnowledgeInput): PersistKnowledgeResult {
  return {
    knowledgeId: `kg-${input.taskId}`,
    connectionsCount: 0,
    deduped: false,
    skipped: false,
    qualityScore: 1,
  };
}

test('completed research stores important cited claims for that user without a pin', async () => {
  const writes: PersistKnowledgeInput[] = [];
  const answer = [
    'Gold rose to $2,650 per ounce on 25 September 2026 [1].',
    '',
    'The rupiah traded near 16,000 per dollar the same morning [2].',
    '',
    '## Gaps and limitations',
    '',
    'Search rounds: 1 of 1. Sources used: 2.',
    'Claims outside the source excerpts are not verified.',
    '',
    'Let me know if you want another pass.',
  ].join('\n');

  const result = await persistCompletedResearchAnswer({
    userId: 'user-bayu',
    conversationId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    query: 'gold and rupiah',
    answer,
    sources,
    aborted: false,
  }, async input => {
    writes.push(input);
    return saved(input);
  });

  assert.equal(result.saved, 2);
  assert.equal(writes.length, 2);
  assert.equal(writes.every(row => row.userId === 'user-bayu'), true);
  assert.equal(writes.every(row => row.taskType === 'ai-research'), true);
  assert.equal(writes.every(row => row.updateStylePreferences === false), true);
  assert.equal(writes.every(row => row.action === 'pin'), true);
  assert.equal(writes[0].conversationId, '11111111-1111-4111-8111-111111111111');
  assert.match(String(writes[0].selectedOutput), /\$2,650/);
  assert.deepEqual(writes[0].sourceUrls, ['https://www.reuters.com/markets/gold']);
  assert.match(String(writes[1].selectedOutput), /16,000/);
  assert.deepEqual(writes[1].sourceUrls, ['https://www.bi.go.id/en/moneter/informasi-kurs']);
  assert.equal(writes.some(row => /not verified|let me know/i.test(String(row.selectedOutput))), false);
});

test('an aborted or ungrounded answer does not enter the knowledge graph', async () => {
  const writes: PersistKnowledgeInput[] = [];
  const persist = async (input: PersistKnowledgeInput) => {
    writes.push(input);
    return saved(input);
  };
  const answer = 'Gold rose to $2,650 per ounce on 25 September 2026 [1]. The move was the largest daily gain this month.';
  const aborted = await persistCompletedResearchAnswer({
    userId: 'user-bayu',
    query: 'gold',
    answer,
    sources,
    aborted: true,
  }, persist);
  assert.deepEqual(aborted, { saved: 0, deduped: 0 });

  const ungrounded = await persistCompletedResearchAnswer({
    userId: 'user-bayu',
    query: 'gold',
    answer: 'Here is a long opinion about markets with no citation and no retrieved source attached to the turn at all.',
    sources: [],
    aborted: false,
  }, persist);
  assert.deepEqual(ungrounded, { saved: 0, deduped: 0 });
  assert.equal(writes.length, 0);
});

test('auto-save keeps at most three important claims and prefers figures over bare links', () => {
  const answer = [
    '- https://www.reuters.com/markets/gold/extra-path-segment-for-a-long-bare-link',
    '- Gold rose to $2,650 per ounce on 25 September 2026. [Reuters](https://www.reuters.com/markets/gold)',
    '- The rupiah traded near 16,000 per dollar. [Bank Indonesia](https://www.bi.go.id/en/moneter/informasi-kurs)',
    '- Minyak naik 2% setelah stok turun. [Kontan](https://www.kontan.co.id/news/minyak)',
    '- Indeks menguat 1% di penutupan. [Bisnis](https://www.bisnis.com/market/indeks)',
  ].join('\n');
  const pieces = selectResearchKnowledgePieces({ answer, query: 'market wrap', sources });
  assert.equal(pieces.length, 3);
  assert.match(pieces[0].text, /\$2,650/);
  assert.equal(pieces.some(piece => piece.text.startsWith('https://')), false);
  assert.equal(pieces.some(piece => /Indeks menguat/.test(piece.text)), false);
});

test('compare tables and fast or deep completion persist without the pin control', () => {
  const pieces = selectResearchKnowledgePieces({
    query: 'compare gold',
    sources,
    answer: [
      '| Market | Move |',
      '| --- | --- |',
      '| Gold | Rose to $2,650 per ounce [1] |',
      '| Rupiah | Traded near 16,000 per dollar [2] |',
    ].join('\n'),
  });
  assert.equal(pieces.length, 2);
  assert.match(pieces[0].text, /\$2,650/);
  assert.deepEqual(pieces[0].sourceUrls, ['https://www.reuters.com/markets/gold']);

  const chat = read('src/app/api/ai-research/chat/route.ts');
  const pinUi = read('src/components/AiResearchPinFact.tsx');
  const save = read('src/app/api/knowledge/save/route.ts');
  assert.match(chat, /if \(mode === 'deep' && !compare\)/);
  assert.equal((chat.match(/await persistCompletedResearchAnswer\(/g) || []).length, 2);
  assert.match(chat, /sources: researchEvent\.sources/);
  assert.match(chat, /aborted: false/);
  assert.doesNotMatch(chat, /AiResearchPinFact/);
  assert.match(pinUi, /Pin to Knowledge Graph/);
  assert.match(pinUi, /\/api\/knowledge\/save/);
  assert.match(save, /savePinnedResearchFact/);
  assert.match(save, /updateStylePreferences: false/);
});
