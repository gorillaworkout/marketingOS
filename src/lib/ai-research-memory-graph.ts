/**
 * Mirror AI Research memory and Q&A into the per-user knowledge graph.
 * Dedicated tables stay the fast lookup. knowledge_entries is the graph copy.
 * Every read and write is scoped by user_id.
 */

import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne, type DatabaseTransaction } from './database';
import { cosineSimilarity, getEmbedding, parseStoredEmbedding } from './embeddings';
import { AI_RESEARCH_QA_TASK_TYPE, USER_MEMORY_TASK_TYPE } from './knowledge-task-types';

export const MEMORY_FACT_EDGE = 'learned_from';
export const SIMILAR_QA_EDGE = 'similar_question';
export const QA_LINK_SCORE = 0.6;

const KIND_LABEL: Record<string, string> = {
  role: 'Role',
  interest: 'Interest',
  preference: 'Preference',
  style: 'Style',
  context: 'Context',
};

export interface GraphNode {
  id: string;
  userId: string;
  taskType: string;
  taskId: string | null;
  brief: string;
  selectedOutput: string;
  conversationId: string | null;
  embedding: number[] | null;
}

export interface PlannedEdge {
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
}

export interface MemoryGraphStore {
  findByTask(userId: string, taskType: string, taskId: string): Promise<GraphNode | null>;
  save(node: GraphNode): Promise<void>;
  listForUser(userId: string, taskTypes: string[]): Promise<GraphNode[]>;
  addEdges(edges: PlannedEdge[]): Promise<void>;
  removeByTask(userId: string, taskType: string, taskId: string): Promise<void>;
  removeTaskType(userId: string, taskType: string): Promise<void>;
}

export interface KnowledgeMemoryLink {
  entryId: string;
  userId: string;
  taskType: string;
  taskId: string | null;
  kind: string | null;
}

export function memoryGraphText(kind: string, content: string): { brief: string; selectedOutput: string } {
  const label = KIND_LABEL[kind] || 'Memory';
  const body = content.replace(/\s+/g, ' ').trim();
  return {
    brief: body.slice(0, 2_000),
    selectedOutput: `${label}: ${body}`.slice(0, 8_000),
  };
}

export function qaGraphText(question: string, answerSummary: string): { brief: string; selectedOutput: string } {
  const brief = question.replace(/\s+/g, ' ').trim().slice(0, 2_000);
  const summary = answerSummary.replace(/\s+/g, ' ').trim();
  return {
    brief,
    selectedOutput: summary ? summary.slice(0, 8_000) : brief.slice(0, 8_000),
  };
}

export function planMemoryFactEdges(input: {
  memoryEntryId: string;
  userId: string;
  conversationId: string | null;
  facts: Array<{ id: string; userId: string; conversationId: string | null; taskType: string }>;
}): PlannedEdge[] {
  if (!input.conversationId) return [];
  const edges: PlannedEdge[] = [];
  for (const fact of input.facts) {
    if (fact.userId !== input.userId) continue;
    if (fact.conversationId !== input.conversationId) continue;
    if (fact.id === input.memoryEntryId) continue;
    if (fact.taskType !== 'ai-research' && fact.taskType !== AI_RESEARCH_QA_TASK_TYPE) continue;
    edges.push({
      sourceId: input.memoryEntryId,
      targetId: fact.id,
      relationship: MEMORY_FACT_EDGE,
      weight: 1,
    });
    if (edges.length >= 8) break;
  }
  return edges;
}

export function planSimilarQaEdges(input: {
  entryId: string;
  userId: string;
  embedding: number[];
  others: Array<{ id: string; userId: string; taskType: string; embedding: number[] | null }>;
  minScore?: number;
}): PlannedEdge[] {
  const minScore = input.minScore ?? QA_LINK_SCORE;
  const edges: PlannedEdge[] = [];
  for (const other of input.others) {
    if (other.userId !== input.userId) continue;
    if (other.taskType !== AI_RESEARCH_QA_TASK_TYPE) continue;
    if (other.id === input.entryId || !other.embedding?.length) continue;
    const score = cosineSimilarity(input.embedding, other.embedding);
    if (!(score >= minScore)) continue;
    edges.push({
      sourceId: input.entryId,
      targetId: other.id,
      relationship: SIMILAR_QA_EDGE,
      weight: score,
    });
  }
  edges.sort((left, right) => right.weight - left.weight);
  return edges.slice(0, 8);
}

