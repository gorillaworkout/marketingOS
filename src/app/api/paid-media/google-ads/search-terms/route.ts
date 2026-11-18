import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { ReportInputError } from '@/lib/google-ads/report';
import { getSearchTermInsights } from '@/lib/google-ads/search-term-insights';

export const dynamic = 'force-dynamic';

/** GET ?start=&end=&account=&minCost=&minConversions= -> negative keyword suggestions and keyword candidates (read-only). */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  try {
    return NextResponse.json(await getSearchTermInsights({
      start: params.get('start'), end: params.get('end'), account: params.get('account'), minCost: params.get('minCost'), minConversions: params.get('minConversions'),
    }));
  } catch (error) {
    if (error instanceof ReportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Google Ads search term analysis failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not load the search term analysis.' }, { status: 500 });
  }
}
