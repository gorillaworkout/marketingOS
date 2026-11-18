import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { AlertActionError, setAlertStatus } from '@/lib/google-ads/alerts';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** POST { action: 'acknowledge' | 'dismiss' | 'reopen' }. In-app status only; nothing is sent anywhere. */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { action?: unknown };
  try {
    const status = await setAlertStatus(id, typeof body.action === 'string' ? body.action : '', auth.id);
    return NextResponse.json({ id, status });
  } catch (error) {
    if (error instanceof AlertActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Google Ads alert update failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not update the alert.' }, { status: 500 });
  }
}
