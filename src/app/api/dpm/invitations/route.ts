// src/app/api/dpm/invitations/route.ts
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { consumeRateLimit } from '@/lib/rate-limit';
import { ImageInputError, IMAGE_MAX_BYTES, removeInvitationImage, saveInvitationImage } from '@/lib/dpm-invitation/image';
import { presentEvent } from '@/lib/dpm-invitation/present';
import { parseClosesAtWib, parseEventName, slugIssue } from '@/lib/dpm-invitation/rules';
import { SlugTakenError, createEvent, listEvents } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const ZERO = { total: 0, attending: 0, notAttending: 0, withAllergies: 0 };

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const now = new Date();
  const rows = await listEvents();
  return json({ events: rows.map(row => presentEvent(row.event, now, { counts: row.counts, lastResponseAt: row.lastResponseAt })) });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  if (!consumeRateLimit('dpm-inv-upload', auth.id, 20, 60 * 60_000).allowed) return json({ error: 'Too many uploads. Try again later.' }, 429);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'Send the form as multipart/form-data.' }, 400);
  const name = parseEventName(form.get('name'));
  if (!name.ok) return json({ error: name.error, field: 'name' }, 400);
  const slug = String(form.get('slug') ?? '').trim().toLowerCase();
  const issue = slugIssue(slug);
  if (issue) return json({ error: issue, field: 'slug' }, 400);
  const closesAt = parseClosesAtWib(form.get('closesAt'), new Date());
  if (!closesAt.ok) return json({ error: closesAt.error, field: 'closesAt' }, 400);
  const file = form.get('image');
  if (!(file instanceof File)) return json({ error: 'Choose an invitation image.', field: 'image' }, 400);
  if (file.size > IMAGE_MAX_BYTES) return json({ error: 'Image must be 8 MB or smaller.', field: 'image' }, 400);

  let image;
  try {
    image = await saveInvitationImage(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImageInputError) return json({ error: error.message, field: 'image' }, 400);
    throw error;
  }
  try {
    const event = await createEvent({ id: randomUUID(), name: name.value, slug, closesAt: closesAt.value, image, userId: auth.id });
    return json({ event: presentEvent(event, new Date(), { counts: ZERO, lastResponseAt: null }) }, 201);
  } catch (error) {
    await removeInvitationImage(image.key);
    if (error instanceof SlugTakenError) return json({ error: error.message, field: 'slug' }, 409);
    console.error('DPM invitation create failed', (error as { code?: string }).code ?? 'unknown');
    return json({ error: 'Could not create the invitation.' }, 500);
  }
}
