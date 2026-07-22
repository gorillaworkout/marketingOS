import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { kMeans, labelClusters, STYLE_LABELS } from '@/lib/clustering';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId as string;

  // ── 1. Fetch knowledge entries with embeddings ────────────────────────────
  const entries = await queryAll(`SELECT id, user_id, task_type, brief, selected_output, rejected_outputs, platform, audience, embedding
     FROM knowledge_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`, [userId]) as Array<{
    id: string; user_id: string; task_type: string; brief: string;
    selected_output: string; rejected_outputs: string | null;
    platform: string | null; audience: string | null; embedding: string | null;
  }>;

  // Need at least 3 entries with embeddings for meaningful clustering
  const entriesWithEmbeddings = entries.filter(e => {
    if (!e.embedding) return false;
    try { JSON.parse(e.embedding); return true; } catch { return false; }
  });

  if (entriesWithEmbeddings.length < 3) {
    return NextResponse.json({
      error: `Need at least 3 entries with embeddings (have ${entriesWithEmbeddings.length}). Save more content first.`,
    }, { status: 400 });
  }

  // ── 2. Parse embeddings & run K-Means ─────────────────────────────────────
  const vectors = entriesWithEmbeddings.map(e => JSON.parse(e.embedding!) as number[]);
  const k = Math.min(3, entriesWithEmbeddings.length); // max 3 clusters
  const result = kMeans(vectors, k, 50, 42);

  // ── 3. Label clusters using keyword heuristics ────────────────────────────
  const labeledClusters = labelClusters(
    entriesWithEmbeddings.map(e => ({ id: e.id, selected_output: e.selected_output, brief: e.brief })),
    result.assignments,
    k
  );

  // ── 4. Update style_clusters table ────────────────────────────────────────
  // Clear old clusters for this analysis cycle
  const existingClusters = await queryAll(`SELECT id, name FROM style_clusters`, []) as Array<{ id: string; name: string }>;

  for (const cluster of labeledClusters) {
    const existing = existingClusters.find(c => c.name === cluster.name);

    if (existing) {
      await execute(`UPDATE style_clusters
         SET centroid_embedding = ?, entry_count = ?, example_ids = ?,
             description = ?, last_analyzed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`, [JSON.stringify(result.centroids[cluster.centroidIndex]), cluster.entryIndices.length, JSON.stringify(cluster.exampleIds), cluster.description, existing.id]);
    } else {
      await execute(`INSERT INTO style_clusters (id, name, description, centroid_embedding, entry_count, example_ids, last_analyzed_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [uuidv4(), cluster.name, cluster.description, JSON.stringify(result.centroids[cluster.centroidIndex]), cluster.entryIndices.length, JSON.stringify(cluster.exampleIds)]);
    }
  }

  // ── 5. Update knowledge_entries.style_cluster ─────────────────────────────
  for (const cluster of labeledClusters) {
    for (const idx of cluster.entryIndices) {
      const entryId = entriesWithEmbeddings[idx].id;
      await execute(`UPDATE knowledge_entries SET style_cluster = ? WHERE id = ?`, [cluster.name, entryId]);
    }
  }

  // ── 6. Generate AI-enhanced style summary ─────────────────────────────────
  let styleSummary = '';
  let tonePreferences: Record<string, number> = {};
  let hookPreferences: Record<string, number> = {};

  try {
    const samples = entries.slice(0, 20)
      .map((s, i) => `${i + 1}. [${s.task_type}/${s.platform || 'any'}] Brief: ${s.brief}\n   Output: ${s.selected_output}`)
      .join('\n\n');

    const { generateContent } = await import('@/lib/openai');
    const model = 'deepseek/deepseek-v4-flash';

    const { content: analysisJson } = await generateContent(
      `Analyze these marketing content selections to identify the user's style patterns.
Return JSON with this exact structure:
{
  "styleSummary": "2-3 sentence summary of their creative style",
  "tonePreferences": {"professional": N, "casual": N, "humorous": N, "inspirational": N, "urgent": N},
  "hookPreferences": {"question": N, "statistic": N, "story": N, "provocative": N, "direct": N},
  "teamInsights": "overall team-level insight about content patterns"
}`,
      `Analyze these ${entries.length} content selections:\n\n${samples}`,
      userId,
      undefined,
      { model, responseFormat: { type: 'json_object' } }
    );

    const parsed = JSON.parse(analysisJson);
    styleSummary = parsed.styleSummary || '';
    tonePreferences = parsed.tonePreferences || {};
    hookPreferences = parsed.hookPreferences || {};
  } catch (e) {
    console.warn('AI style analysis failed, using basic summary:', e);
    // Fallback: generate basic summary from cluster info
    styleSummary = labeledClusters.map(c =>
      `${c.name}: ${c.entryIndices.length} entries (${c.description})`
    ).join('. ');
  }

  // ── 7. Update user_style_preferences ──────────────────────────────────────
  const preferredCluster = labeledClusters.reduce((best, c) =>
    c.entryIndices.length > best.entryIndices.length ? c : best
  ).name;

  const existing = await queryOne(`SELECT id FROM user_style_preferences WHERE user_id = ?`, [userId]);
  if (existing) {
    await execute(`UPDATE user_style_preferences
       SET style_summary = ?, tone_preferences = ?, hook_preferences = ?,
           preferred_cluster = ?, last_analyzed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`, [styleSummary, JSON.stringify(tonePreferences), JSON.stringify(hookPreferences), preferredCluster, userId]);
  } else {
    await execute(`INSERT INTO user_style_preferences (id, user_id, style_summary, tone_preferences, hook_preferences, preferred_cluster, last_analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [uuidv4(), userId, styleSummary, JSON.stringify(tonePreferences), JSON.stringify(hookPreferences), preferredCluster]);
  }

  // ── 8. Update global_style_profile ────────────────────────────────────────
  const clusterDistribution: Record<string, number> = {};
  for (const c of labeledClusters) {
    clusterDistribution[c.name] = c.entryIndices.length;
  }

  const globalRow = await queryOne(`SELECT id FROM global_style_profile WHERE task_type = 'global'`, []);
  if (globalRow) {
    await execute(`UPDATE global_style_profile
       SET team_summary = ?, cluster_distribution = ?, top_examples = ?,
           last_analyzed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE task_type = 'global'`, [styleSummary, JSON.stringify(clusterDistribution), JSON.stringify(labeledClusters.flatMap(c => c.exampleIds))]);
  } else {
    await execute(`INSERT INTO global_style_profile (id, task_type, team_summary, cluster_distribution, top_examples, last_analyzed_at)
       VALUES (?, 'global', ?, ?, ?, CURRENT_TIMESTAMP)`, [uuidv4(), styleSummary, JSON.stringify(clusterDistribution), JSON.stringify(labeledClusters.flatMap(c => c.exampleIds))]);
  }


  // ── 9. Return results ─────────────────────────────────────────────────────
  return NextResponse.json({
    userProfile: {
      styleSummary,
      tonePreferences,
      hookPreferences,
      preferredCluster,
    },
    clusters: labeledClusters.map(c => ({
      name: c.name,
      description: c.description,
      entryCount: c.entryIndices.length,
      examples: c.exampleIds,
    })),
    totalEntries: entries.length,
    clusteredEntries: entriesWithEmbeddings.length,
  });
}
