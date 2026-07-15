import { NextRequest, NextResponse } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const db = await getDb();
  const type = request.nextUrl.searchParams.get('type');
  const platform = request.nextUrl.searchParams.get('platform');

  let query = 'SELECT * FROM templates WHERE user_id = ?';
  const params: unknown[] = [userId];

  if (type) { query += ' AND type = ?'; params.push(type); }
  if (platform) { query += ' AND platform = ?'; params.push(platform); }
  query += ' ORDER BY use_count DESC, created_at DESC';

  const templates = db.prepare(query).all(...params) as Record<string, unknown>[];

  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const db = await getDb();
  const { name, type, platform, brief_template, output_template, tags } = await request.json();
  if (!name || !type) return NextResponse.json({ error: 'name and type are required' }, { status: 400 });

  const id = uuidv4();
  db.prepare(
    'INSERT INTO templates (id, user_id, name, type, platform, brief_template, output_template, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, name, type, platform || null, brief_template || null, output_template ? JSON.stringify(output_template) : null, tags || null);
  saveDbToDisk();

  return NextResponse.json({ success: true, id });
}

export async function PUT(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const db = await getDb();
  const { id, name, type, platform, brief_template, output_template, tags, increment_use } = await request.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  if (increment_use) {
    db.prepare('UPDATE templates SET use_count = use_count + 1 WHERE id = ? AND user_id = ?').run(id, userId);
    saveDbToDisk();
    return NextResponse.json({ success: true });
  }

  const fields: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (type !== undefined) { fields.push('type = ?'); params.push(type); }
  if (platform !== undefined) { fields.push('platform = ?'); params.push(platform); }
  if (brief_template !== undefined) { fields.push('brief_template = ?'); params.push(brief_template); }
  if (output_template !== undefined) { fields.push('output_template = ?'); params.push(typeof output_template === 'string' ? output_template : JSON.stringify(output_template)); }
  if (tags !== undefined) { fields.push('tags = ?'); params.push(tags); }

  if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  params.push(id, userId);
  db.prepare(`UPDATE templates SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
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

  db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, userId);
  saveDbToDisk();

  return NextResponse.json({ success: true });
}
