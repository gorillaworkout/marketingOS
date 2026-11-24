/**
 * CS Report access: admin, or the user's department has `cs-report`.
 * View = daily input = bulk upload. An agent writes only their own daily entry
 * and complaints; admins may correct any agent's.
 */
import { CS_REPORT_FEATURE, canAccessFeature } from '@/lib/authorization';
import type { Complaint } from './types';

export interface CsPrincipal { id?: string; role: string; features: readonly string[] }

export function canUseCsReport(principal: CsPrincipal | null | undefined): boolean {
  return Boolean(principal && canAccessFeature(principal, CS_REPORT_FEATURE));
}

export function canEditComplaint(principal: CsPrincipal & { id: string }, ownAgentId: string | null, complaint: Pick<Complaint, 'agentId' | 'createdBy'>): boolean {
  if (principal.role === 'admin') return true;
  return complaint.createdBy === principal.id || (ownAgentId !== null && complaint.agentId === ownAgentId);
}
