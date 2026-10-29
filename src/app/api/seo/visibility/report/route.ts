import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getSeoSite } from '@/lib/seo/sites';
import { visibilityReport } from '@/lib/seo/visibility-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const site = await getSeoSite(params.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const weeks = Number(params.get('weeks') ?? 12);
  return NextResponse.json({ report: await visibilityReport(site.id, site.name, Number.isFinite(weeks) ? weeks : 12) });
}
