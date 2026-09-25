import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  KNOWLEDGE_ENTRY_DELETE_SQL,
  KNOWLEDGE_ENTRY_EDGE_DELETE_SQL,
  KNOWLEDGE_ENTRY_TITLE_MAX,
  KNOWLEDGE_ENTRY_TITLE_SQL,
  knowledgeAudienceLabel,
  normalizeKnowledgeEntryId,
  normalizeKnowledgeEntryTitle,
} from '../src/lib/knowledge-graph-entry';

test('knowledge titles trim to a single required line and leave other fields alone', () => {
  assert.deepEqual(normalizeKnowledgeEntryTitle('  Gold   outlook  '), { title: 'Gold outlook' });
  assert.deepEqual(normalizeKnowledgeEntryTitle(''), { error: 'Title is required.' });
  assert.deepEqual(normalizeKnowledgeEntryTitle('   '), { error: 'Title is required.' });
  assert.deepEqual(normalizeKnowledgeEntryTitle(null), { error: 'Title is required.' });
  assert.deepEqual(normalizeKnowledgeEntryTitle('a'.repeat(KNOWLEDGE_ENTRY_TITLE_MAX + 1)), { error: 'Title is too long.' });
  assert.equal(KNOWLEDGE_ENTRY_TITLE_SQL, 'UPDATE knowledge_entries SET brief = ? WHERE id = ?');
  assert.doesNotMatch(KNOWLEDGE_ENTRY_TITLE_SQL, /audience|selected_output|task_type|embedding/);
});

test('deleting one knowledge entry removes its edges and not the table', () => {
  assert.match(KNOWLEDGE_ENTRY_EDGE_DELETE_SQL, /DELETE FROM knowledge_edges WHERE source_id = \? OR target_id = \?/);
  assert.equal(KNOWLEDGE_ENTRY_DELETE_SQL, 'DELETE FROM knowledge_entries WHERE id = ?');
  assert.doesNotMatch(KNOWLEDGE_ENTRY_DELETE_SQL, /DELETE FROM knowledge_entries(?! WHERE)/);
  assert.deepEqual(normalizeKnowledgeEntryId('abc12345'), { id: 'abc12345' });
  assert.equal('error' in normalizeKnowledgeEntryId('short'), true);
  assert.equal('error' in normalizeKnowledgeEntryId('../etc'), true);
});

test('audience labels stay read-only and keep company and IT access wording', () => {
  assert.equal(knowledgeAudienceLabel('company'), 'Company');
  assert.equal(knowledgeAudienceLabel('it-only'), 'IT-only');
  assert.equal(knowledgeAudienceLabel('retail traders'), 'retail traders');
  assert.equal(knowledgeAudienceLabel('  '), '');
});

test('knowledge graph edit and delete are admin-only and confirmed in the panel', async () => {
  const [route, page, actions] = await Promise.all([
    readFile('src/app/api/admin/knowledge-graph/entries/[id]/route.ts', 'utf8'),
    readFile('src/app/dashboard/knowledge-graph/page.tsx', 'utf8'),
    readFile('src/app/dashboard/knowledge-graph/KnowledgeEntryActions.tsx', 'utf8'),
  ]);
  assert.match(route, /requireAdmin/);
  assert.match(route, /KNOWLEDGE_ENTRY_TITLE_SQL/);
  assert.match(route, /KNOWLEDGE_ENTRY_EDGE_DELETE_SQL/);
  assert.match(route, /KNOWLEDGE_ENTRY_DELETE_SQL/);
  assert.match(route, /executeTransaction/);
  assert.doesNotMatch(route, /SET audience|SET selected_output|DELETE FROM knowledge_entries(?! WHERE)/);
  assert.match(page, /KnowledgeEntryActions/);
  assert.match(actions, /normalizeKnowledgeEntryTitle/);
  assert.match(actions, /Edit title/);
  assert.match(actions, /Save title/);
  assert.match(actions, /Delete entry/);
  assert.match(actions, /Delete this knowledge entry\?/);
  assert.match(actions, /This cannot be undone/);
  assert.doesNotMatch(`${page}\n${actions}`, /Hapus|Ubah judul|judul/);
});
