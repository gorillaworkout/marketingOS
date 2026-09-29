import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FaqGuideCards } from '../src/app/dashboard/internal-docs/FaqGuideCards';
import { FaqCardSkeleton } from '../src/app/dashboard/internal-docs/FaqFeedback';
import { citationFileLink } from '../src/app/dashboard/internal-docs/FaqAskPanel';
import {
  allowedAccessLevels,
  type InternalDocsPrincipal,
} from '../src/lib/internal-docs-acl';
import {
  faqAskRequestBody,
  guideCardAsk,
  guideCardSummary,
  guideOverviewQuestion,
  parseGuideDocumentId,
  visibleGuideCards,
} from '../src/lib/internal-docs-cards';
import {
  buildInternalDocChunkQuery,
  buildInternalDocsListQuery,
  citationsFromHits,
  internalDocsAskFallback,
  overviewHitsFromChunks,
  publicDocument,
  resolveInternalDocsAskPlan,
  type InternalDocChunkRow,
  type InternalDocHit,
  type InternalDocListRow,
} from '../src/lib/internal-docs';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

const company: InternalDocsPrincipal = { role: 'member', departmentName: 'Marketing' };
const itMember: InternalDocsPrincipal = { role: 'member', departmentName: 'IT' };

const rows = [
  { id: 'doc-wifi', title: 'Visitor wifi', access_level: 'company', status: 'indexed', card_summary: 'Password at reception.', file_ext: '.pdf' },
  { id: 'doc-badge', title: 'Badge printer', access_level: 'company', status: 'indexed', card_summary: 'Reset the badge printer at reception.', file_ext: '.docx' },
  { id: 'doc-vault', title: 'IT vault', access_level: 'it-only', status: 'indexed', card_summary: 'Root key for administrators.', file_ext: '.pdf' },
  { id: 'doc-failed', title: 'Broken upload', access_level: 'company', status: 'failed', card_summary: 'Should stay off the grid.', file_ext: '.txt' },
  { id: 'doc-secret', title: 'Hidden', access_level: 'secret', status: 'indexed', card_summary: 'Not a real access level.', file_ext: '.pdf' },
];

function listRow(summary: string): InternalDocListRow {
  return {
    id: 'doc-wifi',
    title: 'Visitor wifi',
    original_name: 'visitor-wifi.pdf',
    mime_type: 'application/pdf',
    file_ext: '.pdf',
    file_size: 12,
    access_level: 'company',
    status: 'indexed',
    error_message: null,
    created_at: '2026-09-29T00:00:00.000Z',
    updated_at: '2026-09-29T00:00:00.000Z',
    snippet: '',
    card_summary: summary,
  };
}

test('guide cards show one indexed document per visible row and hide IT-only guides from other employees', () => {
  const companyCards = visibleGuideCards(rows, company);
  const itCards = visibleGuideCards(rows, itMember);
  assert.deepEqual(companyCards.map(card => card.id), ['doc-wifi', 'doc-badge']);
  assert.deepEqual(itCards.map(card => card.id), ['doc-wifi', 'doc-badge', 'doc-vault']);
  assert.equal(companyCards.some(card => /vault|root key|Hidden/i.test(`${card.title} ${card.summary}`)), false);
  assert.equal(companyCards[0]?.summary, 'Password at reception.');

  const list = buildInternalDocsListQuery({
    accessLevels: allowedAccessLevels(company),
    includeUnindexed: false,
    search: '',
  });
  assert.match(list.sql, /card_summary/);
  assert.match(list.sql, /access_level = ANY\(\?::text\[\]\)/);
  assert.deepEqual(list.params[2], ['company']);
  assert.equal(publicDocument(listRow('  Password   at reception.  ')).summary, 'Password at reception.');

  const html = renderToStaticMarkup(createElement(FaqGuideCards, {
    documents: [
      { id: 'doc-wifi', title: 'Visitor wifi', summary: 'Password at reception.', extension: '.pdf', status: 'indexed' },
      { id: 'doc-badge', title: 'Badge printer', summary: 'Reset the badge printer at reception.', extension: '.docx', status: 'indexed' },
      { id: 'doc-failed', title: 'Broken upload', summary: 'Should stay off the grid.', extension: '.txt', status: 'failed' },
    ],
    loading: false,
    error: '',
    search: '',
    asking: false,
    askingId: '',
    onAsk: () => undefined,
  }));
  assert.equal((html.match(/data-testid="faq-guide-card"/g) || []).length, 2);
  assert.match(html, /Visitor wifi/);
  assert.match(html, /Password at reception/);
  assert.match(html, /Badge printer/);
  assert.match(html, />PDF</);
  assert.match(html, />DOCX</);
  assert.doesNotMatch(html, /Broken upload/);
  assert.doesNotMatch(html, /IT vault/);

  const empty = renderToStaticMarkup(createElement(FaqGuideCards, {
    documents: [],
    loading: false,
    error: '',
    search: '',
    asking: false,
    askingId: '',
    onAsk: () => undefined,
  }));
  assert.match(empty, /data-testid="faq-guide-cards-empty"/);
  assert.match(empty, /No guides yet/);
  assert.match(empty, /Guides you can read will appear here/);

  const loading = renderToStaticMarkup(createElement(FaqCardSkeleton));
  assert.match(loading, /data-testid="faq-guide-cards-loading"/);
  assert.match(loading, /Loading guides/);
  assert.match(loading, /animate-spin/);
  assert.match(loading, /role="status"/);
});

