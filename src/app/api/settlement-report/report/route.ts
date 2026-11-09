import { NextRequest, NextResponse } from 'next/server';
import { todayWib } from '@/lib/monthly-report/service';
import { loadSettlementReport, resolveSettlementPeriod } from '@/lib/settlement/report';
import { requireSettlementReport, settlementPermissions } from '@/lib/settlement/service';

export const dynamic = 'force-dynamic';

/** GET ?preset=day|week|month|custom&anchor=YYYY-MM-DD[&from=&to=] → SettlementReport (weeks Mon–Sun WIB). */
export async function GET(request: NextRequest) {
  const user = await requireSettlementReport(request);
  if (user instanceof NextResponse) return user;
  const params = request.nextUrl.searchParams;
  let period;
  try {
    period = resolveSettlementPeriod(params.get('preset') ?? 'month', params.get('anchor') || todayWib(), params.get('from'), params.get('to'));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid period' }, { status: 400 });
  }
  const report = await loadSettlementReport(period);
  return NextResponse.json({ report, permissions: settlementPermissions(user) }, { headers: { 'Cache-Control': 'no-store' } });
}
