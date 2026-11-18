import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getGoogleAdsReport, ReportInputError } from '@/lib/google-ads/report';

export const dynamic = 'force-dynamic';

/** GET ?start=YYYY-MM-DD&end=YYYY-MM-DD&account=all|<customer id> */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  try {
    return NextResponse.json(await getGoogleAdsReport({ start: params.get('start'), end: params.get('end'), account: params.get('account') }));
  } catch (error) {
    if (error instanceof ReportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Google Ads report failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not load the Google Ads report.' }, { status: 500 });
  }
}
