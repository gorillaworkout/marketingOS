import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { AlertFeedError, addAlertFeed } from '@/lib/partnership/google-alerts-store';

export const dynamic = 'force-dynamic';

/** Body: { url: "https://www.google.com/alerts/feeds/…/…", label?: "Dupoin brand" } */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as { url?: unknown; label?: unknown };
  try {
    const feed = await addAlertFeed({ url: body.url, label: body.label, userId: auth.id });
    return NextResponse.json({ feed }, { status: 201 });
  } catch (error) {
    if (error instanceof AlertFeedError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
