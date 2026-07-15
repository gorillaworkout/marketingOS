import { NextRequest, NextResponse } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const db = await getDb();
  const { taskId, rating, feedback } = await request.json();
  if (!taskId || !rating) return NextResponse.json({ error: 'taskId and rating required' }, { status: 400 });

  db.prepare('UPDATE tasks SET rating = ?, feedback = ? WHERE id = ? AND user_id = ?').run(rating, feedback || null, taskId, userId);
  saveDbToDisk();

  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = await getDb();
  const type = request.nextUrl.searchParams.get('type') || 'social-post';

  // Fix SQL injection: use parameterized query instead of string interpolation
  const examples = db.prepare(`
    SELECT id, type, title, brief, output_data, rating, created_at 
    FROM tasks 
    WHERE type = ? AND rating >= 4 AND output_data IS NOT NULL
    ORDER BY rating DESC, created_at DESC 
    LIMIT 5
  `).all(type) as Record<string, unknown>[];

  return NextResponse.json({ examples });
}