function scoped<T extends { userId: string }>(rows: T[], userId: string): T[] {
  return rows.filter(row => row.userId === userId);
}

type DbGraphRow = {
  id: string;
  user_id: string;
  task_type: string;
  task_id: string | null;
  brief: string;
  selected_output: string;
  conversation_id: string | null;
  embedding: string | null;
};

function mapNode(row: DbGraphRow): GraphNode {
  return {
    id: row.id,
    userId: row.user_id,
    taskType: row.task_type,
    taskId: row.task_id,
    brief: row.brief,
    selectedOutput: row.selected_output,
    conversationId: row.conversation_id,
    embedding: parseStoredEmbedding(row.embedding),
  };
}

async function edgeExists(sourceId: string, targetId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM knowledge_edges
     WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)`,
    [sourceId, targetId, targetId, sourceId],
  );
  return Boolean(row);
}

const postgresGraphStore: MemoryGraphStore = {
  async findByTask(userId, taskType, taskId) {
    const row = await queryOne<DbGraphRow>(
      `SELECT id, user_id, task_type, task_id, brief, selected_output, conversation_id, embedding
       FROM knowledge_entries
       WHERE user_id = ? AND task_type = ? AND task_id = ?
       LIMIT 1`,
      [userId, taskType, taskId],
    );
    return row ? mapNode(row) : null;
  },
  async save(node) {
    const embedding = node.embedding?.length ? JSON.stringify(node.embedding) : null;
    const updated = await execute(
      `UPDATE knowledge_entries
       SET brief = ?, selected_output = ?, embedding = COALESCE(?::text, embedding),
           conversation_id = COALESCE(?::text, conversation_id), content_hash = ?, task_id = ?
       WHERE id = ? AND user_id = ? AND task_type = ?`,
      [
        node.brief,
        node.selectedOutput,
        embedding,
        node.conversationId,
        node.taskId,
        node.taskId,
        node.id,
        node.userId,
        node.taskType,
      ],
    );
    if (updated > 0) return;
    await execute(
      `INSERT INTO knowledge_entries (
         id, user_id, brief, task_type, selected_output, rejected_outputs, embedding,
         conversation_id, quality_score, task_id, content_hash
       ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)`,
      [
        node.id,
        node.userId,
        node.brief,
        node.taskType,
        node.selectedOutput,
        embedding,
        node.conversationId,
        node.taskType === USER_MEMORY_TASK_TYPE ? 0.8 : 0.7,
        node.taskId,
        node.taskId,
      ],
    );
  },
  async listForUser(userId, taskTypes) {
    if (!taskTypes.length) return [];
    const placeholders = taskTypes.map(() => '?').join(', ');
    const rows = await queryAll<DbGraphRow>(
      `SELECT id, user_id, task_type, task_id, brief, selected_output, conversation_id, embedding
       FROM knowledge_entries
       WHERE user_id = ? AND task_type IN (${placeholders})
       ORDER BY created_at DESC
       LIMIT 80`,
      [userId, ...taskTypes],
    );
    return rows.map(mapNode).filter(row => row.userId === userId);
  },
  async addEdges(edges) {
    for (const edge of edges) {
      if (await edgeExists(edge.sourceId, edge.targetId)) continue;
      await execute(
        'INSERT INTO knowledge_edges (id, source_id, target_id, relationship, weight, metadata) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), edge.sourceId, edge.targetId, edge.relationship, edge.weight, JSON.stringify({ auto_generated: true })],
      );
    }
  },
  async removeByTask(userId, taskType, taskId) {
    const rows = await queryAll<{ id: string }>(
      'SELECT id FROM knowledge_entries WHERE user_id = ? AND task_type = ? AND task_id = ?',
      [userId, taskType, taskId],
    );
    await deleteGraphNodes(rows.map(row => row.id), userId, taskType, taskId);
  },
  async removeTaskType(userId, taskType) {
    const rows = await queryAll<{ id: string }>(
      'SELECT id FROM knowledge_entries WHERE user_id = ? AND task_type = ?',
      [userId, taskType],
    );
    if (!rows.length) return;
    const ids = rows.map(row => row.id);
    const placeholders = ids.map(() => '?').join(', ');
    await execute(
      `DELETE FROM knowledge_edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
      [...ids, ...ids],
    );
    await execute(
      'DELETE FROM knowledge_entries WHERE user_id = ? AND task_type = ?',
      [userId, taskType],
    );
  },
};

