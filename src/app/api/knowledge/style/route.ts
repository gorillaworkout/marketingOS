import { NextRequest, NextResponse } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const requestedUserId = request.nextUrl.searchParams.get('userId') || userId;
  const db = await getDb();

  // User style profile
  const userProfile = db.prepare(
    `SELECT style_summary, tone_preferences, hook_preferences, total_selections, last_analyzed_at
     FROM user_style_preferences WHERE user_id = ?`
  ).get(requestedUserId) as Record<string, unknown> | undefined;

  // Global team style
  const teamProfile = db.prepare(
    `SELECT team_summary, top_examples, cluster_distribution, last_analyzed_at
     FROM global_style_profile WHERE task_type = 'global'`
  ).get() as Record<string, unknown> | undefined;

  // Style clusters (K-Means centroids)
  const styleClusters = db.prepare(
    `SELECT name, description, entry_count, example_ids, last_analyzed_at
     FROM style_clusters ORDER BY name`
  ).all() as Record<string, unknown>[];

  // Recent selections
  const recentSelections = db.prepare(
    `SELECT id, brief, task_type, platform, selected_output, created_at
     FROM knowledge_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`
  ).all(requestedUserId) as Record<string, unknown>[];

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
  const db = await getDb();

  const existing = db.prepare(`SELECT id FROM user_style_preferences WHERE user_id = ?`).get(userId);

  if (existing) {
    db.prepare(
      `UPDATE user_style_preferences SET style_summary = ?, tone_preferences = ?, hook_preferences = ?, updated_at = datetime('now') WHERE user_id = ?`
    ).run(styleSummary || null, JSON.stringify(tonePreferences || {}), JSON.stringify(hookPreferences || {}), userId);
  } else {
    db.prepare(
      `INSERT INTO user_style_preferences (id, user_id, style_summary, tone_preferences, hook_preferences) VALUES (?, ?, ?, ?, ?)`
    ).run(uuidv4(), userId, styleSummary || null, JSON.stringify(tonePreferences || {}), JSON.stringify(hookPreferences || {}));
  }

  saveDbToDisk();
  return NextResponse.json({ success: true });
}