test('choosing a guide card asks what it covers and keeps the Open PDF citation', () => {
  assert.equal(guideOverviewQuestion('Visitor wifi'), 'What does Visitor wifi cover?');
  assert.deepEqual(guideCardAsk({ id: 'doc-wifi', title: 'Visitor wifi' }), {
    question: 'What does Visitor wifi cover?',
    documentId: 'doc-wifi',
  });
  const typed = faqAskRequestBody({
    question: 'Where is the visitor wifi password?',
    history: [],
  });
  assert.equal(typed.documentId, undefined);
  assert.equal(typed.question, 'Where is the visitor wifi password?');
  const chosen = faqAskRequestBody({
    question: guideCardAsk({ id: 'doc-wifi', title: 'Visitor wifi' }).question,
    history: [{ role: 'user', content: 'earlier' }],
    documentId: 'doc-wifi',
  });
  assert.equal(chosen.documentId, 'doc-wifi');
  assert.equal(chosen.question, 'What does Visitor wifi cover?');
  assert.equal(parseGuideDocumentId('../secrets'), '');
  assert.equal(parseGuideDocumentId('doc wifi'), '');

  const hit: InternalDocHit = {
    documentId: 'doc-wifi',
    title: 'Visitor wifi',
    accessLevel: 'company',
    chunkId: 'chunk-1',
    excerpt: 'The visitor wifi password is printed at reception.',
    score: 2,
    matchedTerms: ['visitor', 'wifi'],
    subjectMatched: true,
  };
  assert.equal(internalDocsAskFallback('What does Visitor wifi cover?', [hit])?.confidence, 'low');
  assert.equal(resolveInternalDocsAskPlan('What does Visitor wifi cover?', [hit], 'doc-wifi'), null);
  assert.equal(resolveInternalDocsAskPlan('What does Visitor wifi cover?', [hit], 'doc-vault')?.confidence, 'none');
  assert.equal(resolveInternalDocsAskPlan('Where is the visitor wifi password?', [])?.confidence, 'none');

  const chunks: InternalDocChunkRow[] = [
    {
      chunk_id: 'vault',
      document_id: 'doc-vault',
      title: 'IT vault',
      access_level: 'it-only',
      content: 'The vault root key is for IT only.',
      embedding: null,
    },
    {
      chunk_id: 'wifi',
      document_id: 'doc-wifi',
      title: 'Visitor wifi',
      access_level: 'company',
      content: 'The visitor wifi password is printed at reception. Guests use Dupoin-Guest.',
      embedding: null,
    },
  ];
  assert.equal(overviewHitsFromChunks('doc-vault', chunks, company).length, 0);
  const overview = overviewHitsFromChunks('doc-wifi', chunks, company);
  assert.equal(overview[0]?.documentId, 'doc-wifi');
  assert.match(overview[0]?.excerpt || '', /password is printed at reception/);
  const citations = citationsFromHits(overview, 'https://marketing.example');
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.documentId, 'doc-wifi');
  const file = citationFileLink({ documentId: citations[0].documentId, extension: '.pdf' });
  assert.equal(file?.label, 'Open PDF');
  assert.equal(file?.href, '/api/internal-docs/doc-wifi/file?inline=1');

  const scoped = buildInternalDocChunkQuery(['visitor', 'wifi'], 'doc-wifi');
  assert.match(scoped.sql, /c\.document_id = \?/);
  assert.equal(scoped.params[0], 'doc-wifi');
  assert.ok(scoped.sql.indexOf('c.document_id = ?') < scoped.sql.indexOf('ORDER BY'));
  const open = buildInternalDocChunkQuery();
  assert.equal(open.params.length, 0);
  assert.doesNotMatch(open.sql, /c\.document_id = \?/);

  const ask = read('src/app/api/internal-docs/ask/route.ts');
  assert.match(ask, /parseGuideDocumentId\(body\.documentId\)/);
  assert.match(ask, /retrieveInternalDocHits\(actor\.principal, question, INTERNAL_DOCS_ASK_LIMIT, documentId\)/);
  assert.match(ask, /withCitationMedia/);
  assert.ok(ask.indexOf('resolveInternalDocsAskPlan') < ask.indexOf('generateContent'));

  const workspace = read('src/app/dashboard/internal-docs/InternalDocsWorkspace.tsx');
  const askPanel = read('src/app/dashboard/internal-docs/FaqAskPanel.tsx');
  assert.ok(workspace.indexOf('<FaqAskPanel') < workspace.indexOf('<FaqGuideCards'));
  assert.ok(workspace.indexOf('<FaqGuideCards') < workspace.indexOf('data-testid="internal-docs-dropzone"'));
  assert.match(workspace, /onSubmit=\{question => \{ void submitQuestion\(question\); \}\}/);
  assert.match(workspace, /submitQuestion\(request\.question, request\.documentId\)/);
  assert.match(workspace, /faqAskRequestBody\(\{ question: trimmed, history, documentId \}\)/);
  assert.match(askPanel, /aria-label="Ask FAQ & Guides"/);
  assert.match(askPanel, /Open PDF/);
  assert.doesNotMatch(askPanel, /<img|<iframe/);
});

