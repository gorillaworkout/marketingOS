import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, execute } from './database';
import { cosineSimilarity, getEmbedding } from './embeddings';
import {
  AI_RESEARCH_KNOWLEDGE_TASK,
  knowledgeGraphFocusUrl,
  prepareResearchKnowledgePin,
  type PreparedResearchPin,
} from './knowledge-pin';
import { findStoredKnowledgeDuplicate, knowledgeContentHash } from './knowledge-persist';

type PinBody = {
  taskType?: unknown;
  selectedOutput?: unknown;
  sourceUrls?: unknown;
  conversationId?: unknown;
  projectId?: unknown;
};

async function ownedConversation(userId: string, conversationId: string): Promise<{ project_id: string | null } | undefined> {
  return queryOne<{ project_id: string | null }>(
    'SELECT project_id FROM ai_research_conversations WHERE id = ? AND user_id = ?',
    [conversationId, userId],
  );
}

async function ownedProject(userId: string, projectId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    'SELECT id FROM ai_research_projects WHERE id = ? AND user_id = ?',
    [projectId, userId],
  );
  return Boolean(row);
}

async function linkSimilarEntries(userId: string, knowledgeId: string, embedding: number[]): Promise<number> {
  if (!embedding.length) return 0;
  const existing = await queryAll(
    'SELECT id, embedding FROM knowledge_entries WHERE user_id = ? AND id != ? AND embedding IS NOT NULL',
    [userId, knowledgeId],
  ) as Array<{ id: string; embedding: string }>;
  let connections = 0;
  for (const row of existing) {
    try {
      const other = JSON.parse(row.embedding) as number[];
      const similarity = cosineSimilarity(embedding, other);
      if (similarity > 0.75) {
        await execute(
          'INSERT INTO knowledge_edges (id, source_id, target_id, relationship, weight) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), knowledgeId, row.id, 'cosine_similarity', similarity],
        );
        connections += 1;
      }
    } catch {
      // Skip malformed embeddings already stored on older rows.
    }
  }
  return connections;
}

export async function savePinnedResearchFact(
  userId: string,
  body: PinBody,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let prepared: PreparedResearchPin;
  try {
    prepared = prepareResearchKnowledgePin({
      taskType: body.taskType,
      selectedOutput: body.selectedOutput,
      sourceUrls: body.sourceUrls,
      conversationId: body.conversationId,
      projectId: body.projectId,
    });
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : 'Fact is not valid.' } };
  }

  if (prepared.conversationId) {
    const conversation = await ownedConversation(userId, prepared.conversationId);
    if (!conversation) return { status: 404, body: { error: 'Conversation was not found.' } };
    if (conversation.project_id) prepared = { ...prepared, projectId: conversation.project_id };
  }
  if (prepared.projectId && !(await ownedProject(userId, prepared.projectId))) {
    return { status: 404, body: { error: 'Project was not found.' } };
  }

  let embedding: number[] = [];
  try {
    embedding = await getEmbedding(prepared.fact);
  } catch (error) {
    console.warn('Embedding generation failed, saving research fact without vector:', error);
  }

  const contentHash = knowledgeContentHash(prepared.fact);
  try {
    const existing = await findStoredKnowledgeDuplicate({
      userId,
      taskType: AI_RESEARCH_KNOWLEDGE_TASK,
      selectedOutput: prepared.fact,
      action: 'pin',
    });
    if (existing) {
      return {
        status: 200,
        body: {
          success: true,
          knowledgeId: existing.id,
          connectionsCount: 0,
          graphUrl: knowledgeGraphFocusUrl(existing.id),
          deduped: true,
        },
      };
    }
  } catch (error) {
    console.warn('Research pin duplicate lookup failed:', error);
  }

  // Research facts are citations, not marketing style selections, so this path
  // does not update user_style_preferences. Rows still live in knowledge_entries.
  const knowledgeId = uuidv4();
  await execute(
    `INSERT INTO knowledge_entries (
      id, user_id, brief, task_type, selected_output, rejected_outputs, platform, audience, embedding,
      source_urls, conversation_id, project_id, quality_score, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      knowledgeId,
      userId,
      prepared.brief,
      AI_RESEARCH_KNOWLEDGE_TASK,
      prepared.fact,
      JSON.stringify([]),
      'web',
      null,
      embedding.length ? JSON.stringify(embedding) : null,
      JSON.stringify(prepared.sourceUrls),
      prepared.conversationId,
      prepared.projectId,
      1,
      contentHash,
    ],
  );
  const connectionsCount = await linkSimilarEntries(userId, knowledgeId, embedding);
  return {
    status: 200,
    body: {
      success: true,
      knowledgeId,
      connectionsCount,
      graphUrl: knowledgeGraphFocusUrl(knowledgeId),
    },
  };
}
