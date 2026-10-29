import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getSeoSite } from '@/lib/seo/sites';
import { getCheck } from '@/lib/seo/visibility-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** One stored answer with its detection result. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const site = await getSeoSite(request.nextUrl.searchParams.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const { id } = await context.params;
  const check = await getCheck(site.id, id);
  if (!check) return NextResponse.json({ error: 'Check not found' }, { status: 404 });
  return NextResponse.json({ check });
}
