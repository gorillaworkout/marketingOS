import { NextRequest, NextResponse } from 'next/server';
import { maskIdentifier } from '@/lib/monthly-report/metrics';
import { DETAIL_KINDS, listDetails, type DetailKind } from '@/lib/monthly-report/store';
import { parseReportQuery, requireMonthlyReport } from '@/lib/monthly-report/service';

export const dynamic = 'force-dynamic';

/** Drill-down rows for a data-quality bucket. UIDs and account numbers are masked. */
export async function GET(request: NextRequest) {
  const user = await requireMonthlyReport(request);
  if (user instanceof NextResponse) return user;
  const kind = request.nextUrl.searchParams.get('kind') as DetailKind | null;
  if (!kind || !(kind in DETAIL_KINDS)) return NextResponse.json({ error: 'Unknown detail kind' }, { status: 400 });
  let query;
  try {
    query = parseReportQuery(request.nextUrl.searchParams);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid period' }, { status: 400 });
  }
  const { total, rows } = await listDetails(kind, query.period.range, 200);
  return NextResponse.json({
    kind,
    label: DETAIL_KINDS[kind].label,
    total,
    rows: rows.map(row => ({ ...row, uid: maskIdentifier(row.uid), trading_account_no: maskIdentifier(row.trading_account_no) })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
