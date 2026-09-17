export const GENERATION_FEATURES = [
  'social-post',
  'video-script',
  'event-plan',
  'article-market-news',
  'market-research',
  'ai-research',
] as const;
export type GenerationFeature = typeof GENERATION_FEATURES[number];

/** Dashboard href for each generation feature. Last path segment is not always the feature id. */
export const DASHBOARD_FEATURE_HREFS = {
  'social-post': '/dashboard/social-post',
  'video-script': '/dashboard/video-script',
  'event-plan': '/dashboard/event-plan',
  'article-market-news': '/dashboard/sop',
  'market-research': '/dashboard/market-research',
  'ai-research': '/dashboard/ai-research',
} as const satisfies Record<GenerationFeature, string>;

export interface FeaturePrincipal {
  role: string;
  features: readonly string[];
}

export interface DashboardNavItem {
  href: string;
  adminOnly?: boolean;
  feature?: GenerationFeature;
}

export function isGenerationFeature(value: string): value is GenerationFeature {
  return (GENERATION_FEATURES as readonly string[]).includes(value);
}

export function canAccessFeature(principal: FeaturePrincipal, feature: GenerationFeature): boolean {
  return principal.role === 'admin' || principal.features.includes(feature);
}

export function enabledFeaturesForUser(principal: FeaturePrincipal): GenerationFeature[] {
  return GENERATION_FEATURES.filter(feature => canAccessFeature(principal, feature));
}

function normalizeDashboardPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '');
  return pathname;
}

export function generationFeatureFromPath(pathname: string): GenerationFeature | undefined {
  const normalized = normalizeDashboardPath(pathname);
  for (const feature of GENERATION_FEATURES) {
    if (DASHBOARD_FEATURE_HREFS[feature] === normalized) return feature;
  }
  return undefined;
}

export function isDashboardNavItemVisible(
  item: DashboardNavItem,
  principal: FeaturePrincipal | null | undefined,
): boolean {
  if (item.adminOnly) return principal?.role === 'admin';
  if (!item.feature) return true;
  if (!principal) return false;
  return canAccessFeature(principal, item.feature);
}

export function shouldBlockDashboardGenerationPath(
  principal: FeaturePrincipal,
  pathname: string,
): boolean {
  const feature = generationFeatureFromPath(pathname);
  if (!feature) return false;
  return !canAccessFeature(principal, feature);
}
