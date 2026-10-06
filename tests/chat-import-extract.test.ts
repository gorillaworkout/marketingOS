import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseExtractedMemories } from '../src/lib/ai-research-memory';
import {
  FACT_EXTRACTION_FAILED,
  extractionInput,
  parseImportExtraction,
  readStoredDraft,
  requestImportDraft,
  validateImportAnswer,
  validateImportQuestion,
} from '../src/lib/chat-import-extract';

function ids(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

test('extraction keeps bounded facts and Q&A and drops sensitive or invalid rows', () => {
  const facts = Array.from({ length: 14 }, (_, index) => ({
    kind: index === 1 ? 'secret' : 'context',
    content: index === 2 ? 'my password is hunter2' : `Fact number ${index} about the user`,
    confidence: index === 3 ? 4 : index === 4 ? 'high' : 0.8,
  }));
  const qa = [
    { question: 'Where is the brand guide?', answerSummary: 'Internal Docs, Dupoin brand guideline.' },
    { question: 'Hi', answerSummary: 'Hello' },
    { question: 'What is the api key?', answerSummary: 'sk-abcdefghij' },
    ...Array.from({ length: 10 }, (_, index) => ({ question: `Reusable question ${index} here`, answerSummary: `Reusable answer ${index}` })),
  ];
  const draft = parseImportExtraction(JSON.stringify({ facts, qa }), ids());
  assert.ok(draft);
  assert.equal(draft.facts.length, 12);
  assert.equal(draft.facts[0].id, 'id-1');
  assert.equal(draft.facts[0].included, true);
  assert.equal(draft.facts.every(fact => fact.content.length >= 3 && fact.content.length <= 280), true);
  assert.equal(draft.facts.some(fact => fact.content.includes('password')), false);
  assert.equal(draft.facts[1].confidence, 1);
  assert.equal(draft.facts[2].confidence, 0.5);
  assert.equal(draft.qa.length, 8);
  assert.equal(draft.qa[0].question, 'Where is the brand guide?');
  assert.equal(draft.qa.some(row => row.answerSummary.includes('sk-')), false);
  assert.equal(parseImportExtraction(''), null);
  assert.equal(parseImportExtraction('not json'), null);
  assert.deepEqual(parseImportExtraction('{"memories":[{"kind":"role","content":"Engineer"}]}', ids()), { facts: [], qa: [] });
  const fenced = parseImportExtraction('```json\n{"facts":[{"kind":"role","content":"Frontend engineer","confidence":0.9}],"qa":[]}\n```', ids());
  assert.equal(fenced?.facts[0].content, 'Frontend engineer');
});

test('the model window keeps the ends of a long transcript and the stored text is not required to shrink', () => {
  const short = 'user\nHello';
  assert.equal(extractionInput(short), short);
  const transcript = `${'A'.repeat(12_000)}${'M'.repeat(10_000)}${'Z'.repeat(12_000)}`;
  assert.equal(transcript.length > 24_000, true);
  const windowed = extractionInput(transcript);
  assert.ok(windowed.startsWith('A'.repeat(12_000)));
  assert.ok(windowed.endsWith('Z'.repeat(12_000)));
  assert.match(windowed, /\n\.\.\.\[middle omitted\]\.\.\.\n/);
  assert.equal(windowed.includes('M'), false);
});

test('requestImportDraft sends the windowed prompt and turns model failure into the safe error', async () => {
  let seen = '';
  const ok = await requestImportDraft({
    transcript: `${'A'.repeat(12_000)}${'M'.repeat(10_000)}${'Z'.repeat(12_000)}`,
    complete: async prompt => {
      seen = prompt;
      return '{"facts":[{"kind":"role","content":"Works on Dupoin campaigns.","confidence":0.8}],"qa":[]}';
    },
    createId: () => 'fact-1',
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.draft.facts[0].content, 'Works on Dupoin campaigns.');
  assert.match(seen, /\[middle omitted\]/);
  const failed = await requestImportDraft({
    transcript: 'user\nHello',
    complete: async () => { throw new Error('timeout with transcript user Hello'); },
  });
  assert.deepEqual(failed, { ok: false, error: FACT_EXTRACTION_FAILED });
  const empty = await requestImportDraft({ transcript: 'user\nHello', complete: async () => '' });
  assert.deepEqual(empty, { ok: false, error: FACT_EXTRACTION_FAILED });
});

test('stored drafts keep their ids and question bounds match the live caps', () => {
  const draft = readStoredDraft({
    facts: [
      { id: 'keep', kind: 'interest', content: 'Likes short answers.', confidence: 0.4, included: false },
      { id: 'drop', kind: 'interest', content: 'password', confidence: 0.9 },
    ],
    qa: [{ id: 'qa-1', question: 'Where is the guide?', answerSummary: 'In Docs.', included: true }],
  });
  assert.deepEqual(draft.facts.map(fact => fact.id), ['keep']);
  assert.equal(draft.facts[0].included, true);
  assert.equal(draft.qa[0].id, 'qa-1');
  assert.equal(validateImportQuestion('Hi').ok, false);
  assert.equal(validateImportAnswer('').ok, false);
  const longAnswer = validateImportAnswer('x'.repeat(800));
  assert.equal(longAnswer.ok, true);
  if (longAnswer.ok) assert.equal(longAnswer.answerSummary.length, 500);
});

test('import extraction does not use the live 4-fact parser', async () => {
  const live = JSON.stringify({ memories: Array.from({ length: 6 }, (_, index) => ({ kind: 'context', content: `Live fact ${index} is long enough`, confidence: 0.9, explicit: true })) });
  assert.equal(parseExtractedMemories(live).length, 4);
  const extract = await readFile('src/lib/chat-import-extract.ts', 'utf8');
  assert.match(extract, /AI_RESEARCH_MEMORY_MODEL/);
  assert.match(extract, /temperature: 0\.1/);
  assert.match(extract, /maxTokens: 2000/);
  assert.match(extract, /jsonRepairAttempts: 0/);
  assert.match(extract, /taskType: 'ai-research'/);
  assert.doesNotMatch(extract, /parseExtractedMemories|extractUserMemories|indexQaTurn/);
});
