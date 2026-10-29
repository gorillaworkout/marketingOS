import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { dismissQueueItem, enqueueContent, listQueue, parseQueueRequest, QUEUE_STATUSES, type QueueStatus } from '@/lib/seo/content-queue';
import { siteRootHost } from '@/lib/seo/keywords';
import { getSeoSite } from '@/lib/seo/sites';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = request.nextUrl.searchParams;
  const site = await getSeoSite(params.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const status = params.get('status') ?? 'pending';
  if (status !== 'all' && !QUEUE_STATUSES.includes(status as QueueStatus)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
  return NextResponse.json({ items: await listQueue(site.id, status as QueueStatus | 'all') });
}

/** "Send to Content Studio": creates a pending hand-off item (idempotent per keyword). */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const site = await getSeoSite(typeof body?.siteId === 'string' ? body.siteId : null);
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const parsed = parseQueueRequest(body, siteRootHost(site.site_url, site.gsc_property));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await enqueueContent(site.id, parsed, auth.id);
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null) as { id?: unknown; status?: unknown } | null;
  if (typeof body?.id !== 'string' || body.status !== 'dismissed') return NextResponse.json({ error: 'Send { id, status: "dismissed" }' }, { status: 400 });
  if (!await dismissQueueItem(body.id)) return NextResponse.json({ error: 'Pending item not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
