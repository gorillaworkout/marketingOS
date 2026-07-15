import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/database';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId!;

  const db = await getDb();

  const entries = db.prepare(`
    SELECT id, task_type, brief, selected_output, style_cluster, platform, audience, quality_score, created_at
    FROM knowledge_entries
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(userId) as Record<string, unknown>[];

  let stylePreferences = null;
  try {
    const prefs = db.prepare(
      'SELECT total_selections, style_summary FROM user_style_preferences WHERE user_id = ?'
    ).get(userId) as Record<string, unknown> | undefined;
    if (prefs) {
      stylePreferences = {
        total_selections: prefs.total_selections,
        style_summary: prefs.style_summary,
      };
    }
  } catch {}

  return NextResponse.json({ entries, stylePreferences });
}
