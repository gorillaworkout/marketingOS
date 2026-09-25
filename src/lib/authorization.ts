export const GENERATION_FEATURES = [
  'social-post',
  'video-script',
  'event-plan',
  'article-market-news',
  'market-research',
  'ai-research',
] as const;
export type GenerationFeature = typeof GENERATION_FEATURES[number];

/** Accounts feature that is not a model-routed generation workflow. */
export const INTERNAL_DOCS_FEATURE = 'internal-docs' as const;

/**
 * Features an admin can assign per department on Accounts.
 * Generation workflows stay in GENERATION_FEATURES so model routing is unchanged.
 * Internal Docs is included so access can be turned off without a separate system.
 */
export const ACCOUNT_FEATURES = [...GENERATION_FEATURES, INTERNAL_DOCS_FEATURE] as const;
export type AccountFeature = typeof ACCOUNT_FEATURES[number];

export const ACCOUNT_FEATURE_LABELS: Record<AccountFeature, string> = {
  'social-post': 'Social Post',
  'video-script': 'Video Script',
  'event-plan': 'Event Plan',
  'article-market-news': 'Article Market News',
  'market-research': 'Market Research',
  'ai-research': 'AI Research',
  'internal-docs': 'Internal Docs',
};

/** Dashboard href for each account feature. Last path segment is not always the feature id. */
export const DASHBOARD_FEATURE_HREFS = {
  'social-post': '/dashboard/social-post',
  'video-script': '/dashboard/video-script',
  'event-plan': '/dashboard/event-plan',
  'article-market-news': '/dashboard/sop',
  'market-research': '/dashboard/market-research',
  'ai-research': '/dashboard/ai-research',
  'internal-docs': '/dashboard/internal-docs',
} as const satisfies Record<AccountFeature, string>;

export interface FeaturePrincipal {
  role: string;
  features: readonly string[];
}

export interface DashboardNavItem {
  href: string;
  adminOnly?: boolean;
  feature?: AccountFeature;
}

export function isGenerationFeature(value: string): value is GenerationFeature {
  return (GENERATION_FEATURES as readonly string[]).includes(value);
}

export function isAccountFeature(value: string): value is AccountFeature {
  return (ACCOUNT_FEATURES as readonly string[]).includes(value);
}

export function canAccessFeature(principal: FeaturePrincipal, feature: AccountFeature): boolean {
  return principal.role === 'admin' || principal.features.includes(feature);
}

/** Image generation stays tied to generation workflows, not every Accounts feature. */
export function hasGenerationFeature(principal: FeaturePrincipal): boolean {
  return GENERATION_FEATURES.some(feature => canAccessFeature(principal, feature));
}

export function enabledFeaturesForUser(principal: FeaturePrincipal): AccountFeature[] {
  return ACCOUNT_FEATURES.filter(feature => canAccessFeature(principal, feature));
}

function normalizeDashboardPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '');
  return pathname;
}

export function generationFeatureFromPath(pathname: string): GenerationFeature | undefined {
  const feature = accountFeatureFromPath(pathname);
  return feature && isGenerationFeature(feature) ? feature : undefined;
}

/** Exact href match, plus nested Internal Docs document routes. */
export function accountFeatureFromPath(pathname: string): AccountFeature | undefined {
  const normalized = normalizeDashboardPath(pathname);
  const internalDocsHref = DASHBOARD_FEATURE_HREFS[INTERNAL_DOCS_FEATURE];
  if (normalized === internalDocsHref || normalized.startsWith(`${internalDocsHref}/`)) {
    return INTERNAL_DOCS_FEATURE;
  }
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
  const feature = accountFeatureFromPath(pathname);
  if (!feature) return false;
  return !canAccessFeature(principal, feature);
}
