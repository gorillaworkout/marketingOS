/**
 * Rewrite stored local embeddings to the current width.
 * Safe to re-run. Does not call an external embedding API.
 *
 *   npx tsx scripts/reembed-knowledge.ts
 */
import 'dotenv/config';
import { closeDb, execute, queryAll } from '../src/lib/database';
import {
  EMBEDDING_DIM,
  embeddingNeedsRefresh,
  getEmbedding,
  knowledgeEmbeddingInput,
  parseStoredEmbedding,
} from '../src/lib/embeddings';

async function reembedKnowledgeEntries(): Promise<number> {
  const rows = await queryAll<{
    id: string;
    user_id: string;
    task_type: string;
    brief: string | null;
    selected_output: string | null;
    embedding: string | null;
  }>('SELECT id, user_id, task_type, brief, selected_output, embedding FROM knowledge_entries');
  let updated = 0;
  for (const row of rows) {
    const current = parseStoredEmbedding(row.embedding);
    if (current && !embeddingNeedsRefresh(current)) continue;
    const text = knowledgeEmbeddingInput(row.task_type, row.brief || '', row.selected_output || '');
    if (!text.trim()) continue;
    const next = await getEmbedding(text);
    await execute(
      'UPDATE knowledge_entries SET embedding = ? WHERE id = ? AND user_id = ?',
      [JSON.stringify(next), row.id, row.user_id],
    );
    updated += 1;
  }
  return updated;
}

async function reembedTextTable(label: string, sql: string, updateSql: string): Promise<number> {
  try {
    const rows = await queryAll<{ id: string; user_id?: string; text: string; embedding: string | null }>(sql);
    let updated = 0;
    for (const row of rows) {
      const current = parseStoredEmbedding(row.embedding);
      if (current && !embeddingNeedsRefresh(current)) continue;
      if (!row.text?.trim()) continue;
      const next = await getEmbedding(row.text);
      if (updateSql.includes('user_id')) {
        await execute(updateSql, [JSON.stringify(next), row.id, row.user_id]);
      } else {
        await execute(updateSql, [JSON.stringify(next), row.id]);
      }
      updated += 1;
    }
    console.log(`Re-embedded ${updated} ${label} rows.`);
    return updated;
  } catch (error) {
    console.warn(`Skipped ${label}:`, error instanceof Error ? error.message : error);
    return 0;
  }
}

async function main() {
  const knowledge = await reembedKnowledgeEntries();
  console.log(`Re-embedded ${knowledge} knowledge entries at ${EMBEDDING_DIM} dimensions.`);
  await reembedTextTable(
    'user memory',
    'SELECT id, user_id, content AS text, embedding FROM user_memories',
    'UPDATE user_memories SET embedding = ? WHERE id = ? AND user_id = ?',
  );
  await reembedTextTable(
    'research Q&A',
    `SELECT id, user_id, (question || ' ' || answer_summary) AS text, embedding FROM ai_research_qa_index`,
    'UPDATE ai_research_qa_index SET embedding = ? WHERE id = ? AND user_id = ?',
  );
  await reembedTextTable(
    'internal document chunk',
    'SELECT id, content AS text, embedding FROM internal_document_chunks',
    'UPDATE internal_document_chunks SET embedding = ? WHERE id = ?',
  );
}

main().then(closeDb).catch(async error => {
  console.error(error);
  await closeDb();
  process.exitCode = 1;
});
