import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { listAlerts, openAlertCounts } from '@/lib/google-ads/alerts';
import { ALERTS } from '@/lib/google-ads/insights-config';
import { parseCustomerFilter, ReportInputError } from '@/lib/google-ads/report';

export const dynamic = 'force-dynamic';

/** GET ?status=open|all&account=all|<id>; ?summary=1 returns only open counts (sidebar badge). */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  try {
    const counts = await openAlertCounts();
    if (params.get('summary') === '1') return NextResponse.json(counts);
    const status = params.get('status') === 'all' ? 'all' : 'open';
    const alerts = await listAlerts({ status, customerId: parseCustomerFilter(params.get('account')) });
    return NextResponse.json({ counts, alerts, thresholds: ALERTS });
  } catch (error) {
    if (error instanceof ReportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Google Ads alerts failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not load alerts.' }, { status: 500 });
  }
}
