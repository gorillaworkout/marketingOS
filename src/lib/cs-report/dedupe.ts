import { createHash } from 'node:crypto';

/** Lower case, trimmed, single spaces. Used for Excel name aliases and dedupe keys. */
export function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Complaint dedupe key: date + UID + account + normalised description. */
export function complaintDedupeKey(input: { date: string; uid: string; account: string; description: string }): string {
  const raw = [input.date, normalizeText(input.uid), normalizeText(input.account), normalizeText(input.description)].join('|');
  return createHash('sha1').update(raw).digest('hex');
}