test('card blurbs are stored from the guide opening and refreshed on index', () => {
  const summary = guideCardSummary(
    'Visitor wifi',
    '# Visitor wifi\n\nThe visitor wifi password is printed at reception. Guests connect to Dupoin-Guest and accept the office terms before browsing.',
  );
  assert.match(summary, /^The visitor wifi password is printed at reception\./);
  assert.doesNotMatch(summary, /^#|^Visitor wifi$/);
  assert.ok(summary.length <= 200);

  const long = guideCardSummary('Leave policy', `${'Employees request leave in writing before the first day of absence '.repeat(8)}.`);
  assert.ok(long.length <= 203);
  assert.match(long, /\.\.\.$/);
  assert.doesNotMatch(long, /absence absence absence absence absence/);
  assert.equal(guideCardSummary('Empty', '   \n# Empty\n'), '');

  const migration = read('db/migrations/022_internal_document_card_summary.sql');
  const executable = migration.replace(/--.*$/gm, '');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS card_summary/);
  assert.match(migration, /status = 'indexed'/);
  assert.doesNotMatch(executable, /\bDELETE FROM\b|\bDROP TABLE\b|\bTRUNCATE\b/i);

  const lib = read('src/lib/internal-docs.ts');
  assert.match(lib, /guideCardSummary/);
  assert.match(lib, /SET extracted_text = \?, card_summary = \?/);
  assert.match(lib, /card_summary = ''/);
  assert.ok(lib.indexOf('export async function indexDocumentText') < lib.lastIndexOf('card_summary = ?'));
  assert.match(lib, /return indexDocumentText\(documentId, extracted\)/);
  assert.match(read('src/app/api/internal-docs/[id]/route.ts'), /card_summary = \?/);
  assert.match(read('src/app/api/internal-docs/[id]/reindex/route.ts'), /reindexStoredDocument/);
});
