// src/app/api/public/dpm-invitations/[slug]/responses/route.ts
// PUBLIC route: no login. Never import @/lib/auth here, and never return stored response data.
import { NextRequest, NextResponse } from 'next/server';
import { clientIpFromHeaders } from '@/lib/rate-limit';
import { SUBMIT_BODY_MAX, submitInvitationResponse } from '@/lib/dpm-invitation/submit';
import { getEventBySlug, upsertResponse } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ slug: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest, context: RouteContext) {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > SUBMIT_BODY_MAX) return NextResponse.json({ error: 'Request is too large.' }, { status: 413, headers: NO_STORE });
  const { slug } = await context.params;
  const raw = await request.text();
  const result = await submitInvitationResponse(slug.toLowerCase(), raw, clientIpFromHeaders(request.headers), {
    getEventBySlug, upsertResponse, now: () => new Date(),
  });
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}
