import { IMPORTED_CHAT_TASK_TYPE } from './knowledge-task-types';
import { knowledgeEmbeddingInput } from './embeddings';
import type { PlannedEdge } from './ai-research-memory-graph';

export const IMPORTED_CHAT_GRAPH_BRIEF_LIMIT = 240;
export const IMPORTED_CHAT_GRAPH_TEXT_LIMIT = 8_000;
export const IMPORTED_CHAT_QUALITY_SCORE = 0.7;

export const INSERT_IMPORTED_CHAT_NODE_SQL = `
  INSERT INTO knowledge_entries (
    id, user_id, brief, task_type, selected_output, rejected_outputs, embedding,
    conversation_id, quality_score, task_id, content_hash
  ) VALUES (?, ?, ?, ?, ?, '[]', ?, NULL, ?, ?, ?)
`;

export function importedChatNodeFields(input: {
  id: string;
  title: string;
  transcript: string;
  contentHash: string;
  knowledgeEntryId: string;
}) {
  const brief = input.title.replace(/\s+/g, ' ').trim().slice(0, IMPORTED_CHAT_GRAPH_BRIEF_LIMIT) || 'Imported chat';
  const selectedOutput = input.transcript.slice(0, IMPORTED_CHAT_GRAPH_TEXT_LIMIT);
  return {
    id: input.knowledgeEntryId,
    taskType: IMPORTED_CHAT_TASK_TYPE,
    taskId: input.id,
    brief,
    selectedOutput,
    conversationId: null as null,
    qualityScore: IMPORTED_CHAT_QUALITY_SCORE as 0.7,
    contentHash: input.contentHash,
    embeddingInput: knowledgeEmbeddingInput(IMPORTED_CHAT_TASK_TYPE, brief, selectedOutput),
  };
}

export function planImportLearnedFromEdges(input: { importNodeId: string; sourceNodeIds: string[] }): PlannedEdge[] {
  const edges: PlannedEdge[] = [];
  for (const sourceId of input.sourceNodeIds) {
    if (!sourceId || sourceId === input.importNodeId) continue;
    edges.push({ sourceId, targetId: input.importNodeId, relationship: 'learned_from', weight: 1 });
  }
  return edges;
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505');
}
