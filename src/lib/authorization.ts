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

/** SEO OS (Search Console dashboard and later SEO tools). Not a generation workflow. */
export const SEO_FEATURE = 'seo' as const;

/**
 * Onboarding Reports. Assignable per department on Accounts only.
 * Access is admin, or the user's department has `monthly-report`.
 * There is no per-user personal grant.
 */
export const MONTHLY_REPORT_FEATURE = 'monthly-report' as const;

/**
 * Settlement Report. Own menu and feature, separate from Onboarding.
 * Assignable per department on Accounts only. Access is admin, or the user's
 * department has `settlement-report`. The Settlement department has it by default
 * (migration 046). There is no per-user personal grant.
 */
export const SETTLEMENT_REPORT_FEATURE = 'settlement-report' as const;

/**
 * Partnership division tools (Competitor Intelligence; later Proposal Builder and Global Trends).
 * Assignable per department on Accounts. Migration 057 creates a Partnership department with it.
 */
export const PARTNERSHIP_FEATURE = 'partnership' as const;

/**
 * Paid Media division: Google Ads reporting (read-only sync of every account under the MCC).
 * Assignable per department on Accounts. Migration 066 creates a Paid Media department with it.
 */
export const GOOGLE_ADS_FEATURE = 'google-ads' as const;

/**
 * Customer Service division: CS Report (daily agent input, dashboard, bulk upload, export).
 * Assignable per department on Accounts. Migration 069 creates a Customer Service department with it.
 * View = input = upload. No per-user personal grant.
 */
export const CS_REPORT_FEATURE = 'cs-report' as const;

/**
 * Features an admin can assign per department on Accounts.
 * Generation workflows stay in GENERATION_FEATURES so model routing is unchanged.
 * FAQ & Guides (`internal-docs`) is first so it sits at the top of the Accounts list.
 */
export const ACCOUNT_FEATURES = [INTERNAL_DOCS_FEATURE, ...GENERATION_FEATURES, SEO_FEATURE, MONTHLY_REPORT_FEATURE, SETTLEMENT_REPORT_FEATURE, PARTNERSHIP_FEATURE, GOOGLE_ADS_FEATURE, CS_REPORT_FEATURE] as const;
export type AccountFeature = typeof ACCOUNT_FEATURES[number];

export const ACCOUNT_FEATURE_LABELS: Record<AccountFeature, string> = {
  'social-post': 'Social Post',
  'video-script': 'Video Script',
  'event-plan': 'Event Plan',
  'article-market-news': 'Article Market News',
  'market-research': 'Market Research',
  'ai-research': 'AI Research',
  'internal-docs': 'FAQ & Guides',
  seo: 'SEO OS',
  'monthly-report': 'Onboarding Reports',
  'settlement-report': 'Settlement Report',
  partnership: 'Partnership',
  'google-ads': 'Google Ads',
  'cs-report': 'CS Report',
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
  seo: '/dashboard/seo',
  'monthly-report': '/dashboard/monthly-report',
  'settlement-report': '/dashboard/settlement-report',
  partnership: '/dashboard/partnership',
  'google-ads': '/dashboard/paid-media/google-ads',
  'cs-report': '/dashboard/cs-report',
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

/** Features whose whole route tree (href and every nested path) belongs to the feature. */
const PREFIX_MATCHED_FEATURES = [INTERNAL_DOCS_FEATURE, SEO_FEATURE, MONTHLY_REPORT_FEATURE, SETTLEMENT_REPORT_FEATURE, PARTNERSHIP_FEATURE, GOOGLE_ADS_FEATURE, CS_REPORT_FEATURE] as const;

/**
 * Dashboard pages that belong to an existing feature without being its main href.
 * Generate Image grew out of Social Post (which is now caption-only), so the
 * same Social Post grant opens it. Keyword Trends (Paid Media) opens with the
 * Google Ads grant. No new Accounts feature, no migration.
 */
export const DASHBOARD_FEATURE_ALIAS_HREFS: Readonly<Record<string, AccountFeature>> = {
  '/dashboard/generate-image': 'social-post',
  // Paid Media / Keyword Trends: same Paid Media grant as Google Ads.
  '/dashboard/paid-media/keyword-trends': 'google-ads',
};

/** Exact href match, plus nested routes for prefix-matched features (Internal Docs, SEO OS, Onboarding, Settlement, Partnership, Google Ads). */
export function accountFeatureFromPath(pathname: string): AccountFeature | undefined {
  const normalized = normalizeDashboardPath(pathname);
  const alias = DASHBOARD_FEATURE_ALIAS_HREFS[normalized];
  if (alias) return alias;
  for (const feature of PREFIX_MATCHED_FEATURES) {
    const href = DASHBOARD_FEATURE_HREFS[feature];
    if (normalized === href || normalized.startsWith(`${href}/`)) return feature;
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
