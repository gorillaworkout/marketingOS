import { timingSafeEqual } from 'node:crypto';

/** Shared-secret check for the weekly refresh endpoint. */
export function partnershipCronAuthorization(provided: string | null | undefined, expected = process.env.PARTNERSHIP_CRON_SECRET || ''): 'ok' | 'missing' | 'rejected' {
  const secret = expected.trim();
  if (!secret) return 'missing';
  const left = Buffer.from((provided || '').trim());
  const right = Buffer.from(secret);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return 'rejected';
  return 'ok';
}
