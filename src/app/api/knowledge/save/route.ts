import { NextRequest, NextResponse } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { getEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const { brief, taskType, selectedOutput, rejectedOutputs, platform, audience } = await request.json();
  if (!brief || !taskType || !selectedOutput) {
    return NextResponse.json({ error: 'brief, taskType, and selectedOutput required' }, { status: 400 });
  }

  const db = await getDb();

  // Generate embedding for the selected output
  let embedding: number[] = [];
  try {
    embedding = await getEmbedding(selectedOutput);
  } catch (e) {
    console.warn('Embedding generation failed, saving without vector:', e);
  }

  const knowledgeId = uuidv4();
  db.prepare(
    `INSERT INTO knowledge_entries (id, user_id, brief, task_type, selected_output, rejected_outputs, platform, audience, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    knowledgeId, userId, brief, taskType, typeof selectedOutput === "string" ? selectedOutput : JSON.stringify(selectedOutput),
    JSON.stringify(rejectedOutputs || []),
    platform || null, audience || null,
    embedding.length ? JSON.stringify(embedding) : null
  );

  // Auto-link with similar entries
  let connectionsCount = 0;
  if (embedding.length) {
    const existing = db.prepare(
      `SELECT id, embedding FROM knowledge_entries WHERE user_id = ? AND id != ? AND embedding IS NOT NULL`
    ).all(userId, knowledgeId) as Record<string, unknown>[];

    for (const row of existing) {
      try {
        const otherEmb = JSON.parse(row.embedding as string) as number[];
        const sim = cosineSimilarity(embedding, otherEmb);
        if (sim > 0.75) {
          db.prepare(
            `INSERT INTO knowledge_edges (id, source_id, target_id, relationship, weight) VALUES (?, ?, ?, ?, ?)`
          ).run(uuidv4(), knowledgeId, row.id as string, 'cosine_similarity', sim);
          connectionsCount++;
        }
      } catch { /* skip malformed embeddings */ }
    }
  }

  // Update user style preferences
  const prefRow = db.prepare(
    `SELECT total_selections FROM user_style_preferences WHERE user_id = ?`
  ).get(userId) as Record<string, unknown> | undefined;

  const totalSelections = ((prefRow?.total_selections as number) || 0) + 1;

  if (prefRow) {
    db.prepare(
      `UPDATE user_style_preferences SET total_selections = ?, updated_at = datetime('now') WHERE user_id = ?`
    ).run(totalSelections, userId);
  } else {
    db.prepare(
      `INSERT INTO user_style_preferences (id, user_id, total_selections) VALUES (?, ?, ?)`
    ).run(uuidv4(), userId, totalSelections);
  }

  // Auto-analyze every 5 selections
  if (totalSelections % 5 === 0) {
    try {
      const recent = db.prepare(
        `SELECT selected_output, task_type, platform FROM knowledge_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
      ).all(userId) as Record<string, unknown>[];

      const samples = recent.map((r, i) => `${i + 1}. [${r.task_type}/${r.platform}] ${r.selected_output}`).join('\n');

      const { generateContent } = await import('@/lib/openai');
      const model = 'deepseek/deepseek-v4-flash';
      const { content: analysis } = await generateContent(
        'Analyze these marketing content selections and identify style patterns. Return JSON: { "styleSummary": string, "tonePreferences": {tone: count}, "hookPreferences": {hookType: count} }',
        samples,
        userId as string,
        undefined,
        { model, responseFormat: { type: 'json_object' } }
      );

      const parsed = JSON.parse(analysis);
      db.prepare(
        `UPDATE user_style_preferences SET style_summary = ?, tone_preferences = ?, hook_preferences = ?, last_analyzed_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?`
      ).run(parsed.styleSummary, JSON.stringify(parsed.tonePreferences), JSON.stringify(parsed.hookPreferences), userId);
    } catch (e) {
      console.warn('Auto style analysis failed:', e);
    }
  }

  saveDbToDisk();
  return NextResponse.json({ success: true, knowledgeId, connectionsCount });
}
