import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { listUploads } from '@/lib/cs-report/store';

export const dynamic = 'force-dynamic';

/** GET -> bulk upload history, newest first. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ uploads: await listUploads(100) });
}
