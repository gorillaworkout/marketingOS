import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const requestedUserId = request.nextUrl.searchParams.get('userId') || userId;

  // User style profile
  const userProfile = await queryOne(`SELECT style_summary, tone_preferences, hook_preferences, total_selections, last_analyzed_at
     FROM user_style_preferences WHERE user_id = ?`, [requestedUserId]) as Record<string, unknown> | undefined;

  // Global team style
  const teamProfile = await queryOne(`SELECT team_summary, top_examples, cluster_distribution, last_analyzed_at
     FROM global_style_profile WHERE task_type = 'global'`, []) as Record<string, unknown> | undefined;

  // Style clusters (K-Means centroids)
  const styleClusters = await queryAll(`SELECT name, description, entry_count, example_ids, last_analyzed_at
     FROM style_clusters ORDER BY name`, []) as Record<string, unknown>[];

  // Recent selections
  const recentSelections = await queryAll(`SELECT id, brief, task_type, platform, selected_output, created_at
     FROM knowledge_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [requestedUserId]) as Record<string, unknown>[];

  return NextResponse.json({
    userProfile: userProfile ? {
      styleSummary: userProfile.style_summary,
      tonePreferences: userProfile.tone_preferences ? JSON.parse(userProfile.tone_preferences as string) : {},
      hookPreferences: userProfile.hook_preferences ? JSON.parse(userProfile.hook_preferences as string) : {},
      totalSelections: userProfile.total_selections,
      lastAnalyzedAt: userProfile.last_analyzed_at,
    } : null,
    teamProfile: teamProfile ? {
      teamSummary: teamProfile.team_summary,
      topExamples: teamProfile.top_examples ? JSON.parse(teamProfile.top_examples as string) : [],
      clusterDistribution: teamProfile.cluster_distribution ? JSON.parse(teamProfile.cluster_distribution as string) : {},
      lastAnalyzedAt: teamProfile.last_analyzed_at,
    } : null,
    styleClusters: styleClusters.map((c) => ({
      name: c.name,
      description: c.description,
      entryCount: c.entry_count,
      exampleIds: c.example_ids ? JSON.parse(c.example_ids as string) : [],
      lastAnalyzedAt: c.last_analyzed_at,
    })),
    recentSelections: recentSelections.map((r) => ({
      id: r.id, brief: r.brief, taskType: r.task_type,
      platform: r.platform, selectedOutput: r.selected_output, createdAt: r.created_at,
    })),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const { styleSummary, tonePreferences, hookPreferences } = await request.json();

  const existing = await queryOne(`SELECT id FROM user_style_preferences WHERE user_id = ?`, [userId]);

  if (existing) {
    await execute(`UPDATE user_style_preferences SET style_summary = ?, tone_preferences = ?, hook_preferences = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`, [styleSummary || null, JSON.stringify(tonePreferences || {}), JSON.stringify(hookPreferences || {}), userId]);
  } else {
    await execute(`INSERT INTO user_style_preferences (id, user_id, style_summary, tone_preferences, hook_preferences) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), userId, styleSummary || null, JSON.stringify(tonePreferences || {}), JSON.stringify(hookPreferences || {})]);
  }

    return NextResponse.json({ success: true });
}
