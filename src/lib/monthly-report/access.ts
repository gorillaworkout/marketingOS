/**
 * Monthly Report access rules.
 *  - View:   admin, OR the user's department has `monthly-report`, OR a row in
 *            monthly_report_access (personal grant).
 *  - Upload: admin, OR a personal grant with can_upload = true.
 * Everyone who can view sees the same report.
 */
import { MONTHLY_REPORT_FEATURE, canAccessFeature } from '@/lib/authorization';

export interface MonthlyReportPrincipal {
  role: string;
  features: readonly string[];
  monthlyReportUpload?: boolean;
}

export type MonthlyReportPageAccess = 'allowed' | 'login' | 'forbidden';

/**
 * Correlated sub-select used by every session query. NULL = no personal grant;
 * false/true = granted, with or without upload rights. Expects users aliased `u`.
 */
export const MONTHLY_REPORT_GRANT_SQL = '(SELECT mra.can_upload FROM monthly_report_access mra WHERE mra.user_id = u.id) AS monthly_report_grant';

/** Department features plus `monthly-report` when the user has a personal grant. */
export function departmentFeaturesWithGrants(departmentFeatures: readonly string[] | null | undefined, grant: boolean | null | undefined): string[] {
  const features = [...(departmentFeatures ?? [])];
  if (grant !== null && grant !== undefined && !features.includes(MONTHLY_REPORT_FEATURE)) features.push(MONTHLY_REPORT_FEATURE);
  return features;
}

export function canViewMonthlyReport(principal: MonthlyReportPrincipal): boolean {
  return canAccessFeature(principal, MONTHLY_REPORT_FEATURE);
}

export function canUploadMonthlyReport(principal: MonthlyReportPrincipal): boolean {
  if (principal.role === 'admin') return true;
  return canViewMonthlyReport(principal) && principal.monthlyReportUpload === true;
}

export function monthlyReportPageAccess(
  principal: MonthlyReportPrincipal | null,
  options: { adminOnly?: boolean; upload?: boolean } = {},
): MonthlyReportPageAccess {
  if (!principal) return 'login';
  if (options.adminOnly) return principal.role === 'admin' ? 'allowed' : 'forbidden';
  if (options.upload) return canUploadMonthlyReport(principal) ? 'allowed' : 'forbidden';
  return canViewMonthlyReport(principal) ? 'allowed' : 'forbidden';
}

/** API variant: null when allowed, otherwise the error to return. */
export function monthlyReportApiAccess(
  principal: MonthlyReportPrincipal,
  options: { adminOnly?: boolean; upload?: boolean } = {},
): { error: string; status: number } | null {
  if (!canViewMonthlyReport(principal)) return { error: 'Forbidden: you do not have access to Onboarding Reports', status: 403 };
  if (options.adminOnly && principal.role !== 'admin') return { error: 'Forbidden: admin only', status: 403 };
  if (options.upload && !canUploadMonthlyReport(principal)) return { error: 'Forbidden: upload rights are required', status: 403 };
  return null;
}
