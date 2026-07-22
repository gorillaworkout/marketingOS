import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/database';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const taskType = request.nextUrl.searchParams.get('taskType');
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100', 10);

  const db = await getDb();

  let sql = `SELECT id, brief, task_type, platform, audience, style_cluster, created_at
             FROM knowledge_entries WHERE user_id = ?`;
  const params: unknown[] = [userId];

  if (taskType) {
    sql += ` AND task_type = ?`;
    params.push(taskType);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const entries = db.prepare(sql).all(...params) as Record<string, unknown>[];

  const nodeIds = new Set(entries.map((e) => e.id as string));

  // Fetch edges where both endpoints are in our node set (guard against empty)
  let edges: { source: string; target: string; similarity: number; type: string }[] = [];
  if (entries.length > 0) {
    const placeholders = entries.map(() => '?').join(',');
    const allEdges = db.prepare(
      `SELECT source_id, target_id, weight, relationship FROM knowledge_edges
       WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`
    ).all(...entries.map((e) => e.id), ...entries.map((e) => e.id)) as Record<string, unknown>[];

    edges = allEdges
      .filter((e) => nodeIds.has(e.source_id as string) && nodeIds.has(e.target_id as string))
      .map((e) => ({
        source: e.source_id as string,
        target: e.target_id as string,
        similarity: e.weight as number,
        type: e.relationship as string,
      }));
  }

  // Compute cluster summaries from entries
  const clusterMap = new Map<string, number>();
  for (const entry of entries) {
    const cluster = (entry.style_cluster as string) || 'unclassified';
    clusterMap.set(cluster, (clusterMap.get(cluster) || 0) + 1);
  }
  const clusterSummary = Array.from(clusterMap.entries()).map(([name, count]) => ({ name, count }));

  // Fetch style_clusters table for centroid data
  const styleClusters = db.prepare(
    `SELECT id, name, description, centroid_embedding, entry_count, example_ids, last_analyzed_at
     FROM style_clusters ORDER BY name`
  ).all() as Record<string, unknown>[];

  const clusters = styleClusters.length > 0
    ? styleClusters.map(c => ({
        name: c.name as string,
        description: c.description as string,
        entryCount: c.entry_count as number,
        exampleIds: c.example_ids ? JSON.parse(c.example_ids as string) : [],
        hasCentroid: !!c.centroid_embedding,
        lastAnalyzedAt: c.last_analyzed_at as string,
      }))
    : clusterSummary;

  const nodes = entries.map((e) => ({
    id: e.id as string,
    brief: e.brief as string,
    taskType: e.task_type as string,
    platform: e.platform as string | null,
    styleCluster: e.style_cluster as string | null,
    createdAt: e.created_at as string,
  }));

  return NextResponse.json({ nodes, edges, clusters });
}
