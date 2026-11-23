// src/app/api/dpm/invitations/[id]/image/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { consumeRateLimit } from '@/lib/rate-limit';
import { ImageInputError, IMAGE_MAX_BYTES, readInvitationImage, removeInvitationImage, saveInvitationImage } from '@/lib/dpm-invitation/image';
import { presentEvent } from '@/lib/dpm-invitation/present';
import { countResponses, getEvent, replaceEventImage } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/** Signed-in preview, also when the event is closed. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const { id } = await context.params;
  const event = await getEvent(id);
  const bytes = event ? await readInvitationImage(event.imageKey) : null;
  if (!event || !bytes) return new NextResponse('Not found', { status: 404, headers: NO_STORE });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': event.imageMime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** multipart image. Writes the new file, updates the row, then removes the old file. */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  if (!consumeRateLimit('dpm-inv-upload', auth.id, 20, 60 * 60_000).allowed) return json({ error: 'Too many uploads. Try again later.' }, 429);
  const { id } = await context.params;
  if (!(await getEvent(id))) return json({ error: 'Invitation not found.' }, 404);
  const form = await request.formData().catch(() => null);
  const file = form?.get('image');
  if (!(file instanceof File)) return json({ error: 'Choose an invitation image.', field: 'image' }, 400);
  if (file.size > IMAGE_MAX_BYTES) return json({ error: 'Image must be 8 MB or smaller.', field: 'image' }, 400);
  let image;
  try {
    image = await saveInvitationImage(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImageInputError) return json({ error: error.message, field: 'image' }, 400);
    throw error;
  }
  const result = await replaceEventImage(id, image, auth.id);
  if (!result) {
    await removeInvitationImage(image.key);
    return json({ error: 'Invitation not found.' }, 404);
  }
  await removeInvitationImage(result.oldKey);
  return json({ event: presentEvent(result.event, new Date(), { counts: await countResponses(id) }) });
}
