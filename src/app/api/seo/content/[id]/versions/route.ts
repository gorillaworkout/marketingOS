import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getDraft, getVersion, listVersions } from '@/lib/seo/content-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Version list, or one version with its full text when ?versionId= is given (for diff/restore). */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!await getDraft(id)) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  const versionId = request.nextUrl.searchParams.get('versionId');
  if (!versionId) return NextResponse.json({ versions: await listVersions(id) });
  const version = await getVersion(id, versionId);
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  return NextResponse.json({ version });
}
