import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/database';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = await getDb();

  // Support filtering by type
  const type = request.nextUrl.searchParams.get('type');
  let query = 'SELECT id, type, title, brief, status, output_data, created_at FROM tasks';
  if (type) {
    query += ' WHERE type = ?';
  }
  query += ' ORDER BY created_at DESC LIMIT 50';

  const tasks = type
    ? db.prepare(query).all(type) as Record<string, unknown>[]
    : db.prepare(query).all() as Record<string, unknown>[];

  return NextResponse.json({ tasks });
}
