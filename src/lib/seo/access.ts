import { canAccessFeature, SEO_FEATURE } from '@/lib/authorization';

export interface SeoPrincipal {
  role: string;
  features: readonly string[];
}

export type SeoPageAccess = 'allowed' | 'login' | 'forbidden';

/** Page-level SEO OS decision used by the server layouts. */
export function seoPageAccess(principal: SeoPrincipal | null, options: { adminOnly?: boolean } = {}): SeoPageAccess {
  if (!principal) return 'login';
  if (options.adminOnly) return principal.role === 'admin' ? 'allowed' : 'forbidden';
  return canAccessFeature(principal, SEO_FEATURE) ? 'allowed' : 'forbidden';
}
