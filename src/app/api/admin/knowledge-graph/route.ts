import { NextRequest, NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/database';
import { requireAdmin } from '@/lib/auth';

type CountRow = { count: number | string };
type LearningWindow = {
  generated: number;
  approved: number;
  rated: number;
  average_rating: number | string | null;
};

function asNumber(value: number | string | null | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const rawLimit = Number(request.nextUrl.searchParams.get('limit') || 250);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 250, 1), 500);

  const [entries, edgeRows, departments, taskTypes, previous, current, totals] = await Promise.all([
    queryAll(`
      SELECT ke.id, ke.user_id, u.username, u.name AS user_name,
             COALESCE(d.name, 'Admin / Unassigned') AS department,
             ke.task_type, ke.brief, ke.style_cluster, ke.platform,
             ke.audience, ke.quality_score, ke.created_at
      FROM knowledge_entries ke
      JOIN users u ON u.id = ke.user_id
      LEFT JOIN departments d ON d.id = u.department_id
      ORDER BY ke.created_at DESC
      LIMIT ?
    `, [limit]) as Promise<Record<string, unknown>[]>,
    queryAll(`
      SELECT e.source_id, e.target_id, e.relationship, e.weight
      FROM knowledge_edges e
      JOIN knowledge_entries source ON source.id = e.source_id
      JOIN knowledge_entries target ON target.id = e.target_id
      ORDER BY e.created_at DESC
      LIMIT 1500
    `, []) as Promise<Record<string, unknown>[]>,
    queryAll(`
      SELECT COALESCE(d.name, 'Admin / Unassigned') AS name,
             COUNT(ke.id)::INTEGER AS knowledge_count,
             COUNT(DISTINCT ke.user_id)::INTEGER AS contributor_count
      FROM knowledge_entries ke
      JOIN users u ON u.id = ke.user_id
      LEFT JOIN departments d ON d.id = u.department_id
      GROUP BY COALESCE(d.name, 'Admin / Unassigned')
      ORDER BY knowledge_count DESC
    `, []) as Promise<Record<string, unknown>[]>,
    queryAll(`
      SELECT task_type AS name, COUNT(*)::INTEGER AS count
      FROM knowledge_entries GROUP BY task_type ORDER BY count DESC
    `, []) as Promise<Record<string, unknown>[]>,
    queryOne<LearningWindow>(`
      SELECT COUNT(*)::INTEGER AS generated,
             COUNT(*) FILTER (WHERE status IN ('approved', 'published'))::INTEGER AS approved,
             COUNT(*) FILTER (WHERE rating > 0)::INTEGER AS rated,
             AVG(NULLIF(rating, 0)) AS average_rating
      FROM tasks
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '60 days'
        AND created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
    `, []),
    queryOne<LearningWindow>(`
      SELECT COUNT(*)::INTEGER AS generated,
             COUNT(*) FILTER (WHERE status IN ('approved', 'published'))::INTEGER AS approved,
             COUNT(*) FILTER (WHERE rating > 0)::INTEGER AS rated,
             AVG(NULLIF(rating, 0)) AS average_rating
      FROM tasks
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
    `, []),
    Promise.all([
      queryOne<CountRow>('SELECT COUNT(*)::INTEGER AS count FROM knowledge_entries', []),
      queryOne<CountRow>('SELECT COUNT(*)::INTEGER AS count FROM knowledge_edges', []),
      queryOne<CountRow>("SELECT COUNT(*)::INTEGER AS count FROM knowledge_entries WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'", []),
      queryOne<CountRow>('SELECT COUNT(DISTINCT user_id)::INTEGER AS count FROM knowledge_entries', []),
      queryOne<CountRow>('SELECT COUNT(*)::INTEGER AS count FROM departments', []),
    ]),
  ]);

  const nodeIds = new Set(entries.map(entry => String(entry.id)));
  const nodes = entries.map(entry => ({
    id: String(entry.id),
    brief: String(entry.brief || ''),
    taskType: String(entry.task_type || 'unknown'),
    styleCluster: entry.style_cluster ? String(entry.style_cluster) : 'unclassified',
    platform: entry.platform ? String(entry.platform) : null,
    audience: entry.audience ? String(entry.audience) : null,
    qualityScore: asNumber(entry.quality_score as number | string | null),
    department: String(entry.department || 'Admin / Unassigned'),
    username: String(entry.username || entry.user_name || 'Unknown'),
    createdAt: String(entry.created_at),
  }));
  const storedEdges = edgeRows
    .filter(edge => nodeIds.has(String(edge.source_id)) && nodeIds.has(String(edge.target_id)))
    .map(edge => ({
      source: String(edge.source_id),
      target: String(edge.target_id),
      type: String(edge.relationship || 'related'),
      weight: asNumber(edge.weight as number | string | null),
      sourceType: 'stored' as const,
    }));

  // Older knowledge records may not have embeddings, so no semantic edges exist.
  // Build a sparse, deterministic view from real metadata instead of drawing
  // decorative random lines. These edges are view-only and clearly identified.
  const derivedEdges: Array<{ source: string; target: string; type: string; weight: number; sourceType: 'derived' }> = [];
  const connected = new Set(storedEdges.flatMap(edge => [edge.source, edge.target]));
  for (let index = 1; index < nodes.length; index++) {
    const node = nodes[index];
    if (connected.has(node.id)) continue;
    const candidates = nodes.slice(0, index).map(candidate => {
      let score = 0;
      const reasons: string[] = [];
      if (candidate.department === node.department) { score += 4; reasons.push('same_department'); }
      if (candidate.taskType === node.taskType) { score += 3; reasons.push('same_task_type'); }
      if (candidate.platform && candidate.platform === node.platform) { score += 2; reasons.push('same_platform'); }
      if (candidate.styleCluster === node.styleCluster) { score += 1; reasons.push('same_style'); }
      return { candidate, score, reasons };
    }).filter(item => item.score > 0).sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (!best) continue;
    derivedEdges.push({
      source: node.id,
      target: best.candidate.id,
      type: best.reasons.join('+'),
      weight: Math.min(1, best.score / 10),
      sourceType: 'derived',
    });
    connected.add(node.id);
    connected.add(best.candidate.id);
  }
  const edges = [...storedEdges, ...derivedEdges];

  const normalizeWindow = (window?: LearningWindow) => {
    const generated = asNumber(window?.generated);
    const approved = asNumber(window?.approved);
    const rated = asNumber(window?.rated);
    return {
      generated,
      approved,
      rated,
      approvalRate: generated ? approved / generated : 0,
      feedbackCoverage: generated ? rated / generated : 0,
      averageRating: asNumber(window?.average_rating),
    };
  };
  const currentWindow = normalizeWindow(current);
  const previousWindow = normalizeWindow(previous);
  const approvalDelta = currentWindow.approvalRate - previousWindow.approvalRate;
  const ratingDelta = currentWindow.averageRating - previousWindow.averageRating;
  const hasEnoughSignal = currentWindow.generated >= 5 && currentWindow.rated >= 3;
  const learningStatus = !hasEnoughSignal
    ? 'insufficient-data'
    : approvalDelta > 0.02 || ratingDelta > 0.15
      ? 'improving'
      : approvalDelta < -0.02 || ratingDelta < -0.15
        ? 'declining'
        : 'stable';

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    scope: 'organization',
    totals: {
      knowledge: asNumber(totals[0]?.count),
      edges: asNumber(totals[1]?.count),
      addedLast30Days: asNumber(totals[2]?.count),
      contributors: asNumber(totals[3]?.count),
      departments: asNumber(totals[4]?.count),
    },
    learningHealth: {
      status: learningStatus,
      current: currentWindow,
      previous: previousWindow,
      approvalDelta,
      ratingDelta,
      note: hasEnoughSignal
        ? 'Trend compares the latest 30 days with the previous 30 days.'
        : 'More ratings and approvals are required before MarketingOS can prove improvement.',
    },
    departments: departments.map(row => ({
      name: String(row.name),
      knowledgeCount: asNumber(row.knowledge_count as number | string),
      contributorCount: asNumber(row.contributor_count as number | string),
    })),
    taskTypes: taskTypes.map(row => ({ name: String(row.name), count: asNumber(row.count as number | string) })),
    nodes,
    edges,
  });
}
