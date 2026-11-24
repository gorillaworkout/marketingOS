import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { googleAdsConfigStatus } from '@/lib/google-ads/service';
import { getKeywordTrendsData } from '@/lib/keyword-trends/service';

export const dynamic = 'force-dynamic';

/** Latest Keyword Trends snapshot (one line per keyword + 12-month series), recent fetches, and config status. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const config = googleAdsConfigStatus();
    return NextResponse.json({ configured: config.configured, missing: [...config.missing, ...config.invalid], ...(await getKeywordTrendsData()) });
  } catch (error) {
    console.error('Keyword Trends load failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not load Keyword Trends.' }, { status: 500 });
  }
}
