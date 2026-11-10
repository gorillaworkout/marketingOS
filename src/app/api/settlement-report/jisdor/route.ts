import { NextRequest, NextResponse } from 'next/server';
import { JISDOR_MONTH_UNAVAILABLE, JISDOR_PAGE_URL, jisdorMonthTable, parseJisdorHtml } from '@/lib/settlement/jisdor';
import { fetchPublishedJisdor, listJisdorFixings, saveJisdorFixings } from '@/lib/settlement/jisdor-store';
import { requireSettlementReport } from '@/lib/settlement/service';

export const dynamic = 'force-dynamic';

const NOTE = 'Published BI JISDOR fixings. Not applied to commission, swap, or the fixed IDR account rates. Days without a fixing are omitted.';
/** One BI read at a time. A second missing month inside this window uses the cache just written. */
const BI_FETCH_GAP_MS = 15_000;
let lastBiFetchAt = 0;

function todayMonth(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
}

async function monthPayload(month: string) {
  let fixings = await listJisdorFixings();
  let rows = jisdorMonthTable(fixings, month);
  const future = month > todayMonth();
  if (rows.length || future) return { fixings, rows, unavailable: future && !rows.length };
  const now = Date.now();
  if (now - lastBiFetchAt < BI_FETCH_GAP_MS) return { fixings, rows, unavailable: true };
  lastBiFetchAt = now;
  const fetched = await fetchPublishedJisdor();
  if (!fetched.ok) return { fixings, rows: [] as ReturnType<typeof jisdorMonthTable>, unavailable: true };
  await saveJisdorFixings(fetched.rows);
  fixings = await listJisdorFixings();
  rows = jisdorMonthTable(fixings, month);
  return { fixings, rows, unavailable: rows.length === 0 };
}

/** Stored fixings. ?month=YYYY-MM lists that month and fetches BI once when it is missing. */
export async function GET(request: NextRequest) {
  const user = await requireSettlementReport(request);
  if (user instanceof NextResponse) return user;
  const month = request.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ fixings: await listJisdorFixings(), note: NOTE }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const payload = await monthPayload(month);
  return NextResponse.json({
    ...payload,
    month,
    note: NOTE,
    error: payload.unavailable ? JISDOR_MONTH_UNAVAILABLE : undefined,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

/** On-demand fetch. An unrecognized page stores nothing. No scheduled job is registered. */
export async function POST(request: NextRequest) {
  const user = await requireSettlementReport(request);
  if (user instanceof NextResponse) return user;
  let html = '';
  try {
    const load = await fetch(JISDOR_PAGE_URL, { headers: { 'User-Agent': 'MarketingOS settlement' } });
    if (!load.ok) return NextResponse.json({ error: `JISDOR page returned ${load.status}. Nothing was stored.` }, { status: 502 });
    html = await load.text();
  } catch {
    return NextResponse.json({ error: 'JISDOR page could not be fetched. Nothing was stored.' }, { status: 502 });
  }
  const parsed = parseJisdorHtml(html);
  if (!parsed.length) return NextResponse.json({ error: 'Unrecognized JISDOR page. Nothing was stored.' }, { status: 422 });
  await saveJisdorFixings(parsed);
  return NextResponse.json({ ok: true, stored: parsed.length, fixings: parsed });
}
