import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AUTO_RESEARCH_CLAIM_LIMIT,
  KNOWLEDGE_DEDUPE_WINDOW_MS,
  KNOWLEDGE_TASK_TYPES,
  chooseKnowledgeDedupe,
  knowledgeContentHash,
  knowledgeFingerprint,
  primarySocialPostOutput,
  qualityScoreForAction,
  researchKnowledgeTaskId,
  selectResearchKnowledgePieces,
  shouldPersistResearchAnswer,
  shouldUpdateStylePreferences,
  summarizeArticleKnowledge,
  summarizeEventPlanKnowledge,
  summarizeMarketResearchKnowledge,
  summarizeVideoScriptKnowledge,
  type KnowledgeDedupeRow,
} from '../src/lib/knowledge-persist';
import { formatInternalKnowledgeContext, INTERNAL_KNOWLEDGE_GRAPH_HEADER } from '../src/lib/openai';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const now = Date.parse('2026-09-25T04:00:00Z');

function row(partial: Partial<KnowledgeDedupeRow> & Pick<KnowledgeDedupeRow, 'id' | 'fingerprint'>): KnowledgeDedupeRow {
  return {
    taskId: null,
    contentHash: knowledgeContentHash(partial.fingerprint),
    qualityScore: 0.55,
    createdAtMs: now - KNOWLEDGE_DEDUPE_WINDOW_MS - 1_000,
    ...partial,
  };
}

test('content hash ignores JSON key order for the same caption', () => {
  const left = { hook: 'Open strong', caption: 'Kelola risiko sebelum entry.', style: 'bold' };
  const right = JSON.stringify({ style: 'bold', caption: 'Kelola risiko sebelum entry.', hook: 'Open strong' });
  assert.equal(knowledgeFingerprint(left), knowledgeFingerprint(right));
  assert.equal(knowledgeContentHash(left), knowledgeContentHash(right));
});

test('dedupe bumps an approval of an already selected task and keeps a different option', () => {
  const selected = row({
    id: 'selected-option',
    taskId: 'task-1',
    fingerprint: 'caption:Kelola risiko',
    createdAtMs: now - 60 * 60 * 1000,
  });
  const approved = chooseKnowledgeDedupe([selected], {
    taskId: 'task-1',
    contentHash: 'different-hash',
    fingerprint: 'caption:Another option',
    nowMs: now,
    action: 'approve',
  });
  assert.equal(approved?.id, 'selected-option');

  const secondOption = chooseKnowledgeDedupe([selected], {
    taskId: 'task-1',
    contentHash: knowledgeContentHash('caption:Another option'),
    fingerprint: 'caption:Another option',
    nowMs: now,
    action: 'select',
  });
  assert.equal(secondOption, null);
});

test('dedupe collapses identical content inside the window and identical pins', () => {
  const recent = row({
    id: 'recent',
    taskId: 'task-a',
    fingerprint: 'Harga emas menguat menurut Reuters.',
    createdAtMs: now - 60_000,
  });
  const hit = chooseKnowledgeDedupe([recent], {
    taskId: 'task-b',
    contentHash: recent.contentHash || '',
    fingerprint: recent.fingerprint,
    nowMs: now,
    action: 'complete',
  });
  assert.equal(hit?.id, 'recent');

  const oldPin = row({
    id: 'pin',
    fingerprint: 'Harga emas menguat menurut Reuters.',
    createdAtMs: now - 30 * 24 * 60 * 60 * 1000,
  });
  const pinnedAgain = chooseKnowledgeDedupe([oldPin], {
    taskId: 'ai-research:conv:turn:claim',
    contentHash: oldPin.contentHash || '',
    fingerprint: oldPin.fingerprint,
    nowMs: now,
    action: 'pin',
  });
  assert.equal(pinnedAgain?.id, 'pin');

  const monthsLater = chooseKnowledgeDedupe([recent], {
    taskId: 'task-c',
    contentHash: recent.contentHash || '',
    fingerprint: recent.fingerprint,
    nowMs: now + KNOWLEDGE_DEDUPE_WINDOW_MS + 5_000,
    action: 'select',
  });
  assert.equal(monthsLater, null);
});

