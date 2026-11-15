import { after, NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { expireStaleReports } from '@/lib/partnership/store';
import { parseWindowDays } from '@/lib/partnership/trends';
import { runTrendsDigest } from '@/lib/partnership/trends-run';
import { TrendsInProgressError, createTrendsReport, latestSucceededTrendsReport, listTrendBrands, listTrendsReports } from '@/lib/partnership/trends-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Latest digest, run history, and the watchlist. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await expireStaleReports();
  const [latest, history, brands] = await Promise.all([latestSucceededTrendsReport(), listTrendsReports(20), listTrendBrands()]);
  const running = history.find(run => run.status === 'queued' || run.status === 'running') ?? null;
  return NextResponse.json({ latest: latest ?? null, history, running, brands, canDelete: auth.role === 'admin' });
}

/** Manual refresh. Body: { windowDays: 30 | 90 }. The digest runs after the response. */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as { windowDays?: unknown };
  const windowDays = parseWindowDays(body?.windowDays);
  if (!windowDays) return NextResponse.json({ error: 'Window must be 30 or 90 days.' }, { status: 400 });
  if (!(await listTrendBrands({ activeOnly: true })).length) return NextResponse.json({ error: 'The watchlist is empty. Add at least one brand.' }, { status: 400 });
  try {
    const id = await createTrendsReport(windowDays, 'manual', auth.id);
    after(() => runTrendsDigest(id));
    return NextResponse.json({ id }, { status: 202 });
  } catch (error) {
    if (error instanceof TrendsInProgressError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
