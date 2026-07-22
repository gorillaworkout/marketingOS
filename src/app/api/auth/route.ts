import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';

const SESSION_DURATION = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const { action, username, password } = await request.json();
  const db = await getDb();

  if (action === 'login') {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    stmt.bind([username]);
    let userResult: Record<string, unknown> | null = null;
    if (stmt.step()) {
      userResult = stmt.getAsObject();
    }
    stmt.free();

    if (!userResult?.id) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    const valid = bcrypt.compareSync(password, userResult.password_hash as string);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + SESSION_DURATION).toISOString();
    db.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [sessionId, userResult.id, expiresAt]);
    saveDbToDisk();

    const response = NextResponse.json({
      success: true,
      user: { id: userResult.id, username: userResult.username, name: userResult.name, role: userResult.role }
    });

    response.cookies.set('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_DURATION / 1000,
      path: '/',
    });

    return response;
  }

  if (action === 'logout') {
    const sessionId = request.cookies.get('session_id')?.value;
    if (sessionId) {
      db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
      saveDbToDisk();
    }
    const response = NextResponse.json({ success: true });
    response.cookies.delete('session_id');
    return response;
  }

  if (action === 'check') {
    const sid = request.cookies.get('session_id')?.value || '';
    const stmt = db.prepare(`
      SELECT s.*, u.username, u.name, u.role
      FROM sessions s JOIN users u ON s.user_id = u.id
      WHERE s.id = ? AND s.expires_at > datetime('now')
    `);
    stmt.bind([sid]);
    let session: Record<string, unknown> | null = null;
    if (stmt.step()) {
      session = stmt.getAsObject();
    }
    stmt.free();

    if (!session?.user_id) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    // Update last_active
    db.run("UPDATE users SET last_active = datetime('now') WHERE id = ?", [session.user_id as string]);

    return NextResponse.json({
      authenticated: true,
      user: { id: session.user_id, username: session.username, name: session.name, role: session.role }
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
