// src/lib/dpm-invitation/store.ts
import { randomUUID } from 'node:crypto';
import { execute, queryAll, queryOne } from '@/lib/database';
import type { InvitationEvent, InvitationResponse, InvitationStatus, ParsedResponse, ResponseCounts, ResponseFilter } from './types';

export class SlugTakenError extends Error {
  constructor() { super('That link is already used by another invitation.'); }
}

export type ImageInput = { key: string; mime: string; width: number; height: number };

type EventRow = {
  id: string; name: string; slug: string; status: InvitationStatus; closes_at: Date | null;
  image_key: string; image_mime: string; image_width: number; image_height: number; created_at: Date; updated_at: Date;
};
type ResponseRow = {
  id: string; event_id: string; full_name: string; email: string; attending: boolean; has_allergy: boolean | null;
  allergy_notes: string | null; submission_count: number; created_at: Date; updated_at: Date;
};
type CountRow = { total: number; attending: number; not_attending: number; with_allergies: number };

const EVENT_COLUMNS = 'id, name, slug, status, closes_at, image_key, image_mime, image_width, image_height, created_at, updated_at';
const COUNT_COLUMNS = `
  COUNT(r.id)::int AS total,
  COUNT(r.id) FILTER (WHERE r.attending)::int AS attending,
  COUNT(r.id) FILTER (WHERE NOT r.attending)::int AS not_attending,
  COUNT(r.id) FILTER (WHERE r.has_allergy)::int AS with_allergies`;

function toEvent(row: EventRow): InvitationEvent {
  return {
    id: row.id, name: row.name, slug: row.slug, status: row.status, closesAt: row.closes_at,
    imageKey: row.image_key, imageMime: row.image_mime, imageWidth: row.image_width, imageHeight: row.image_height,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function toResponse(row: ResponseRow): InvitationResponse {
  return {
    id: row.id, eventId: row.event_id, fullName: row.full_name, email: row.email, attending: row.attending,
    hasAllergy: row.has_allergy, allergyNotes: row.allergy_notes, submissionCount: row.submission_count,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function toCounts(row: CountRow | undefined): ResponseCounts {
  return { total: row?.total ?? 0, attending: row?.attending ?? 0, notAttending: row?.not_attending ?? 0, withAllergies: row?.with_allergies ?? 0 };
}

/** Postgres names the UNIQUE on slug `dpm_invitation_events_slug_key`. */
function isSlugConflict(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string };
  return e.code === '23505' && (e.constraint ?? '').includes('slug');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, char => `\\${char}`);
}

export async function listEvents(): Promise<Array<{ event: InvitationEvent; counts: ResponseCounts; lastResponseAt: Date | null }>> {
  const rows = await queryAll<EventRow & CountRow & { last_response_at: Date | null }>(`
    SELECT e.id, e.name, e.slug, e.status, e.closes_at, e.image_key, e.image_mime, e.image_width, e.image_height, e.created_at, e.updated_at,
      ${COUNT_COLUMNS}, MAX(r.updated_at) AS last_response_at
    FROM dpm_invitation_events e
    LEFT JOIN dpm_invitation_responses r ON r.event_id = e.id
    GROUP BY e.id
    ORDER BY e.created_at DESC`);
  return rows.map(row => ({ event: toEvent(row), counts: toCounts(row), lastResponseAt: row.last_response_at }));
}

export async function getEvent(id: string): Promise<InvitationEvent | null> {
  const row = await queryOne<EventRow>(`SELECT ${EVENT_COLUMNS} FROM dpm_invitation_events WHERE id = ?`, [id]);
  return row ? toEvent(row) : null;
}

export async function getEventBySlug(slug: string): Promise<InvitationEvent | null> {
  const row = await queryOne<EventRow>(`SELECT ${EVENT_COLUMNS} FROM dpm_invitation_events WHERE slug = ?`, [slug]);
  return row ? toEvent(row) : null;
}

export async function createEvent(input: { id: string; name: string; slug: string; closesAt: Date | null; image: ImageInput; userId: string }): Promise<InvitationEvent> {
  try {
    const row = await queryOne<EventRow>(`
      INSERT INTO dpm_invitation_events (id, name, slug, closes_at, image_key, image_mime, image_width, image_height, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING ${EVENT_COLUMNS}`,
    [input.id, input.name, input.slug, input.closesAt, input.image.key, input.image.mime, input.image.width, input.image.height, input.userId, input.userId]);
    return toEvent(row!);
  } catch (error) {
    if (isSlugConflict(error)) throw new SlugTakenError();
    throw error;
  }
}

export async function updateEvent(id: string, patch: { name?: string; slug?: string; status?: InvitationStatus; closesAt?: Date | null }, userId: string): Promise<InvitationEvent | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name); }
  if (patch.slug !== undefined) { sets.push('slug = ?'); values.push(patch.slug); }
  if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
  if (patch.closesAt !== undefined) { sets.push('closes_at = ?'); values.push(patch.closesAt); }
  sets.push('updated_by = ?', 'updated_at = CURRENT_TIMESTAMP');
  values.push(userId, id);
  try {
    const row = await queryOne<EventRow>(`UPDATE dpm_invitation_events SET ${sets.join(', ')} WHERE id = ? RETURNING ${EVENT_COLUMNS}`, values);
    return row ? toEvent(row) : null;
  } catch (error) {
    if (isSlugConflict(error)) throw new SlugTakenError();
    throw error;
  }
}

