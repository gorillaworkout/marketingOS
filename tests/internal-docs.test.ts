import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  allowedAccessLevels,
  canManageInternalDocs,
  canReadItOnlyInternalDocs,
  isInternalDocVisible,
} from '../src/lib/internal-docs-acl';
import { getEmbedding } from '../src/lib/embeddings';
import { normalizeInspectorSource } from '../src/lib/ai-research-inspector';
import {
  buildInternalDocChunkQuery,
  buildInternalDocsListQuery,
  chunkDocumentText,
  citationsFromHits,
  formatInternalDocsPrompt,
  INTERNAL_DOCS_NO_MATCH_ANSWER,
  mergeInternalDocSources,
  rankInternalDocChunks,
  type InternalDocChunkRow,
  type InternalDocHit,
} from '../src/lib/internal-docs';
import { extractPlainText } from '../src/lib/internal-docs-extract';
import { internalDocKnowledgePayload } from '../src/lib/internal-docs-knowledge';
import { internalDocKind, resolveStoredInternalDoc, titleFromFilename } from '../src/lib/internal-docs-storage';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

const company = { role: 'member', departmentName: 'Marketing' };
const itMember = { role: 'member', departmentName: 'IT' };
const admin = { role: 'admin', departmentName: null };
const settlement = { role: 'member', departmentName: 'Settlement' };

test('IT department members and admins can read IT-only docs; other employees cannot', () => {
  assert.equal(canReadItOnlyInternalDocs(company), false);
  assert.equal(canReadItOnlyInternalDocs(settlement), false);
  assert.equal(canReadItOnlyInternalDocs({ role: 'member', departmentName: null }), false);
  assert.equal(canReadItOnlyInternalDocs(itMember), true);
  assert.equal(canReadItOnlyInternalDocs({ role: 'member', departmentName: ' it ' }), true);
  assert.equal(canReadItOnlyInternalDocs(admin), true);
  assert.equal(canManageInternalDocs(itMember), false);
  assert.equal(canManageInternalDocs({ role: 'member', departmentName: ' it ' }), false);
  assert.equal(canManageInternalDocs(company), false);
  assert.equal(canManageInternalDocs(admin), true);
  assert.deepEqual(allowedAccessLevels(company), ['company']);
  assert.deepEqual(allowedAccessLevels(itMember), ['company', 'it-only']);
  assert.equal(isInternalDocVisible('it-only', company), false);
  assert.equal(isInternalDocVisible('it-only', admin), true);
  assert.equal(isInternalDocVisible('company', company), true);
  assert.equal(isInternalDocVisible('secret', admin), false);
});

test('list and chunk queries always bind the caller access levels and stay off the knowledge graph', () => {
  const list = buildInternalDocsListQuery({ accessLevels: allowedAccessLevels(company), includeUnindexed: false, search: 'vpn_setup' });
  assert.match(list.sql, /FROM internal_documents/);
  assert.match(list.sql, /access_level = ANY\(\?::text\[\]\)/);
  assert.doesNotMatch(list.sql, /knowledge_entries/);
  assert.deepEqual(list.params[2], ['company']);
  assert.equal(list.params[3], false);
  assert.equal(list.params[5], '%vpn\\_setup%');

  const itList = buildInternalDocsListQuery({ accessLevels: allowedAccessLevels(itMember), includeUnindexed: true, search: '' });
  assert.deepEqual(itList.params[2], ['company', 'it-only']);

  const chunks = buildInternalDocChunkQuery();
  assert.match(chunks.sql, /FROM internal_document_chunks/);
  assert.match(chunks.sql, /JOIN internal_documents/);
  assert.match(chunks.sql, /access_level = ANY\(\?::text\[\]\)/);
  assert.match(chunks.sql, /status = 'indexed'/);
  assert.doesNotMatch(chunks.sql, /knowledge_entries/);
});

test('ranking drops IT-only chunks for a company employee even if they were loaded', async () => {
  const query = 'badge printer password reset';
  const embedding = await getEmbedding(query);
  const companyChunk: InternalDocChunkRow = {
    chunk_id: 'c1',
    document_id: 'doc-company',
    title: 'Office badge printer',
    access_level: 'company',
    content: 'The badge printer password reset code is stored with reception.',
    embedding: JSON.stringify(await getEmbedding('badge printer password reset reception')),
  };
  const secretChunk: InternalDocChunkRow = {
    chunk_id: 'c2',
    document_id: 'doc-it',
    title: 'IT root credentials',
    access_level: 'it-only',
    content: 'badge printer password reset root key is only for IT.',
    embedding: JSON.stringify(await getEmbedding('badge printer password reset root key IT')),
  };

  const companyHits = rankInternalDocChunks(query, embedding, [secretChunk, companyChunk], company, 5);
  assert.deepEqual(companyHits.map(hit => hit.documentId), ['doc-company']);
  assert.equal(companyHits.some(hit => /root credentials|IT-only|root key/i.test(`${hit.title} ${hit.excerpt}`)), false);

  const itHits = rankInternalDocChunks(query, embedding, [secretChunk, companyChunk], itMember, 5);
  assert.ok(itHits.some(hit => hit.documentId === 'doc-it'));
  assert.ok(itHits.some(hit => hit.documentId === 'doc-company'));
});

