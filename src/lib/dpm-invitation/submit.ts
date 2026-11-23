// src/lib/dpm-invitation/submit.ts
import { consumeRateLimit } from '@/lib/rate-limit';
import { isRegistrationOpen, parseResponseInput } from './rules';
import type { InvitationEvent, ParsedResponse } from './types';

export const SUBMIT_BODY_MAX = 16_384;
const IP_LIMIT = 60;
const IP_WINDOW_MS = 10 * 60_000;
const EMAIL_LIMIT = 5;
const EMAIL_WINDOW_MS = 60 * 60_000;
const TOO_MANY = { error: 'Too many attempts. Please wait a few minutes and try again.' };
const GENERIC = { error: 'Something went wrong. Please try again in a minute.' };

export interface SubmitDeps {
  getEventBySlug(slug: string): Promise<InvitationEvent | null>;
  upsertResponse(eventId: string, value: ParsedResponse): Promise<void>;
  now(): Date;
}

export async function submitInvitationResponse(slug: string, rawBody: string, ip: string, deps: SubmitDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  if (rawBody.length > SUBMIT_BODY_MAX) return { status: 413, body: { error: 'Request is too large.' } };
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 400, body: GENERIC };
    input = parsed as Record<string, unknown>;
  } catch {
    return { status: 400, body: GENERIC };
  }
  const now = deps.now();
  if (!consumeRateLimit('dpm-inv-ip', ip, IP_LIMIT, IP_WINDOW_MS, now.getTime()).allowed) return { status: 429, body: TOO_MANY };

  const event = await deps.getEventBySlug(slug);
  if (!event) return { status: 404, body: { error: 'This invitation link is not valid.' } };
  if (!isRegistrationOpen(event, now)) return { status: 403, body: { error: 'Registration has closed.' } };
  // Honeypot: look like a success, store nothing.
  if (String(input.website ?? '').trim() !== '') return { status: 200, body: { ok: true } };

  const result = parseResponseInput(input);
  if (!result.ok) return { status: 422, body: { fieldErrors: result.fieldErrors } };
  const emailKey = `${event.id}:${result.value.emailNormalized}`;
  if (!consumeRateLimit('dpm-inv-email', emailKey, EMAIL_LIMIT, EMAIL_WINDOW_MS, now.getTime()).allowed) return { status: 429, body: TOO_MANY };

  try {
    await deps.upsertResponse(event.id, result.value);
  } catch (error) {
    console.error('DPM invitation submit failed', event.id, (error as { code?: string }).code ?? 'unknown');
    return { status: 500, body: GENERIC };
  }
  return { status: 200, body: { ok: true } };
}
