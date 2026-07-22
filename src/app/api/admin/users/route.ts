import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, execute } from '@/lib/database';
import { getSession, AuthResult, AuthError } from '@/lib/auth';

async function requireAdmin(request: NextRequest): Promise<{ userId: string } | NextResponse> {
  const auth = await getSession(request);
  if ('status' in auth) return NextResponse.json({ error: auth.error, status: auth.status }, { status: auth.status });
  const user = await queryOne('SELECT role FROM users WHERE id = ?', [(auth as AuthResult).userId]) as { role: string } | undefined;
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
  }

  return { userId: (auth as AuthResult).userId };
}

// GET: List all users
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const rows = await queryAll("SELECT id, username, name, role, last_active, created_at, updated_at FROM users ORDER BY created_at DESC", []) as Record<string, unknown>[];

  return NextResponse.json({ users: rows });
}

// POST: Create a new user
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { username, name, password, role } = await request.json();

  if (!username || !name || !password) {
    return NextResponse.json({ error: 'username, name, and password are required' }, { status: 400 });
  }

  if (role && !['admin', 'member'].includes(role)) {
    return NextResponse.json({ error: 'role must be admin or member' }, { status: 400 });
  }

  // Check for duplicate username
  const existing = await queryOne('SELECT id FROM users WHERE username = ?', [username]) as { id: string } | undefined;
  if (existing) {
    return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
  }

  const hash = bcrypt.hashSync(password, 10);
  const id = uuidv4();
  const finalRole = role || 'member';

  await execute('INSERT INTO users (id, username, name, password_hash, role) VALUES (?, ?, ?, ?, ?)', [id, username, name, hash, finalRole]);

  const created = await queryOne('SELECT id, username, name, role, last_active, created_at FROM users WHERE id = ?', [id]) as Record<string, unknown>;

  return NextResponse.json({ user: created }, { status: 201 });
}

// PUT: Update a user
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id, username, name, password, role } = await request.json();

  if (!id) {
    return NextResponse.json({ error: 'User id is required' }, { status: 400 });
  }

  const existing = await queryOne('SELECT * FROM users WHERE id = ?', [id]) as Record<string, unknown> | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Check new username isn't taken by another user
  if (username && username !== existing.username) {
    const duplicate = await queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]) as { id: string } | undefined;
    if (duplicate) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    }
  }

  if (role && !['admin', 'member'].includes(role)) {
    return NextResponse.json({ error: 'role must be admin or member' }, { status: 400 });
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (username !== undefined) { updates.push('username = ?'); params.push(username); }
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (role !== undefined) { updates.push('role = ?'); params.push(role); }
  if (password !== undefined) {
    const hash = bcrypt.hashSync(password, 10);
    updates.push('password_hash = ?');
    params.push(hash);
  }

  if (updates.length > 0) {
    updates.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);
    await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
      }

  const updated = await queryOne('SELECT id, username, name, role, last_active, created_at, updated_at FROM users WHERE id = ?', [id]) as Record<string, unknown>;

  return NextResponse.json({ user: updated });
}

// DELETE: Remove a user
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'User id is required' }, { status: 400 });
  }

  // Don't allow deleting yourself
  if (id === auth.userId) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  const existing = await queryOne('SELECT id, role FROM users WHERE id = ?', [id]) as { id: string; role: string } | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Delete related data first (FK constraints)
  await execute('DELETE FROM sessions WHERE user_id = ?', [id]);
  await execute('DELETE FROM token_logs WHERE user_id = ?', [id]);
  await execute('DELETE FROM assets WHERE user_id = ?', [id]);
  await execute('DELETE FROM brand_guidelines WHERE user_id = ?', [id]);
  await execute('DELETE FROM content_calendar WHERE user_id = ?', [id]);
  await execute('DELETE FROM templates WHERE user_id = ?', [id]);
  await execute('DELETE FROM user_preferences WHERE user_id = ?', [id]);
  await execute('DELETE FROM task_model_preferences WHERE user_id = ?', [id]);
  await execute('DELETE FROM knowledge_edges WHERE source_id IN (SELECT id FROM knowledge_entries WHERE user_id = ?) OR target_id IN (SELECT id FROM knowledge_entries WHERE user_id = ?)', [id, id]);
  await execute('DELETE FROM knowledge_entries WHERE user_id = ?', [id]);
  await execute('DELETE FROM user_style_preferences WHERE user_id = ?', [id]);
  await execute('DELETE FROM kanban_tasks WHERE user_id = ?', [id]);
  await execute('DELETE FROM tasks WHERE user_id = ?', [id]);
  await execute('DELETE FROM users WHERE id = ?', [id]);

  return NextResponse.json({ success: true });
}