test('prompt and research citations include only the hits passed in, with document links', () => {
  const hits: InternalDocHit[] = [{
    documentId: '11111111-1111-1111-1111-111111111111',
    title: 'Visitor wifi',
    accessLevel: 'company',
    chunkId: 'chunk-1',
    excerpt: 'The visitor wifi password is printed at reception.',
    score: 0.8,
  }];
  const prompt = formatInternalDocsPrompt(hits, 'https://marketing.example');
  assert.match(prompt, /FAQ & GUIDES/);
  assert.match(prompt, /Visitor wifi/);
  assert.match(prompt, /https:\/\/marketing\.example\/dashboard\/internal-docs\/11111111-1111-1111-1111-111111111111/);
  assert.equal(formatInternalDocsPrompt([], 'https://marketing.example'), '');

  const citations = citationsFromHits(hits, 'https://marketing.example');
  assert.equal(citations.length, 1);
  assert.match(citations[0].url, /\/dashboard\/internal-docs\//);

  const payload = internalDocKnowledgePayload({
    documentId: hits[0].documentId,
    title: hits[0].title,
    accessLevel: 'it-only',
    text: hits[0].excerpt,
  });
  assert.equal(payload?.taskType, 'internal-docs');
  assert.equal(payload?.taskId, hits[0].documentId);
  assert.equal(payload?.audience, 'it-only');
  assert.equal(payload?.updateStylePreferences, false);
  assert.match(payload?.brief || '', /Visitor wifi/);
  assert.equal(internalDocKnowledgePayload({
    documentId: 'short',
    title: 'Visitor wifi',
    accessLevel: 'company',
    text: hits[0].excerpt,
  }), null);
  assert.equal(internalDocKnowledgePayload({
    documentId: hits[0].documentId,
    title: 'Visitor wifi',
    accessLevel: 'secret',
    text: hits[0].excerpt,
  }), null);

  const merged = mergeInternalDocSources({
    type: 'research',
    sourceCount: 0,
    grounding: 'empty',
    sources: [],
  }, hits, 'https://marketing.example');
  assert.equal(merged.grounding, 'ok');
  assert.equal(merged.sources[0].originChip, 'internal');
  assert.equal(merged.sources[0].title, 'FAQ & Guides: Visitor wifi');
  assert.equal(normalizeInspectorSource(merged.sources[0])?.originChip, 'internal');
  assert.equal(INTERNAL_DOCS_NO_MATCH_ANSWER.includes('you can access'), true);
});

test('plain text extraction, chunking, file kinds, and storage paths stay private', () => {
  const text = extractPlainText(new TextEncoder().encode('# Leave policy\n\nEmployees request leave in writing.'));
  assert.match(text, /Leave policy/);
  const chunks = chunkDocumentText(`${'Alpha policy. '.repeat(80)}\n\n${'Beta policy. '.repeat(80)}`);
  assert.ok(chunks.length >= 2);
  assert.equal(internalDocKind('handbook.pdf', 'application/octet-stream')?.ext, '.pdf');
  assert.equal(internalDocKind('notes.docx', '')?.ext, '.docx');
  assert.equal(internalDocKind('readme.md', 'text/plain')?.ext, '.md');
  assert.equal(internalDocKind('photo.png', 'image/png'), null);
  assert.equal(titleFromFilename('it-runbook.md'), 'it runbook');
  assert.equal(resolveStoredInternalDoc('../secrets.txt'), null);
  assert.equal(resolveStoredInternalDoc('notes.exe'), null);
  assert.ok(resolveStoredInternalDoc('11111111-1111-1111-1111-111111111111.pdf')?.endsWith('11111111-1111-1111-1111-111111111111.pdf'));
});

test('sidebar, routes, migration, and AI Research keep Internal Docs ACL separate from the knowledge graph', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  const migration = read('db/migrations/020_internal_documents.sql');
  const chat = read('src/app/api/ai-research/chat/route.ts');
  const ask = read('src/app/api/internal-docs/ask/route.ts');
  const listRoute = read('src/app/api/internal-docs/route.ts');

  assert.match(layout, /href: '\/dashboard\/internal-docs', label: 'FAQ & Guides', icon: 'docs', feature: 'internal-docs' \}/);
  const sections = layout.slice(layout.indexOf('const sections'));
  assert.ok(sections.indexOf("label: 'FAQ & Guides'") < sections.indexOf("label: 'Overview'"));
  assert.doesNotMatch(layout.slice(layout.indexOf('const resourceItems'), layout.indexOf('export default')), /internal-docs/);
  assert.doesNotMatch(layout, /href: '\/dashboard\/internal-docs'[^}\n]*adminOnly/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS internal_documents/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS internal_document_chunks/);
  assert.match(migration, /'IT'/);
  assert.match(migration, /it-only/);
  const executable = migration.replace(/--.*$/gm, '');
  assert.doesNotMatch(executable, /knowledge_entries/);
  assert.doesNotMatch(executable, /\bDELETE FROM\b|\bDROP TABLE\b|\bTRUNCATE\b/i);
  assert.match(executable, /ON DELETE CASCADE/);

  assert.match(chat, /canAccessFeature\(auth, 'internal-docs'\)/);
  assert.match(chat, /retrieveInternalDocHits\(internalDocsPrincipal, query\)/);
  assert.match(chat, /departmentName: auth\.departmentName/);
  assert.match(chat, /formatInternalDocsPrompt\(internalDocHits/);
  assert.match(chat, /mergeInternalDocSources\(researchEvent, internalDocHits/);
  assert.match(chat, /const knowledgeContext = await fetchKnowledgeContext\(auth\.id, query, undefined, 5, 'internal'\)/);
  assert.match(chat, /sources: researchEvent\.sources/);
  assert.ok(chat.indexOf('const knowledgeContext') < chat.indexOf('buildAiResearchChatMessages({'));

  assert.match(ask, /retrieveInternalDocHits\(actor\.principal, question\)/);
  assert.match(ask, /withCitationMedia/);
  assert.match(read('src/lib/internal-docs.ts'), /persistInternalDocKnowledge/);
  assert.match(read('src/app/api/internal-docs/[id]/reindex/route.ts'), /persistInternalDocKnowledge/);
  assert.match(read('src/app/api/internal-docs/[id]/route.ts'), /deleteInternalDocKnowledge/);
  assert.match(read('src/app/api/internal-docs/[id]/route.ts'), /syncInternalDocKnowledgeMeta/);
  const knowledge = read('src/lib/internal-docs-knowledge.ts');
  assert.match(knowledge, /DELETE FROM knowledge_edges/);
  assert.match(knowledge, /upsertTask: true/);
  assert.match(knowledge, /updateStylePreferences: false/);
  assert.match(listRoute, /listInternalDocuments\(actor\.principal/);
  assert.match(listRoute, /requireInternalDocsManager/);

  const access = read('src/lib/internal-docs-access.ts');
  assert.match(access, /requireFeature\(request, INTERNAL_DOCS_FEATURE\)/);
  assert.match(access, /only admins can manage FAQ & Guides/);
  assert.doesNotMatch(access, /only IT and admins/);
  assert.match(read('src/lib/auth.ts'), /ACCOUNT_FEATURE_LABELS\[feature\]/);
  assert.match(read('src/components/AiResearchSourcesPanel.tsx'), /internal: 'FAQ & Guides'/);
  const workspace = read('src/app/dashboard/internal-docs/InternalDocsWorkspace.tsx');
  assert.match(workspace, /title="FAQ & Guides"/);
  assert.match(workspace, /No guides yet/);
  assert.doesNotMatch(workspace, /Internal Docs/);
  assert.equal(read('src/lib/authorization.ts').includes("'internal-docs': 'FAQ & Guides'"), true);
  const accounts = read('src/app/dashboard/accounts/AccountsClient.tsx');
  assert.match(accounts, /ACCOUNT_FEATURE_LABELS\[feature\]/);
  assert.match(accounts, /ACCOUNT_FEATURES/);
  const departmentsApi = read('src/app/api/admin/departments/route.ts');
  assert.match(departmentsApi, /isAccountFeature/);
  const imageRoute = read('src/app/api/generate-image/route.ts');
  assert.match(imageRoute, /hasGenerationFeature\(auth\)/);
  assert.doesNotMatch(imageRoute, /features\.length === 0/);

  const featureMigration = read('db/migrations/021_internal_docs_feature.sql');
  const featureSql = featureMigration.replace(/--.*$/gm, '');
  assert.match(featureMigration, /DROP CONSTRAINT IF EXISTS departments_permitted_features_valid/);
  assert.match(featureMigration, /'internal-docs'/);
  assert.match(featureMigration, /WHERE NOT \(permitted_features @> ARRAY\['internal-docs'\]::text\[\]\)/);
  assert.doesNotMatch(featureSql, /\bDELETE FROM\b|\bDROP TABLE\b|\bTRUNCATE\b/i);
  assert.doesNotMatch(featureSql, /knowledge_entries/);
});
