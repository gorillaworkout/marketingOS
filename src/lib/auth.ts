import { NextRequest } from 'next/server';
import { getDb } from '@/lib/database';

export interface AuthResult {
  userId: string;
  error?: never;
}

export interface AuthError {
  userId?: never;
  error: string;
  status: number;
}

/**
 * Validates the session from the request cookie and returns the userId.
 * Returns { userId } on success, or { error, status } on failure.
 */
export async function getSession(request: NextRequest): Promise<AuthResult | AuthError> {
  const sessionId = request.cookies.get('session_id')?.value;
  if (!sessionId) {
    return { error: 'Unauthorized', status: 401 };
  }

  try {
    const db = await getDb();
    const stmt = db.prepare(
      'SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime("now")'
    );
    stmt.bind([sessionId]);
    let userId: string | null = null;
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      userId = obj.user_id as string;
    }
    stmt.free();

    if (!userId) {
      return { error: 'Unauthorized', status: 401 };
    }

    return { userId };
  } catch (e) {
    console.error('Auth check failed:', e);
    return { error: 'Internal error', status: 500 };
  }
}
