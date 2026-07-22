import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne } from '@/lib/database';
import { getSession } from '@/lib/auth';

const SESSION_DURATION = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const { action, username, password } = await request.json();

  if (action === 'login') {
    const userResult = await queryOne<Record<string, unknown>>('SELECT * FROM users WHERE username = ?', [username]);

    if (!userResult?.id) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    const valid = bcrypt.compareSync(password, userResult.password_hash as string);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + SESSION_DURATION).toISOString();
    await execute('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [sessionId, userResult.id, expiresAt]);

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
      await execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
          }
    const response = NextResponse.json({ success: true });
    response.cookies.delete('session_id');
    return response;
  }

  if (action === 'check') {
    const sid = request.cookies.get('session_id')?.value || '';
    const session = await queryOne<Record<string, unknown>>(`
      SELECT s.*, u.username, u.name, u.role
      FROM sessions s JOIN users u ON s.user_id = u.id
      WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP
    `, [sid]);

    if (!session?.user_id) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    // Update last_active
    await execute('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?', [session.user_id as string]);

    return NextResponse.json({
      authenticated: true,
      user: { id: session.user_id, username: session.username, name: session.name, role: session.role }
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
