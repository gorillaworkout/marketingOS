import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { getEmbedding, cosineSimilarity } from '@/lib/embeddings';

export async function POST(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const { query, taskType, limit = 10 } = await request.json();
  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });

  const db = await getDb();

  let queryEmbedding: number[];
  try {
    queryEmbedding = await getEmbedding(query);
  } catch (e) {
    return NextResponse.json({ error: 'Embedding generation failed' }, { status: 502 });
  }

  let sql = `SELECT id, brief, selected_output, task_type, platform, audience, embedding, style_cluster
             FROM knowledge_entries WHERE user_id = ? AND embedding IS NOT NULL`;
  const params: unknown[] = [userId];

  if (taskType) {
    sql += ` AND task_type = ?`;
    params.push(taskType);
  }

  const entries = db.prepare(sql).all(...params) as Record<string, unknown>[];

  const results = entries
    .map((entry) => {
      try {
        const emb = JSON.parse(entry.embedding as string) as number[];
        return {
          id: entry.id as string,
          brief: entry.brief as string,
          selectedOutput: entry.selected_output as string,
          taskType: entry.task_type as string,
          platform: entry.platform as string | null,
          similarity: cosineSimilarity(queryEmbedding, emb),
          styleCluster: entry.style_cluster as string | null,
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return NextResponse.json({ results });
}
