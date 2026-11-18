import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getPaidOrganicReport } from '@/lib/google-ads/paid-organic';
import { ReportInputError } from '@/lib/google-ads/report';

export const dynamic = 'force-dynamic';

/** GET ?start=&end=&account=all|<id>&source=search-terms|keywords. Google Ads terms joined to Dupoin Search Console queries. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  try {
    return NextResponse.json(await getPaidOrganicReport({ start: params.get('start'), end: params.get('end'), account: params.get('account'), source: params.get('source') }));
  } catch (error) {
    if (error instanceof ReportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Google Ads paid vs organic failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not load Paid vs Organic.' }, { status: 500 });
  }
}
