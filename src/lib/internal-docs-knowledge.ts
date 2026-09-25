import { execute, queryAll } from './database';
import { readClientTaskId, persistKnowledgeQuietly } from './knowledge-persist';

export const INTERNAL_DOC_KNOWLEDGE_TASK = 'internal-docs';

const OUTPUT_CHAR_LIMIT = 8_000;

export function internalDocKnowledgeTaskId(documentId: string): string | null {
  return readClientTaskId(documentId);
}

/** Shape stored for one indexed guide. Audience is the document access level. */
export function internalDocKnowledgePayload(input: {
  documentId: string;
  title: string;
  accessLevel: string;
  text: string;
}): {
  taskType: typeof INTERNAL_DOC_KNOWLEDGE_TASK;
  taskId: string;
  brief: string;
  selectedOutput: string;
  audience: 'company' | 'it-only';
  updateStylePreferences: false;
} | null {
  const taskId = internalDocKnowledgeTaskId(input.documentId);
  if (!taskId) return null;
  if (input.accessLevel !== 'company' && input.accessLevel !== 'it-only') return null;
  const selectedOutput = input.text.replace(/\s+/g, ' ').trim().slice(0, OUTPUT_CHAR_LIMIT);
  if (selectedOutput.length < 8) return null;
  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 180) || 'Guide';
  return {
    taskType: INTERNAL_DOC_KNOWLEDGE_TASK,
    taskId,
    brief: `FAQ & Guides: ${title}`.slice(0, 2_000),
    selectedOutput,
    audience: input.accessLevel,
    updateStylePreferences: false,
  };
}

export async function persistInternalDocKnowledge(input: {
  userId: string;
  documentId: string;
  title: string;
  accessLevel: string;
  text: string;
}): Promise<void> {
  const payload = internalDocKnowledgePayload(input);
  if (!payload || !input.userId) return;
  await persistKnowledgeQuietly({
    userId: input.userId,
    taskType: payload.taskType,
    brief: payload.brief,
    selectedOutput: payload.selectedOutput,
    audience: payload.audience,
    taskId: payload.taskId,
    action: 'complete',
    updateStylePreferences: false,
    upsertTask: true,
  });
}

export async function syncInternalDocKnowledgeMeta(input: {
  documentId: string;
  title: string;
  accessLevel: string;
}): Promise<void> {
  const taskId = internalDocKnowledgeTaskId(input.documentId);
  if (!taskId) return;
  if (input.accessLevel !== 'company' && input.accessLevel !== 'it-only') return;
  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 180) || 'Guide';
  const brief = `FAQ & Guides: ${title}`.slice(0, 2_000);
  await execute(
    `UPDATE knowledge_entries
     SET brief = ?, audience = ?
     WHERE task_type = ? AND task_id = ?`,
    [brief, input.accessLevel, INTERNAL_DOC_KNOWLEDGE_TASK, taskId],
  );
}

/** Remove every user's copy of this guide, including similarity edges. */
export async function deleteInternalDocKnowledge(documentId: string): Promise<void> {
  const taskId = internalDocKnowledgeTaskId(documentId);
  if (!taskId) return;
  const rows = await queryAll<{ id: string }>(
    `SELECT id FROM knowledge_entries WHERE task_type = ? AND task_id = ?`,
    [INTERNAL_DOC_KNOWLEDGE_TASK, taskId],
  );
  if (!rows.length) return;
  const ids = rows.map(row => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  await execute(
    `DELETE FROM knowledge_edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
    [...ids, ...ids],
  );
  await execute(
    `DELETE FROM knowledge_entries WHERE task_type = ? AND task_id = ?`,
    [INTERNAL_DOC_KNOWLEDGE_TASK, taskId],
  );
}
