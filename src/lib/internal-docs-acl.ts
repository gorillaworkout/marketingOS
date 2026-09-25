/**
 * Internal Docs ACL.
 *
 * MarketingOS has no separate IT role. Accounts are `admin` or `member`, and
 * members belong to a department (Marketing, Settlement, Finance, …).
 * Migration 020 seeds a department named `IT`.
 *
 * - Admins can read and manage Company and IT-only documents.
 * - Members of the IT department can read and manage Company and IT-only documents.
 * - Every other signed-in employee can read Company documents only.
 *
 * Assign IT access by putting the person in the IT department. Do not invent
 * a second role flag. Queries must still filter `access_level` in SQL.
 */

export const IT_DEPARTMENT_NAME = 'IT';
export const INTERNAL_DOC_ACCESS_LEVELS = ['company', 'it-only'] as const;
export type InternalDocAccessLevel = typeof INTERNAL_DOC_ACCESS_LEVELS[number];

export interface InternalDocsPrincipal {
  role: string;
  departmentName: string | null;
}

export function isItDepartment(departmentName: string | null | undefined): boolean {
  return (departmentName || '').trim().toLowerCase() === IT_DEPARTMENT_NAME.toLowerCase();
}

/** IT department members and admins can read IT-only documents. */
export function canReadItOnlyInternalDocs(principal: InternalDocsPrincipal): boolean {
  return principal.role === 'admin' || isItDepartment(principal.departmentName);
}

/** Upload, reindex, access changes, and delete. Same gate as IT-only read. */
export function canManageInternalDocs(principal: InternalDocsPrincipal): boolean {
  return canReadItOnlyInternalDocs(principal);
}

export function allowedAccessLevels(principal: InternalDocsPrincipal): InternalDocAccessLevel[] {
  return canReadItOnlyInternalDocs(principal) ? ['company', 'it-only'] : ['company'];
}

export function isInternalDocAccessLevel(value: string): value is InternalDocAccessLevel {
  return (INTERNAL_DOC_ACCESS_LEVELS as readonly string[]).includes(value);
}

export function isInternalDocVisible(accessLevel: string, principal: InternalDocsPrincipal): boolean {
  return allowedAccessLevels(principal).includes(accessLevel as InternalDocAccessLevel);
}
