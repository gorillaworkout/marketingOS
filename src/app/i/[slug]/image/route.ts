// src/app/i/[slug]/image/route.ts
// PUBLIC route: serves only the invitation artwork. Never import @/lib/auth here.
import { NextResponse } from 'next/server';
import { readInvitationImage } from '@/lib/dpm-invitation/image';
import { getEventBySlug } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const event = await getEventBySlug(slug.toLowerCase());
  if (!event) return new NextResponse('Not found', { status: 404 });
  const bytes = await readInvitationImage(event.imageKey);
  if (!bytes) {
    console.error('DPM invitation image missing', event.id);
    return new NextResponse('Unable to read image', { status: 500 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': event.imageMime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  });
}
