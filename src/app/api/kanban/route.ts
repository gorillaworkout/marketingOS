import { NextRequest, NextResponse } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId as string;

  const db = await getDb();

  // Ensure table exists
  db.exec(`CREATE TABLE IF NOT EXISTS kanban_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    assignee TEXT,
    status TEXT DEFAULT 'ready' CHECK(status IN ('ready', 'running', 'blocked', 'completed', 'archived')),
    priority INTEGER DEFAULT 2,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    result TEXT
  )`);

  const status = request.nextUrl.searchParams.get('status');
  const assignee = request.nextUrl.searchParams.get('assignee');

  let query = 'SELECT * FROM kanban_tasks WHERE user_id = ? AND status != ?';
  const params: unknown[] = [userId, 'archived'];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (assignee) {
    query += ' AND assignee = ?';
    params.push(assignee);
  }
  query += ' ORDER BY priority ASC, created_at DESC';

  const tasks = db.prepare(query).all(...params) as Record<string, unknown>[];
  return NextResponse.json({ tasks });
}

export async function POST(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId as string;

  const db = await getDb();
  const { title, body, assignee, priority } = await request.json();
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  // Ensure table exists
  db.exec(`CREATE TABLE IF NOT EXISTS kanban_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    assignee TEXT,
    status TEXT DEFAULT 'ready' CHECK(status IN ('ready', 'running', 'blocked', 'completed', 'archived')),
    priority INTEGER DEFAULT 2,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    result TEXT
  )`);

  const id = uuidv4();
  db.prepare(
    'INSERT INTO kanban_tasks (id, user_id, title, body, assignee, status, priority) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, title, body || null, assignee || null, 'ready', priority || 2);
  saveDbToDisk();

  return NextResponse.json({ success: true, id });
}

export async function PUT(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId as string;

  const db = await getDb();
  const { id, title, body, assignee, status, priority, result } = await request.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const fields: string[] = [];
  const params: unknown[] = [];

  if (title !== undefined) { fields.push('title = ?'); params.push(title); }
  if (body !== undefined) { fields.push('body = ?'); params.push(body); }
  if (assignee !== undefined) { fields.push('assignee = ?'); params.push(assignee); }
  if (priority !== undefined) { fields.push('priority = ?'); params.push(priority); }
  if (result !== undefined) { fields.push('result = ?'); params.push(result); }

  if (status !== undefined) {
    fields.push('status = ?');
    params.push(status);
    if (status === 'running') {
      fields.push("started_at = datetime('now')");
    } else if (status === 'completed') {
      fields.push("completed_at = datetime('now')");
    }
  }

  if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  params.push(id, userId);
  db.prepare(`UPDATE kanban_tasks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  saveDbToDisk();

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId as string;

  const db = await getDb();
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  db.prepare('DELETE FROM kanban_tasks WHERE id = ? AND user_id = ?').run(id, userId);
  saveDbToDisk();

  return NextResponse.json({ success: true });
}
