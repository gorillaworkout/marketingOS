/**
 * Upload preview: how incoming onboarding rows compare with what is already
 * stored, matched by the event key (Document ID + event time + Steps, see
 * `eventKey`), grouped by the incoming Step Status.
 *  - new: the event is not stored yet and will be inserted.
 *  - duplicate: the event is already stored; it is skipped (never overwritten).
 *    `duplicateDiffers` counts the duplicates whose other columns differ from the
 *    stored row (the stored row is kept), with any Step Status difference listed.
 *  - newEventForKnownDocument: new events whose Document ID already has a
 *    different event stored (e.g. Pending in September, decided in October).
 *    These are kept as separate rows.
 */
import { eventKey, sameEventValues, type OnboardingRow } from './onboarding-parse';

export type StoredEvent = OnboardingRow;

export interface ConflictGroup { stepStatus: string; new: number; duplicate: number }
export interface StatusChange { from: string; to: string; count: number }
export interface ConflictSummary {
  new: number;
  duplicate: number;
  duplicateDiffers: number;
  newEventForKnownDocument: number;
  byStepStatus: ConflictGroup[];
  /** Same event stored with another Step Status (stored → incoming); the stored value is kept. */
  statusChanges: StatusChange[];
}

export function classifyConflicts(incoming: OnboardingRow[], stored: StoredEvent[]): ConflictSummary {
  const byKey = new Map(stored.map(row => [eventKey(row), row]));
  const storedDocuments = new Set(stored.map(row => row.documentId));
  const groups = new Map<string, ConflictGroup>();
  const changes = new Map<string, StatusChange>();
  const totals = { new: 0, duplicate: 0, duplicateDiffers: 0, newEventForKnownDocument: 0 };
  for (const row of incoming) {
    const group = groups.get(row.stepStatus) ?? { stepStatus: row.stepStatus, new: 0, duplicate: 0 };
    groups.set(row.stepStatus, group);
    const old = byKey.get(eventKey(row));
    if (!old) {
      group.new += 1;
      totals.new += 1;
      if (storedDocuments.has(row.documentId)) totals.newEventForKnownDocument += 1;
      continue;
    }
    group.duplicate += 1;
    totals.duplicate += 1;
    if (sameEventValues(old, row)) continue;
    totals.duplicateDiffers += 1;
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
