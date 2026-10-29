import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireFeature } from '@/lib/auth';
import { getSeoSite } from '@/lib/seo/sites';
import { NothingToCheckError, startVisibilityRun } from '@/lib/seo/visibility-run';
import { RunBusyError, getRun, listRuns } from '@/lib/seo/visibility-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const site = await getSeoSite(params.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const runId = params.get('runId');
  if (runId) {
    const run = await getRun(runId);
    if (!run || run.site_id !== site.id) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    return NextResponse.json({ run });
  }
  return NextResponse.json({ runs: await listRuns(site.id) });
}

/**
 * Admin "Run now". Takes the per-site lock, answers 202 with the run id and
 * keeps checking in the background; poll GET ?runId= for progress.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const site = await getSeoSite(request.nextUrl.searchParams.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  try {
    const started = await startVisibilityRun({ siteId: site.id, trigger: 'manual', triggeredBy: auth.id, tokenUserId: auth.id });
    started.done.catch(error => console.error('AI Visibility run failed:', error instanceof Error ? error.message : error));
    return NextResponse.json({ runId: started.runId, planned: started.planned, skippedPrompts: started.skippedPrompts }, { status: 202 });
  } catch (error) {
    if (error instanceof RunBusyError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof NothingToCheckError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
