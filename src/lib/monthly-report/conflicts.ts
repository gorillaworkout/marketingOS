/**
 * Upload preview: how incoming onboarding rows compare with what is already
 * stored, grouped by the incoming Step Status. A changed row is a "conflict":
 * the same Document ID with different values (most often Pending → Approved
 * or Rejected after the CRM processed it). The upload overwrites it.
 */
import type { OnboardingRow } from './onboarding-parse';

export interface StoredEvent {
  documentId: string;
  eventAt: string;
  stepStatus: string;
  accountStatus: string | null;
  remarks: string | null;
  tradingAccountNo: string | null;
  step: string;
}

export interface ConflictGroup { stepStatus: string; new: number; changed: number; unchanged: number }
export interface StatusChange { from: string; to: string; count: number }
export interface ConflictSummary {
  new: number;
  changed: number;
  unchanged: number;
  byStepStatus: ConflictGroup[];
  statusChanges: StatusChange[];
}

const COMPARED: Array<keyof StoredEvent & keyof OnboardingRow> = ['eventAt', 'step', 'stepStatus', 'accountStatus', 'remarks', 'tradingAccountNo'];

function sameInstant(a: string, b: string) {
  return new Date(a).getTime() === new Date(b).getTime();
}

export function classifyConflicts(incoming: OnboardingRow[], stored: StoredEvent[]): ConflictSummary {
  const byId = new Map(stored.map(row => [row.documentId, row]));
  const groups = new Map<string, ConflictGroup>();
  const changes = new Map<string, StatusChange>();
  const totals = { new: 0, changed: 0, unchanged: 0 };
  for (const row of incoming) {
    const group = groups.get(row.stepStatus) ?? { stepStatus: row.stepStatus, new: 0, changed: 0, unchanged: 0 };
    groups.set(row.stepStatus, group);
    const old = byId.get(row.documentId);
    if (!old) { group.new += 1; totals.new += 1; continue; }
    const differs = COMPARED.some(key => (key === 'eventAt' ? !sameInstant(old.eventAt, row.eventAt) : (old[key] ?? null) !== (row[key] ?? null)));
    if (!differs) { group.unchanged += 1; totals.unchanged += 1; continue; }
    group.changed += 1;
    totals.changed += 1;
    if (old.stepStatus !== row.stepStatus) {
      const key = `${old.stepStatus}→${row.stepStatus}`;
      const change = changes.get(key) ?? { from: old.stepStatus, to: row.stepStatus, count: 0 };
      change.count += 1;
      changes.set(key, change);
    }
  }
  return {
    ...totals,
    byStepStatus: [...groups.values()].sort((a, b) => a.stepStatus.localeCompare(b.stepStatus)),
    statusChanges: [...changes.values()].sort((a, b) => b.count - a.count),
  };
}
