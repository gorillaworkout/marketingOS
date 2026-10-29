import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { addDays, pacificDate } from '@/lib/seo/gsc-sync';
import { getOpportunities, OPPORTUNITY_BANDS } from '@/lib/seo/opportunities';
import { getDataBounds, resolveReportRange } from '@/lib/seo/report';
import { getSeoSite } from '@/lib/seo/sites';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = request.nextUrl.searchParams;
  const site = await getSeoSite(params.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });

  const bounds = await getDataBounds(site.id);
  const anchor = bounds.last ?? addDays(pacificDate(new Date()), -1);
  const range = resolveReportRange({ range: params.get('range'), start: params.get('start'), end: params.get('end') }, anchor);
  const minImpressions = Number(params.get('minImpressions') ?? 1);
  const report = await getOpportunities(site.id, range.current, { minImpressions: Number.isFinite(minImpressions) ? minImpressions : 1 });

  return NextResponse.json({ range: range.current, dataThrough: bounds.last, bands: OPPORTUNITY_BANDS, ...report });
}
