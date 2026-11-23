// src/app/api/dpm/invitations/[id]/responses/[responseId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { deleteResponse } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string; responseId: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Admins and DPM Invitation holders may delete a single response. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  const { id, responseId } = await context.params;
  if (!(await deleteResponse(id, responseId))) return NextResponse.json({ error: 'Response not found.' }, { status: 404, headers: NO_STORE });
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
