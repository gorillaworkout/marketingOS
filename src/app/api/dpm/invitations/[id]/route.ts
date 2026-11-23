// src/app/api/dpm/invitations/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { removeInvitationImage } from '@/lib/dpm-invitation/image';
import { canDeleteInvitation, presentEvent } from '@/lib/dpm-invitation/present';
import { parseClosesAtWib, parseEventName, slugIssue } from '@/lib/dpm-invitation/rules';
import { SlugTakenError, countResponses, deleteEvent, getEvent, updateEvent } from '@/lib/dpm-invitation/store';
import type { InvitationStatus } from '@/lib/dpm-invitation/types';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = { error: 'Invitation not found.' };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const { id } = await context.params;
  const event = await getEvent(id);
  if (!event) return json(NOT_FOUND, 404);
  return json({ event: presentEvent(event, new Date(), { counts: await countResponses(id) }) });
}

/** JSON: any of name, slug, status ('open' | 'closed'), closesAt (WIB 'YYYY-MM-DDTHH:mm', '' or null clears). */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const { id } = await context.params;
  if (!(await getEvent(id))) return json(NOT_FOUND, 404);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: { name?: string; slug?: string; status?: InvitationStatus; closesAt?: Date | null } = {};
  if ('name' in body) {
    const name = parseEventName(body.name);
    if (!name.ok) return json({ error: name.error, field: 'name' }, 400);
    patch.name = name.value;
  }
  if ('slug' in body) {
    const slug = String(body.slug ?? '').trim().toLowerCase();
    const issue = slugIssue(slug);
    if (issue) return json({ error: issue, field: 'slug' }, 400);
    patch.slug = slug;
  }
  if ('status' in body) {
    if (body.status !== 'open' && body.status !== 'closed') return json({ error: 'status must be open or closed.', field: 'status' }, 400);
    patch.status = body.status;
  }
  if ('closesAt' in body) {
    const closesAt = parseClosesAtWib(body.closesAt, new Date());
    if (!closesAt.ok) return json({ error: closesAt.error, field: 'closesAt' }, 400);
    patch.closesAt = closesAt.value;
  }
  try {
    const event = await updateEvent(id, patch, auth.id);
    if (!event) return json(NOT_FOUND, 404);
    return json({ event: presentEvent(event, new Date(), { counts: await countResponses(id) }) });
  } catch (error) {
    if (error instanceof SlugTakenError) return json({ error: error.message, field: 'slug' }, 409);
    console.error('DPM invitation update failed', (error as { code?: string }).code ?? 'unknown');
    return json({ error: 'Could not update the invitation.' }, 500);
  }
}

/** Admin only. JSON { confirm: '<slug>' }. Deletes every response and the image file. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  if (!canDeleteInvitation(auth)) return json({ error: 'Only admins can delete an invitation.' }, 403);
  const { id } = await context.params;
  const event = await getEvent(id);
  if (!event) return json(NOT_FOUND, 404);
  const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
  if (body.confirm !== event.slug) return json({ error: 'Type the link name to confirm.' }, 400);
  const key = await deleteEvent(id);
  if (key) await removeInvitationImage(key);
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
