import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_RESEARCH_FOLLOW_UP_MAX,
  AI_RESEARCH_FOLLOW_UP_MIN,
  suggestAiResearchFollowUps,
} from '../src/lib/ai-research-followups';

const read = (path: string) => readFileSync(path, 'utf8');
const ANSWER = 'Emas menguat karena permintaan fisik dan pelemahan dolar. Sumber yang dikutip menyebut level 2650 sebagai area yang diawasi pasar.';

test('follow-up chips are 3–5 Indonesian questions and skip empty or error answers', () => {
  const person = suggestAiResearchFollowUps({
    query: 'Siapa Sella Susriana di Dupoin?',
    answer: ANSWER,
    sources: [{ title: 'Daftar Wakil Pialang Bappebti', url: 'https://bappebti.go.id/pialang' }],
  });
  assert.ok(person.length >= AI_RESEARCH_FOLLOW_UP_MIN);
  assert.ok(person.length <= AI_RESEARCH_FOLLOW_UP_MAX);
  assert.ok(person.every(item => item.endsWith('?')));
  assert.ok(person.some(item => /Sella Susriana/i.test(item)));
  assert.ok(person.some(item => item.includes('Daftar Wakil Pialang Bappebti')));
  assert.ok(person.every(item => item !== 'Siapa Sella Susriana di Dupoin?'));

  const strategy = suggestAiResearchFollowUps({
    query: 'Buatkan strategi konten Instagram untuk broker forex',
    answer: ANSWER,
  });
  assert.ok(strategy.some(item => /steps|channel|measured/i.test(item)));

  assert.deepEqual(suggestAiResearchFollowUps({ query: 'Siapa Dupoin?', answer: '' }), []);
  assert.deepEqual(suggestAiResearchFollowUps({ query: 'Siapa Dupoin?', answer: 'Pendek.' }), []);
  assert.deepEqual(suggestAiResearchFollowUps({
    query: 'Siapa Dupoin?',
    answer: 'API error 500: gateway failed while generating the research answer.',
  }), []);
  assert.deepEqual(suggestAiResearchFollowUps({ query: '   ', answer: ANSWER }), []);
});

test('AI Research page shows follow-up chips only from a completed assistant answer', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(page, /suggestAiResearchFollowUps/);
  assert.match(page, /data-testid="ai-research-followups"/);
  assert.match(page, /Follow-up questions/);
  assert.match(page, /if \(loading \|\| streaming\) return \[\]/);
  assert.match(page, /onClick=\{\(\) => sendMessage\(suggestion\)\}/);
  assert.match(page, /const fromChip = typeof rawText === 'string'/);
});