test('style preferences follow marketing choices and skip research citations', () => {
  assert.equal(shouldUpdateStylePreferences('social-post', 'select'), true);
  assert.equal(shouldUpdateStylePreferences('social-post', 'approve'), true);
  assert.equal(shouldUpdateStylePreferences('video-script', 'publish'), true);
  assert.equal(shouldUpdateStylePreferences('article-market-news', 'complete'), false);
  assert.equal(shouldUpdateStylePreferences('market-research', 'complete'), false);
  assert.equal(shouldUpdateStylePreferences('ai-research', 'pin'), false);
  assert.equal(qualityScoreForAction('select') < qualityScoreForAction('approve'), true);
  assert.equal(qualityScoreForAction('publish'), 1);
  assert.equal(qualityScoreForAction('pin'), 1);
});

test('approve reads the primary social option and ignores an empty draft', () => {
  const option = primarySocialPostOutput(JSON.stringify({
    options: [{ caption: 'Approved caption', hook: 'Hook' }, { caption: 'Other' }],
  }));
  assert.deepEqual(option, { caption: 'Approved caption', hook: 'Hook' });
  assert.equal(primarySocialPostOutput('{"options":[]}'), null);
  assert.equal(primarySocialPostOutput(''), null);
});

test('completed generators produce knowledge text only when there is a real result', () => {
  assert.equal(summarizeVideoScriptKnowledge({ fullScript: 'short' }), null);
  assert.match(summarizeVideoScriptKnowledge({
    styleLabel: 'Bold',
    hook: 'Open',
    fullScript: 'This finished script is long enough to teach the next generation.',
  }) || '', /finished script/);

  assert.equal(summarizeEventPlanKnowledge({ eventName: 'Summit', options: [{ concept: '' }] }), null);
  assert.match(summarizeEventPlanKnowledge({
    eventName: 'Dupoin Summit',
    location: 'Jakarta',
    options: [{ styleLabel: 'Professional', concept: 'A credible one-day forum for active traders.' }],
  })?.selectedOutput || '', /Jakarta/);

  assert.equal(summarizeMarketResearchKnowledge({ brief: 'emas', items: [] }), null);
  const report = summarizeMarketResearchKnowledge({
    brief: 'emas',
    researchDate: '2026-09-25',
    items: [{ articleTitle: 'Gold rises', newsSource: 'Reuters', mainEvent: 'Spot gold rose.', articleUrl: 'https://www.reuters.com/markets/gold' }],
  });
  assert.match(report?.selectedOutput || '', /Gold rises/);
  assert.deepEqual(report?.sourceUrls, ['https://www.reuters.com/markets/gold']);

  assert.equal(summarizeArticleKnowledge({ title: 'X', articleMarkdown: 'too short' }), null);
  const article = summarizeArticleKnowledge({
    keyword: 'emas',
    title: 'Harga emas hari ini',
    articleMarkdown: 'Artikel ini cukup panjang untuk disimpan sebagai pengetahuan organisasi bagi tim marketing.',
    sourceUrls: ['https://www.kontan.co.id/news/emas', 'javascript:alert(1)'],
  });
  assert.match(article?.selectedOutput || '', /Harga emas hari ini/);
  assert.deepEqual(article?.sourceUrls, ['https://www.kontan.co.id/news/emas']);
});

test('AI Research keeps top cited claims and falls back to one sourced summary', () => {
  assert.equal(shouldPersistResearchAnswer('too short', false), false);
  assert.equal(shouldPersistResearchAnswer('This completed answer is long enough to store as knowledge.', true), false);
  assert.equal(AUTO_RESEARCH_CLAIM_LIMIT, 3);

  const cited = [
    '- Harga emas menguat menurut liputan pasar. [Reuters](https://www.reuters.com/markets/gold)',
    '- Rupiah melemah menurut data harian. [CNBC](https://www.cnbcindonesia.com/market/rupiah)',
    '- Minyak naik setelah stok turun. [Kontan](https://www.kontan.co.id/news/minyak)',
    '- Indeks menguat di penutupan. [Bisnis](https://www.bisnis.com/market/indeks)',
    '- Ini hanya opini internal tanpa sumber sama sekali.',
  ].join('\n');
  const claims = selectResearchKnowledgePieces({
    answer: cited,
    query: 'market wrap',
    sources: [{ title: 'Reuters', url: 'https://www.reuters.com/markets/gold' }],
  });
  assert.equal(claims.length, 3);
  assert.match(claims[0].text, /Harga emas/);
  assert.equal(claims[3], undefined);

  const summary = selectResearchKnowledgePieces({
    answer: 'A grounded summary of gold prices for Dupoin traders that does not use markdown links but is long enough to keep as organizational knowledge.',
    query: 'gold prices',
    sources: [{ title: 'Reuters', url: 'https://www.reuters.com/markets/gold' }],
  });
  assert.equal(summary.length, 1);
  assert.equal(summary[0].taskKey, 'summary');
  assert.deepEqual(summary[0].sourceUrls, ['https://www.reuters.com/markets/gold']);

  const taskId = researchKnowledgeTaskId('11111111-1111-4111-8111-111111111111', cited, claims[0].taskKey);
  assert.equal(researchKnowledgeTaskId('11111111-1111-4111-8111-111111111111', cited, claims[0].taskKey), taskId);
  assert.notEqual(researchKnowledgeTaskId('11111111-1111-4111-8111-111111111111', `${cited}\nchanged`, claims[0].taskKey), taskId);
});

