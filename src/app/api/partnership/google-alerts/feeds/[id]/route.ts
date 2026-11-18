import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { deleteAlertFeed, updateAlertFeedLabel } from '@/lib/partnership/google-alerts-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Body: { label: "…" } — rename the alert. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { label?: unknown };
  const feed = await updateAlertFeedLabel(id, body.label);
  if (!feed) return NextResponse.json({ error: 'Feed not found.' }, { status: 404 });
  return NextResponse.json({ feed });
}

/** Removes the feed. Articles it already brought in stay in Media Monitoring. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!(await deleteAlertFeed(id))) return NextResponse.json({ error: 'Feed not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
