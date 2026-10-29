import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { queryOne } from '@/lib/database';
import { addDays, pacificDate } from '@/lib/seo/gsc-sync';
import { cleanFilter, getDataBounds, getTopRows, getTotals, getTrend, resolveReportRange } from '@/lib/seo/report';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = request.nextUrl.searchParams;
  const siteId = params.get('siteId');
  if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
  const site = await queryOne<{ id: string }>('SELECT id FROM seo_sites WHERE id = ?', [siteId]);
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });

  const bounds = await getDataBounds(siteId);
  const anchor = bounds.last ?? addDays(pacificDate(new Date()), -1);
  const range = resolveReportRange({ range: params.get('range'), start: params.get('start'), end: params.get('end') }, anchor);
  const filters = { query: cleanFilter(params.get('query')), page: cleanFilter(params.get('page')) };

  const [current, previous, trend, topQueries, topPages] = await Promise.all([
    getTotals(siteId, range.current, filters),
    getTotals(siteId, range.previous, filters),
    getTrend(siteId, range.current, filters),
    getTopRows(siteId, range.current, filters, 'query'),
    getTopRows(siteId, range.current, filters, 'page'),
  ]);

  return NextResponse.json({ range, filters, dataThrough: bounds.last, dataFrom: bounds.first, totals: { current, previous }, trend, topQueries, topPages });
}
