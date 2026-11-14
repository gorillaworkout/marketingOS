const ADMIN_ONLY_API_PREFIXES = [
  '/api/dashboard/tokens',
  '/api/admin/users',
  '/api/admin/departments',
  '/api/templates',
  '/api/calendar',
  '/api/knowledge',
  '/api/brand-guidelines',
  '/api/seo/sync',
  '/api/seo/settings',
];

/** Exact paths a signed-in member may call even when the prefix is admin-only. */
const MEMBER_ALLOWED_EXACT = ['/api/knowledge/save'];

/**
 * Whether `getSession` should reject non-admins for this API call.
 * Brand guidelines are not blanket admin-only: any signed-in user may list
 * their own rows plus shared voices, and the route itself decides who may
 * write a personal voice or a shared one.
 */
export function requiresAdminApiAccess(pathname: string, method: string): boolean {
  void method;
  if (MEMBER_ALLOWED_EXACT.includes(pathname)) return false;
  if (pathname === '/api/brand-guidelines' || pathname.startsWith('/api/brand-guidelines/')) return false;
  return ADMIN_ONLY_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
