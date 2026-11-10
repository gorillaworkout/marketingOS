/**
 * Onboarding Reports access rules.
 *  - View:   admin, OR the user's department has `monthly-report`.
 *  - Upload: same as view (operators self-upload).
 * Everyone who can view sees the same report.
 * Access is granted only via Accounts → Departments. The monthly_report_access
 * table is unused leftover from the Access tab and is left in place (no destructive migration).
 */
import { MONTHLY_REPORT_FEATURE, canAccessFeature } from '@/lib/authorization';

export interface MonthlyReportPrincipal {
  role: string;
  features: readonly string[];
}

export type MonthlyReportPageAccess = 'allowed' | 'login' | 'forbidden';

export function canViewMonthlyReport(principal: MonthlyReportPrincipal): boolean {
  return canAccessFeature(principal, MONTHLY_REPORT_FEATURE);
}

export function canUploadMonthlyReport(principal: MonthlyReportPrincipal): boolean {
  return canViewMonthlyReport(principal);
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
