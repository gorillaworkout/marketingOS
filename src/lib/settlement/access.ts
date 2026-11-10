/**
 * Settlement Report access rules.
 *  - View:   admin, OR the user's department has `settlement-report`.
 *  - Upload: same as view.
 * Access is granted only via Accounts → Departments. The settlement_report_access
 * table is unused leftover from phase 1 and is left in place (no destructive migration).
 */
import { SETTLEMENT_REPORT_FEATURE, canAccessFeature } from '@/lib/authorization';

export interface SettlementReportPrincipal {
  role: string;
  features: readonly string[];
}

export type SettlementReportPageAccess = 'allowed' | 'login' | 'forbidden';

export function canViewSettlementReport(principal: SettlementReportPrincipal): boolean {
  return canAccessFeature(principal, SETTLEMENT_REPORT_FEATURE);
}

export function canUploadSettlementReport(principal: SettlementReportPrincipal): boolean {
  return canViewSettlementReport(principal);
}

export function settlementReportPageAccess(
  principal: SettlementReportPrincipal | null,
  options: { adminOnly?: boolean; upload?: boolean } = {},
): SettlementReportPageAccess {
  if (!principal) return 'login';
  if (options.adminOnly) return principal.role === 'admin' ? 'allowed' : 'forbidden';
  if (options.upload) return canUploadSettlementReport(principal) ? 'allowed' : 'forbidden';
  return canViewSettlementReport(principal) ? 'allowed' : 'forbidden';
}

/** API variant: null when allowed, otherwise the error to return. */
export function settlementReportApiAccess(
  principal: SettlementReportPrincipal,
  options: { adminOnly?: boolean; upload?: boolean } = {},
): { error: string; status: number } | null {
  if (!canViewSettlementReport(principal)) return { error: 'Forbidden: you do not have access to Settlement Report', status: 403 };
  if (options.adminOnly && principal.role !== 'admin') return { error: 'Forbidden: admin only', status: 403 };
  if (options.upload && !canUploadSettlementReport(principal)) return { error: 'Forbidden: upload rights are required', status: 403 };
  return null;
}