async function deleteGraphNodes(ids: string[], userId: string, taskType: string, taskId: string): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(', ');
  await execute(
    `DELETE FROM knowledge_edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
    [...ids, ...ids],
  );
  await execute(
    'DELETE FROM knowledge_entries WHERE user_id = ? AND task_type = ? AND task_id = ?',
    [userId, taskType, taskId],
  );
}

export async function mirrorUserMemory(input: {
  userId: string;
  memoryId: string;
  kind: string;
  content: string;
  conversationId?: string | null;
  embedding: number[] | null;
}, store: MemoryGraphStore = postgresGraphStore): Promise<string | null> {
  if (!input.userId || !input.memoryId || !input.content.trim()) return null;
  const text = memoryGraphText(input.kind, input.content);
  const existing = await store.findByTask(input.userId, USER_MEMORY_TASK_TYPE, input.memoryId);
  const node: GraphNode = {
    id: existing?.id || uuidv4(),
    userId: input.userId,
    taskType: USER_MEMORY_TASK_TYPE,
    taskId: input.memoryId,
    brief: text.brief,
    selectedOutput: text.selectedOutput,
    conversationId: input.conversationId ?? existing?.conversationId ?? null,
    embedding: input.embedding,
  };
  await store.save(node);
  const facts = scoped(
    await store.listForUser(input.userId, ['ai-research', AI_RESEARCH_QA_TASK_TYPE]),
    input.userId,
  );
  const edges = planMemoryFactEdges({
    memoryEntryId: node.id,
    userId: input.userId,
    conversationId: node.conversationId,
    facts,
  });
  if (edges.length) await store.addEdges(edges);
  return node.id;
}

export async function mirrorQaTurn(input: {
  userId: string;
  qaId: string;
  conversationId?: string | null;
  question: string;
  answerSummary: string;
  embedding: number[] | null;
}, store: MemoryGraphStore = postgresGraphStore): Promise<string | null> {
  if (!input.userId || !input.qaId || input.question.trim().length < 3) return null;
  const text = qaGraphText(input.question, input.answerSummary);
  const existing = await store.findByTask(input.userId, AI_RESEARCH_QA_TASK_TYPE, input.qaId);
  const embedding = input.embedding?.length
    ? input.embedding
    : await getEmbedding(`${text.brief}\n${text.selectedOutput}`);
  const node: GraphNode = {
    id: existing?.id || uuidv4(),
    userId: input.userId,
    taskType: AI_RESEARCH_QA_TASK_TYPE,
    taskId: input.qaId,
    brief: text.brief,
    selectedOutput: text.selectedOutput,
    conversationId: input.conversationId || null,
    embedding,
  };
  await store.save(node);
  const others = scoped(
    await store.listForUser(input.userId, [AI_RESEARCH_QA_TASK_TYPE]),
    input.userId,
  );
  const edges = planSimilarQaEdges({
    entryId: node.id,
    userId: input.userId,
    embedding,
    others,
  });
  if (edges.length) await store.addEdges(edges);
  const factEdges = planMemoryFactEdges({
    memoryEntryId: node.id,
    userId: input.userId,
    conversationId: node.conversationId,
    facts: scoped(await store.listForUser(input.userId, ['ai-research']), input.userId),
  });
  if (factEdges.length) await store.addEdges(factEdges);
  return node.id;
}

export async function removeQaTurnsFromGraph(
  userId: string,
  qaIds: string[],
  store: MemoryGraphStore = postgresGraphStore,
): Promise<void> {
  if (!userId) return;
  for (const qaId of qaIds) {
    if (!qaId) continue;
    await store.removeByTask(userId, AI_RESEARCH_QA_TASK_TYPE, qaId);
  }
}

export async function removeUserMemoryFromGraph(userId: string, memoryId: string, store: MemoryGraphStore = postgresGraphStore): Promise<void> {
  if (!userId || !memoryId) return;
  await store.removeByTask(userId, USER_MEMORY_TASK_TYPE, memoryId);
}

export async function clearUserMemoryGraph(userId: string, store: MemoryGraphStore = postgresGraphStore): Promise<void> {
  if (!userId) return;
  await store.removeTaskType(userId, USER_MEMORY_TASK_TYPE);
}

export async function loadKnowledgeMemoryLink(entryId: string): Promise<KnowledgeMemoryLink | null> {
  const row = await queryOne<{
    id: string;
    user_id: string;
    task_type: string;
    task_id: string | null;
  }>('SELECT id, user_id, task_type, task_id FROM knowledge_entries WHERE id = ?', [entryId]);
  if (!row) return null;
  let kind: string | null = null;
  if (row.task_type === USER_MEMORY_TASK_TYPE && row.task_id) {
    const memory = await queryOne<{ kind: string }>(
      'SELECT kind FROM user_memories WHERE id = ? AND user_id = ?',
      [row.task_id, row.user_id],
    );
    kind = memory?.kind || null;
  }
  return {
    entryId: row.id,
    userId: row.user_id,
    taskType: row.task_type,
    taskId: row.task_id,
    kind,
  };
}

export async function prepareLinkedMemoryTitle(entryId: string, title: string): Promise<{ error?: string }> {
  const link = await loadKnowledgeMemoryLink(entryId);
  if (!link || link.taskType !== USER_MEMORY_TASK_TYPE) return {};
  const { validateMemoryContent } = await import('./ai-research-memory');
  const validated = validateMemoryContent(title);
  if (!validated.ok) return { error: validated.error };
  return {};
}

export async function commitLinkedMemoryTitle(entryId: string, title: string): Promise<void> {
  const link = await loadKnowledgeMemoryLink(entryId);
  if (!link?.taskId) return;
  if (link.taskType === USER_MEMORY_TASK_TYPE) {
    const { memoryContentHash, validateMemoryContent } = await import('./ai-research-memory');
    const validated = validateMemoryContent(title);
    if (!validated.ok || !link.kind) return;
    const contentHash = memoryContentHash(link.kind, validated.content);
    const clash = await queryOne<{ id: string }>(
      'SELECT id FROM user_memories WHERE user_id = ? AND content_hash = ? AND id <> ?',
      [link.userId, contentHash, link.taskId],
    );
    if (clash) return;
    const embedding = await getEmbedding(validated.content);
    const text = memoryGraphText(link.kind, validated.content);
    await execute(
      `UPDATE user_memories
       SET content = ?, content_hash = ?, embedding = ?, updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [validated.content, contentHash, JSON.stringify(embedding), link.taskId, link.userId],
    );
    await execute(
      `UPDATE knowledge_entries
       SET selected_output = ?, embedding = ?, content_hash = ?
       WHERE id = ? AND user_id = ? AND task_type = ?`,
      [text.selectedOutput, JSON.stringify(embedding), contentHash, entryId, link.userId, USER_MEMORY_TASK_TYPE],
    );
    return;
  }
  if (link.taskType === AI_RESEARCH_QA_TASK_TYPE) {
    const { normalizeQuestion } = await import('./ai-research-memory');
    const question = title.replace(/\s+/g, ' ').trim().slice(0, 2_000);
    const embedding = await getEmbedding(question);
    await execute(
      `UPDATE ai_research_qa_index
       SET question = ?, question_norm = ?, embedding = ?
       WHERE id = ? AND user_id = ?`,
      [question, normalizeQuestion(question), JSON.stringify(embedding), link.taskId, link.userId],
    );
  }
}

export async function deleteLinkedMemoryRow(
  transaction: Pick<DatabaseTransaction, 'execute'>,
  link: KnowledgeMemoryLink | null,
): Promise<void> {
  if (!link?.taskId || !link.userId) return;
  if (link.taskType === USER_MEMORY_TASK_TYPE) {
    await transaction.execute('DELETE FROM user_memories WHERE id = ? AND user_id = ?', [link.taskId, link.userId]);
  }
  if (link.taskType === AI_RESEARCH_QA_TASK_TYPE) {
    await transaction.execute('DELETE FROM ai_research_qa_index WHERE id = ? AND user_id = ?', [link.taskId, link.userId]);
  }
}
