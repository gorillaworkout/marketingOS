import { COUNT_FIELDS, DEFAULT_FOLLOW_UP_MINUTES, STATUSES, type CsStatus } from './fields';
import { isIsoDate } from './dates';
import type { ComplaintInput, DailyEntryInput } from './types';

const MAX_TEXT = 2000;
const MAX_COUNT = 100_000;

type Result<T> = { value: T } | { error: string };

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function count(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) return 'invalid';
  return n;
}

/**
 * Validates a daily entry from the form. Present: every count is required (0 allowed).
 * Sick / Annual Leave: counts are optional and stored as null when blank.
 */
export function parseDailyEntryInput(body: unknown, today: string): Result<DailyEntryInput> {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body.' };
  const raw = body as Record<string, unknown>;
  const date = raw.date;
  if (!isIsoDate(date)) return { error: 'Pick a valid date.' };
  if (date > today) return { error: 'The date cannot be in the future.' };
  const status = raw.status as CsStatus;
  if (!STATUSES.includes(status)) return { error: 'Pick a status: Present, Sick, or Annual Leave.' };
  const out: Partial<DailyEntryInput> = { date, status };
  for (const field of COUNT_FIELDS) {
    const parsed = count(raw[field.key]);
    if (parsed === 'invalid') return { error: `${field.label} must be a whole number of 0 or more.` };
    if (parsed === null && status === 'present') return { error: `${field.label} is required (enter 0 if none).` };
    out[field.key] = parsed;
  }
  const minutes = raw.followUpMinutes === undefined || raw.followUpMinutes === '' || raw.followUpMinutes === null ? DEFAULT_FOLLOW_UP_MINUTES : Number(raw.followUpMinutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return { error: 'Follow-up minutes must be between 1 and 240.' };
  out.followUpMinutes = minutes;
  out.unsolvedUids = text(raw.unsolvedUids, 1000);
  out.frequentQuestion = text(raw.frequentQuestion);
  out.difficultQuestion = text(raw.difficultQuestion);
  return { value: out as DailyEntryInput };
}

export function parseComplaintInput(body: unknown, today: string): Result<ComplaintInput> {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body.' };
  const raw = body as Record<string, unknown>;
  if (!isIsoDate(raw.date)) return { error: 'Pick a valid complaint date.' };
  if (raw.date > today) return { error: 'The complaint date cannot be in the future.' };
  const completion = raw.completionDate === '' || raw.completionDate === null || raw.completionDate === undefined ? null : raw.completionDate;
  if (completion !== null && !isIsoDate(completion)) return { error: 'Completion date is not a valid date.' };
  if (completion !== null && completion < raw.date) return { error: 'Completion date cannot be before the complaint date.' };
  const value: ComplaintInput = {
    date: raw.date,
    clientName: text(raw.clientName, 200),
    uid: text(raw.uid, 100),
    account: text(raw.account, 100),
    platform: text(raw.platform, 100),
    description: text(raw.description),
    cause: text(raw.cause),
    resolution: text(raw.resolution),
    completionDate: completion,
    status: text(raw.status, 100),
    slaMet: raw.slaMet === true || raw.slaMet === 'yes' ? true : raw.slaMet === false || raw.slaMet === 'no' ? false : null,
    urgency: text(raw.urgency, 100),
    category: text(raw.category, 200),
  };
  if (!value.description) return { error: 'Describe the complaint.' };
  if (!value.uid && !value.clientName) return { error: 'Enter the client name or UID.' };
  return { value };
}