test('internal knowledge context cites approved knowledge ahead of public evidence rules', () => {
  assert.equal(formatInternalKnowledgeContext([]), '');
  const block = formatInternalKnowledgeContext([
    {
      task_type: 'social-post',
      platform: 'Instagram',
      brief: 'Edukasi risk management',
      selected_output: 'Kelola risiko sebelum membuka posisi.',
      source_urls: JSON.stringify(['https://www.dupoin.co.id/about-us']),
    },
  ]);
  assert.match(block, new RegExp(INTERNAL_KNOWLEDGE_GRAPH_HEADER));
  assert.match(block, /internal knowledge/);
  assert.match(block, /public web evidence with citations/);
  assert.match(block, /Dupoin/);
  assert.match(block, /Bappebti/);
  assert.match(block, /https:\/\/www\.dupoin\.co\.id\/about-us/);
  assert.match(block, /Kelola risiko sebelum membuka posisi/);
});

test('approve, research, and generator routes persist and read knowledge', () => {
  const status = read('src/app/api/social-post/status/route.ts');
  const chat = read('src/app/api/ai-research/chat/route.ts');
  const eventPlan = read('src/app/api/event-plan/generate/route.ts');
  const video = read('src/app/api/video-script/generate/route.ts');
  const market = read('src/app/api/market-research/generate/route.ts');
  const article = read('src/app/api/article-market-news/generate/route.ts');
  const save = read('src/app/api/knowledge/save/route.ts');
  const migration = read('db/migrations/019_knowledge_entry_dedupe.sql');

  assert.match(status, /if \(status === 'approved' \|\| status === 'published'\)/);
  assert.match(status, /persistKnowledgeQuietly/);
  assert.match(status, /primarySocialPostOutput/);
  assert.doesNotMatch(status, /persistKnowledgeQuietly\([\s\S]{0,200}draft/);

  assert.match(chat, /const knowledgeContext = await fetchKnowledgeContext\(auth\.id, query, undefined, 5, 'internal'\)/);
  assert.match(chat, /persistCompletedResearchAnswer/);
  assert.match(chat, /request\.signal\.aborted/);
  assert.ok(chat.indexOf('const knowledgeContext') < chat.indexOf('buildAiResearchChatMessages({'));

  assert.match(eventPlan, /fetchKnowledgeContext\(/);
  assert.match(eventPlan, /persistKnowledgeQuietly/);
  assert.match(eventPlan, /summarizeEventPlanKnowledge/);
  assert.match(video, /persistKnowledgeQuietly/);
  assert.match(video, /summarizeVideoScriptKnowledge\(finalOption\)/);
  assert.match(video, /Video Script:[\s\S]*summarizeVideoScriptKnowledge\(finalOption\)/);
  assert.match(market, /fetchKnowledgeContext\(userId, `\$\{input\.brief\} \$\{input\.researchDate\}`, undefined, 5, 'internal'\)/);
  assert.match(market, /persistKnowledgeQuietly/);
  assert.match(market, /follow the candidate evidence contract/i);
  assert.match(article, /fetchKnowledgeContext\(/);
  assert.match(article, /fetchStyleContext\(auth\.id, 'article-market-news'\)/);
  assert.match(article, /persistKnowledgeQuietly/);
  assert.match(save, /persistKnowledgeEntry/);
  assert.match(save, /updateStylePreferences: false/);
  assert.match(save, /if \(!persisted\.deduped\)/);
  assert.match(save, /taskType: analysisFeature/);

  const graph = read('src/app/dashboard/knowledge-graph/page.tsx');
  assert.match(graph, /Selections, approvals, and research/);
  assert.match(graph, /grounded AI Research claims/);
  assert.match(graph, /Drafts, failed runs, and aborted answers stay out/);
  assert.match(graph, /More records do not imply better quality/);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS task_id/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS content_hash/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.ok(KNOWLEDGE_TASK_TYPES.includes('ai-research'));
  assert.ok(KNOWLEDGE_TASK_TYPES.includes('market-research'));
});
