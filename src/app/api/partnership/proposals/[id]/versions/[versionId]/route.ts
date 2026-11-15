import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getVersion } from '@/lib/partnership/proposal-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; versionId: string }> };

/** One saved version, so the editor can load it back (saving it creates a new version). */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id, versionId } = await context.params;
  const version = await getVersion(id, versionId);
  if (!version) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
  return NextResponse.json(version);
}
