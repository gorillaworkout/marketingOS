// src/app/api/dpm/invitations/[id]/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { exportFilename, responsesCsv, responsesXlsx } from '@/lib/dpm-invitation/export';
import { isResponseFilter } from '@/lib/dpm-invitation/rules';
import { getEvent, listResponses } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };

/** GET ?format=xlsx|csv&q=&filter= -> file download. Built in memory, never written to disk. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  const event = await getEvent(id);
  if (!event) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  const format = params.get('format') === 'csv' ? 'csv' : 'xlsx';
  const filterParam = params.get('filter') ?? 'all';
  const rows = await listResponses(id, { q: (params.get('q') ?? '').slice(0, 120), filter: isResponseFilter(filterParam) ? filterParam : 'all' });
  const headers = { ...NO_STORE, 'Content-Disposition': `attachment; filename="${exportFilename(event.slug, format, new Date())}"` };
  if (format === 'csv') return new NextResponse(responsesCsv(rows), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
  const xlsx = await responsesXlsx(rows, event.slug);
  return new NextResponse(new Uint8Array(xlsx), { headers: { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
}
