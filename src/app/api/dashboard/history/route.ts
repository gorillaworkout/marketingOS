import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  // Support filtering by type
  const type = request.nextUrl.searchParams.get('type');
  let tasks: Record<string, unknown>[];

  if (type) {
    tasks = await queryAll('SELECT id, type, title, brief, status, output_data, created_at FROM tasks WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT 50', [userId, type]) as Record<string, unknown>[];
  } else {
    tasks = await queryAll('SELECT id, type, title, brief, status, output_data, created_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId]) as Record<string, unknown>[];
  }

  return NextResponse.json({ tasks });
}