export async function replaceEventImage(id: string, image: ImageInput, userId: string): Promise<{ event: InvitationEvent; oldKey: string } | null> {
  const old = await queryOne<{ image_key: string }>('SELECT image_key FROM dpm_invitation_events WHERE id = ?', [id]);
  if (!old) return null;
  const row = await queryOne<EventRow>(`
    UPDATE dpm_invitation_events
    SET image_key = ?, image_mime = ?, image_width = ?, image_height = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? RETURNING ${EVENT_COLUMNS}`, [image.key, image.mime, image.width, image.height, userId, id]);
  return row ? { event: toEvent(row), oldKey: old.image_key } : null;
}

export async function deleteEvent(id: string): Promise<string | null> {
  const row = await queryOne<{ image_key: string }>('DELETE FROM dpm_invitation_events WHERE id = ? RETURNING image_key', [id]);
  return row?.image_key ?? null;
}

export async function countResponses(eventId: string): Promise<ResponseCounts> {
  return toCounts(await queryOne<CountRow>(`SELECT ${COUNT_COLUMNS} FROM dpm_invitation_responses r WHERE r.event_id = ?`, [eventId]));
}

export async function listResponses(eventId: string, options: { q?: string; filter?: ResponseFilter }): Promise<InvitationResponse[]> {
  const where = ['event_id = ?'];
  const values: unknown[] = [eventId];
  const q = (options.q ?? '').trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(`(full_name ILIKE ? ESCAPE '\\' OR email_normalized LIKE ? ESCAPE '\\')`);
    values.push(like, like.toLowerCase());
  }
  if (options.filter === 'attending') where.push('attending');
  if (options.filter === 'not-attending') where.push('NOT attending');
  if (options.filter === 'allergy') where.push('has_allergy');
  const rows = await queryAll<ResponseRow>(`
    SELECT id, event_id, full_name, email, attending, has_allergy, allergy_notes, submission_count, created_at, updated_at
    FROM dpm_invitation_responses WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id`, values);
  return rows.map(toResponse);
}

export async function upsertResponse(eventId: string, value: ParsedResponse): Promise<void> {
  await execute(`
    INSERT INTO dpm_invitation_responses (id, event_id, full_name, email, email_normalized, attending, has_allergy, allergy_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (event_id, email_normalized) DO UPDATE SET
      full_name = EXCLUDED.full_name, email = EXCLUDED.email, attending = EXCLUDED.attending,
      has_allergy = EXCLUDED.has_allergy, allergy_notes = EXCLUDED.allergy_notes,
      submission_count = dpm_invitation_responses.submission_count + 1,
      updated_at = CURRENT_TIMESTAMP`,
  [randomUUID(), eventId, value.fullName, value.email, value.emailNormalized, value.attending, value.hasAllergy, value.allergyNotes]);
}

export async function deleteResponse(eventId: string, responseId: string): Promise<boolean> {
  return (await execute('DELETE FROM dpm_invitation_responses WHERE id = ? AND event_id = ?', [responseId, eventId])) > 0;
}
