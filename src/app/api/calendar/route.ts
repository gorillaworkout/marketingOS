import { NextRequest, NextResponse } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const db = await getDb();
  const startDate = request.nextUrl.searchParams.get('start');
  const endDate = request.nextUrl.searchParams.get('end');

  let query = `SELECT cc.*, t.title as task_title, t.type as task_type
    FROM content_calendar cc
    LEFT JOIN tasks t ON cc.task_id = t.id
    WHERE cc.user_id = ?`;
  const params: unknown[] = [userId];

  if (startDate) {
    query += ' AND cc.scheduled_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND cc.scheduled_date <= ?';
    params.push(endDate);
  }
  query += ' ORDER BY cc.scheduled_date ASC, cc.scheduled_time ASC';

  const items = db.prepare(query).all(...params) as Record<string, unknown>[];

  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const db = await getDb();
  const { task_id, platform, scheduled_date, scheduled_time, status, notes } = await request.json();
  if (!scheduled_date) return NextResponse.json({ error: 'scheduled_date is required' }, { status: 400 });

  const id = uuidv4();
  db.prepare(
    'INSERT INTO content_calendar (id, user_id, task_id, platform, scheduled_date, scheduled_time, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, task_id || null, platform || null, scheduled_date, scheduled_time || null, status || 'draft', notes || null);
  saveDbToDisk();

  return NextResponse.json({ success: true, id });
}

export async function PUT(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const db = await getDb();
  const { id, platform, scheduled_date, scheduled_time, status, notes, task_id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const fields: string[] = [];
  const params: unknown[] = [];

  if (platform !== undefined) { fields.push('platform = ?'); params.push(platform); }
  if (scheduled_date !== undefined) { fields.push('scheduled_date = ?'); params.push(scheduled_date); }
  if (scheduled_time !== undefined) { fields.push('scheduled_time = ?'); params.push(scheduled_time); }
  if (status !== undefined) { fields.push('status = ?'); params.push(status); }
  if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }
  if (task_id !== undefined) { fields.push('task_id = ?'); params.push(task_id || null); }

  if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  params.push(id, userId);
  db.prepare(`UPDATE content_calendar SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  saveDbToDisk();

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const db = await getDb();
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  db.prepare('DELETE FROM content_calendar WHERE id = ? AND user_id = ?').run(id, userId);
  saveDbToDisk();

  return NextResponse.json({ success: true });
}
