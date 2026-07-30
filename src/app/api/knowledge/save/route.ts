import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { getEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { getUserPreferredModel } from '@/lib/openai';
import { isGenerationFeature } from '@/lib/model-routing';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId as string;

  const { brief, taskType, selectedOutput, rejectedOutputs, platform, audience } = await request.json();
  if (!brief || !taskType || !selectedOutput) {
    return NextResponse.json({ error: 'brief, taskType, and selectedOutput required' }, { status: 400 });
  }

  // Generate embedding for the selected output
  let embedding: number[] = [];
  try {
    embedding = await getEmbedding(selectedOutput);
  } catch (e) {
    console.warn('Embedding generation failed, saving without vector:', e);
  }

  const knowledgeId = uuidv4();
  await execute(`INSERT INTO knowledge_entries (id, user_id, brief, task_type, selected_output, rejected_outputs, platform, audience, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [knowledgeId, userId, brief, taskType, typeof selectedOutput === "string" ? selectedOutput : JSON.stringify(selectedOutput), JSON.stringify(rejectedOutputs || []), platform || null, audience || null, embedding.length ? JSON.stringify(embedding) : null]);

  // Auto-link with similar entries
  let connectionsCount = 0;
  if (embedding.length) {
    const existing = await queryAll(`SELECT id, embedding FROM knowledge_entries WHERE user_id = ? AND id != ? AND embedding IS NOT NULL`, [userId, knowledgeId]) as Record<string, unknown>[];

    for (const row of existing) {
      try {
        const otherEmb = JSON.parse(row.embedding as string) as number[];
        const sim = cosineSimilarity(embedding, otherEmb);
        if (sim > 0.75) {
          await execute(`INSERT INTO knowledge_edges (id, source_id, target_id, relationship, weight) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), knowledgeId, row.id as string, 'cosine_similarity', sim]);
          connectionsCount++;
        }
      } catch { /* skip malformed embeddings */ }
    }
  }

  // Update user style preferences
  const prefRow = await queryOne(`SELECT total_selections FROM user_style_preferences WHERE user_id = ?`, [userId]) as Record<string, unknown> | undefined;

  const totalSelections = ((prefRow?.total_selections as number) || 0) + 1;

  if (prefRow) {
    await execute(`UPDATE user_style_preferences SET total_selections = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`, [totalSelections, userId]);
  } else {
    await execute(`INSERT INTO user_style_preferences (id, user_id, total_selections) VALUES (?, ?, ?)`, [uuidv4(), userId, totalSelections]);
  }

  // Auto-analyze every 5 selections
  if (totalSelections % 5 === 0) {
    try {
      const recent = await queryAll(`SELECT selected_output, task_type, platform FROM knowledge_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`, [userId]) as Record<string, unknown>[];

      const samples = recent.map((r, i) => `${i + 1}. [${r.task_type}/${r.platform}] ${r.selected_output}`).join('\n');

      const { generateContent } = await import('@/lib/openai');
      const analysisFeature = isGenerationFeature(taskType) ? taskType : 'social-post';
      const model = await getUserPreferredModel(userId, analysisFeature);
      const { content: analysis } = await generateContent(
        'Analyze these marketing content selections and identify style patterns. Return JSON: { "styleSummary": string, "tonePreferences": {tone: count}, "hookPreferences": {hookType: count} }',
        samples,
        userId as string,
        undefined,
        { model, responseFormat: { type: 'json_object' }, taskType: analysisFeature }
      );

      const parsed = JSON.parse(analysis);
      await execute(`UPDATE user_style_preferences SET style_summary = ?, tone_preferences = ?, hook_preferences = ?, last_analyzed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`, [parsed.styleSummary, JSON.stringify(parsed.tonePreferences), JSON.stringify(parsed.hookPreferences), userId]);
    } catch (e) {
      console.warn('Auto style analysis failed:', e);
    }
  }

    return NextResponse.json({ success: true, knowledgeId, connectionsCount });
}
