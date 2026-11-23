// src/lib/dpm-invitation/rules.ts
import type { InvitationEvent, ParsedResponse, ResponseFieldErrors, ResponseFilter } from './types';

export const NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const ALLERGY_NOTES_MAX = 200;
export const RESERVED_SLUGS = ['new', 'admin', 'api', 'image', 'thanks', 'edit'] as const;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const WIB_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** NFKC, collapse ordinary whitespace, trim. Other control characters are kept so CONTROL_CHARS can reject them. */
export function cleanText(raw: unknown): string {
  return String(raw ?? '').normalize('NFKC').replace(/[ \t\n\r\f\v\u00a0\u2028\u2029]+/g, ' ').trim();
}

export function slugIssue(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug) || slug.includes('--')) return 'Use 3–60 lowercase letters, numbers and hyphens.';
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return 'That word is reserved. Choose another link.';
  return null;
}

export function suggestSlug(name: string): string {
  return name
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
}

export function parseEventName(raw: unknown): Result<string> {
  const value = cleanText(raw);
  if (value.length < 2 || value.length > NAME_MAX || CONTROL_CHARS.test(value)) return { ok: false, error: 'Enter a name of 2–120 characters.' };
  return { ok: true, value };
}

export function isRegistrationOpen(event: Pick<InvitationEvent, 'status' | 'closesAt'>, now: Date): boolean {
  return event.status === 'open' && (event.closesAt === null || now.getTime() < event.closesAt.getTime());
}

export function toWibInputValue(date: Date | null): string {
  if (!date) return '';
  return new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 16);
}

/** Reads a datetime-local value (YYYY-MM-DDTHH:mm) as WIB. Empty or null clears it. */
export function parseClosesAtWib(raw: unknown, now: Date): Result<Date | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const value = String(raw).trim();
  if (!value) return { ok: true, value: null };
  const invalid = { ok: false as const, error: 'Enter a valid closing date and time.' };
  if (!WIB_INPUT.test(value)) return invalid;
  const date = new Date(`${value}:00+07:00`);
  // The round trip rejects dates JS would roll over, such as 30 February.
  if (Number.isNaN(date.getTime()) || toWibInputValue(date) !== value) return invalid;
  if (date.getTime() <= now.getTime()) return { ok: false, error: 'Closing time must be in the future.' };
  return { ok: true, value: date };
}

/** "20 Dec 2026, 18:05 WIB". Built by hand so the output does not depend on ICU data. */
export function formatWib(date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(wib.getUTCDate())} ${MONTHS[wib.getUTCMonth()]} ${wib.getUTCFullYear()}, ${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())} WIB`;
}

export function isValidEmail(email: string): boolean {
  return email.length <= EMAIL_MAX && EMAIL_PATTERN.test(email);
}

export function isResponseFilter(value: string): value is ResponseFilter {
  return value === 'all' || value === 'attending' || value === 'not-attending' || value === 'allergy';
}

function yesNo(raw: unknown): boolean | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

export function parseResponseInput(input: Record<string, unknown>): { ok: true; value: ParsedResponse } | { ok: false; fieldErrors: ResponseFieldErrors } {
  const errors: ResponseFieldErrors = {};
  const fullName = cleanText(input.fullName);
  if (fullName.length < 2 || CONTROL_CHARS.test(fullName)) errors.fullName = 'Please enter your full name.';
  else if (fullName.length > NAME_MAX) errors.fullName = 'Please use at most 120 characters.';

  const email = String(input.email ?? '').trim();
  if (!isValidEmail(email)) errors.email = 'Please enter a valid email address.';

  const attending = yesNo(input.attending);
  if (attending === null) errors.attending = 'Please choose Yes or No.';

  // Only read the allergy answers when they were shown: attending Yes, then allergy Yes.
  let hasAllergy: boolean | null = null;
  let allergyNotes: string | null = null;
  if (attending === true) {
    hasAllergy = yesNo(input.hasAllergy);
    if (hasAllergy === null) errors.hasAllergy = 'Please choose Yes or No.';
    if (hasAllergy === true) {
      const notes = cleanText(input.allergyNotes);
      if (!notes || CONTROL_CHARS.test(notes)) errors.allergyNotes = 'Please tell us what you are allergic to.';
      else if (notes.length > ALLERGY_NOTES_MAX) errors.allergyNotes = 'Please use at most 200 characters.';
      else allergyNotes = notes;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    value: { fullName, email, emailNormalized: email.toLowerCase(), attending: attending as boolean, hasAllergy, allergyNotes },
  };
}
