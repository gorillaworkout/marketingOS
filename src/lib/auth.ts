import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/database';
import { canAccessFeature, enabledFeaturesForUser, type GenerationFeature } from '@/lib/authorization';

export interface AuthResult {
  userId: string;
  error?: never;
}

export interface AuthError {
  userId?: never;
  error: string;
  status: number;
}

export interface AuthorizedUser {
  id: string;
  role: string;
  departmentId: string | null;
  departmentName: string | null;
  features: GenerationFeature[];
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
    const row = await queryOne<{ user_id: string }>('SELECT user_id FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP', [sessionId]);
    const userId = row?.user_id;

    if (!userId) {
      return { error: 'Unauthorized', status: 401 };
    }

    const adminOnlyPaths = [
      '/api/dashboard/tokens', '/api/admin/users', '/api/admin/departments',
      '/api/templates', '/api/calendar', '/api/images', '/api/generated-images', '/api/generate-image', '/api/knowledge',
      '/api/brand-guidelines', '/api/dashboard/history',
    ];
    if (adminOnlyPaths.some(path => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`))) {
      const user = await queryOne<{ role: string }>('SELECT role FROM users WHERE id = ?', [userId]);
      if (user?.role !== 'admin') return { error: 'Forbidden: admin only', status: 403 };
    }

    return { userId };
  } catch (e) {
    console.error('Auth check failed:', e);
    return { error: 'Internal error', status: 500 };
  }
}

export async function getAuthorizedUser(request: NextRequest): Promise<AuthorizedUser | AuthError> {
  const session = await getSession(request);
  if (!('userId' in session)) return session;
  const user = await queryOne<{ id: string; role: string; department_id: string | null; department_name: string | null; permitted_features: string[] | null }>(`
    SELECT u.id, u.role, u.department_id, d.name AS department_name, d.permitted_features
    FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?
  `, [session.userId]);
  if (!user) return { error: 'Unauthorized', status: 401 };
  const features = enabledFeaturesForUser({ role: user.role, features: user.permitted_features || [] });
  return { id: user.id, role: user.role, departmentId: user.department_id, departmentName: user.department_name, features };
}

export async function requireAdmin(request: NextRequest): Promise<AuthorizedUser | NextResponse> {
  const user = await getAuthorizedUser(request);
  if ('error' in user) return NextResponse.json({ error: user.error }, { status: user.status });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
  return user;
}

export async function requireFeature(request: NextRequest, feature: GenerationFeature): Promise<AuthorizedUser | AuthError> {
  const user = await getAuthorizedUser(request);
  if ('error' in user) return user;
  if (!canAccessFeature(user, feature)) return { error: `Forbidden: your department does not allow ${feature}`, status: 403 };
  return user;
}
