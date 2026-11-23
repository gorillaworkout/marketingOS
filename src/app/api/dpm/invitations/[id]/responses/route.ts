// src/app/api/dpm/invitations/[id]/responses/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { presentResponse } from '@/lib/dpm-invitation/present';
import { isResponseFilter } from '@/lib/dpm-invitation/rules';
import { countResponses, getEvent, listResponses } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };

/** GET ?q=&filter=all|attending|not-attending|allergy. Counts always cover the whole event. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  if (!(await getEvent(id))) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  const filterParam = params.get('filter') ?? 'all';
  const filter = isResponseFilter(filterParam) ? filterParam : 'all';
  const q = (params.get('q') ?? '').slice(0, 120);
  const [counts, rows] = await Promise.all([countResponses(id), listResponses(id, { q, filter })]);
  return NextResponse.json({ counts, responses: rows.map(presentResponse) }, { headers: NO_STORE });
}
