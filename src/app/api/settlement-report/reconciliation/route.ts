import { NextRequest, NextResponse } from 'next/server';
import { maskIdentifier } from '@/lib/monthly-report/metrics';
import { requireSettlementReport } from '@/lib/settlement/service';
import { loadReconciliation, shapeReconciliation } from '@/lib/settlement/report';

export const dynamic = 'force-dynamic';

/** GET ?date=YYYY-MM-DD[&list=crm_only|mt5_only|amount_diff|account_diff&page=N] — window (date−1 12:00, date 12:00] WIB. */
export async function GET(request: NextRequest) {
  const user = await requireSettlementReport(request);
  if (user instanceof NextResponse) return user;
  const params = request.nextUrl.searchParams;
  const date = params.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  const daily = await loadReconciliation(date);
  return NextResponse.json(shapeReconciliation(daily, params.get('list'), Number(params.get('page') ?? 1) || 1, maskIdentifier), { headers: { 'Cache-Control': 'no-store' } });
}
