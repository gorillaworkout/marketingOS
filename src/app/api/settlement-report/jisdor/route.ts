import { NextRequest, NextResponse } from 'next/server';
import { JISDOR_PAGE_URL, parseJisdorHtml } from '@/lib/settlement/jisdor';
import { listJisdorFixings, saveJisdorFixings } from '@/lib/settlement/jisdor-store';
import { requireSettlementReport } from '@/lib/settlement/service';

export const dynamic = 'force-dynamic';

/** Stored fixings only. No previous-day fill. */
export async function GET(request: NextRequest) {
  const user = await requireSettlementReport(request);
  if (user instanceof NextResponse) return user;
  const fixings = await listJisdorFixings();
  return NextResponse.json({
    fixings,
    note: 'Published BI JISDOR fixings. Not applied to commission, swap, or the fixed IDR account rates. Days without a fixing are omitted.',
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
