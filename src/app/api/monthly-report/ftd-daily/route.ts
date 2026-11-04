import { NextRequest, NextResponse } from 'next/server';
import { validateManualFtd } from '@/lib/monthly-report/ftd-daily';
import { isIsoDate } from '@/lib/monthly-report/periods';
import { permissionsFor, requireMonthlyReport, todayWib, uploadActor } from '@/lib/monthly-report/service';
import { countManualFtd, deleteManualFtd, listManualFtd, upsertManualFtd } from '@/lib/monthly-report/store';

export const dynamic = 'force-dynamic';

/**
 * Manual daily FTD (no file upload): one value per WIB day, upserted by date.
 * Same permission as uploads (admin or "Can upload").
 *  GET    ?limit=31          recent entries (newest day first) + permissions
 *  POST   { date, count, amount? }   create or edit the day's entry
 *  DELETE ?date=YYYY-MM-DD   clear the entry (the day falls back to the FTD file, if any)
 */
export async function GET(request: NextRequest) {
  const user = await requireMonthlyReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 31);
  const [entries, total] = await Promise.all([listManualFtd({ limit: Number.isFinite(limit) ? limit : 31 }), countManualFtd()]);
  return NextResponse.json({ entries, total, today: todayWib(), permissions: permissionsFor(user) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const user = await requireMonthlyReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Send JSON: { date, count, amount }' }, { status: 400 }); }
  const result = validateManualFtd(body, todayWib());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const { entry, created } = await upsertManualFtd(result.value, await uploadActor(user));
  return NextResponse.json({ ok: true, entry, created }, { status: created ? 201 : 200 });
}

export async function DELETE(request: NextRequest) {
  const user = await requireMonthlyReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const date = request.nextUrl.searchParams.get('date') ?? '';
  if (!isIsoDate(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  const removed = await deleteManualFtd(date);
  return NextResponse.json({ ok: true, removed });
}
