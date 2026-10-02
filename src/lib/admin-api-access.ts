const ADMIN_ONLY_API_PREFIXES = [
  '/api/dashboard/tokens',
  '/api/admin/users',
  '/api/admin/departments',
  '/api/templates',
  '/api/calendar',
  '/api/knowledge',
  '/api/brand-guidelines',
];

/** Exact paths a signed-in member may call even when the prefix is admin-only. */
const MEMBER_ALLOWED_EXACT = ['/api/knowledge/save'];

/**
 * Whether `getSession` should reject non-admins for this API call.
 * Listing brand guidelines is allowed for any signed-in user so Social Post can
 * load that user's own rows. Creating, editing, and deleting them stays admin-only.
 */
export function requiresAdminApiAccess(pathname: string, method: string): boolean {
  if (MEMBER_ALLOWED_EXACT.includes(pathname)) return false;
  if (pathname === '/api/brand-guidelines' && method.toUpperCase() === 'GET') return false;
  return ADMIN_ONLY_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
