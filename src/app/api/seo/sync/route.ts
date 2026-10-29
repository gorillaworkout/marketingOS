import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { runSeoSyncForSite } from '@/lib/seo/sync-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** "Sync now": incremental only (last 5 days). The 16-month backfill runs from the CLI. */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const body = await request.json().catch(() => ({})) as { siteId?: unknown };
  if (typeof body.siteId !== 'string' || !body.siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 });

  const result = await runSeoSyncForSite({ siteId: body.siteId, mode: 'incremental', triggeredBy: admin.id });
  if (result.status === 'busy') return NextResponse.json({ error: result.error }, { status: 409 });
  if (result.status === 'failed') return NextResponse.json({ error: result.error, runId: result.runId }, { status: result.configError ? 400 : 502 });
  return NextResponse.json(result);
}
