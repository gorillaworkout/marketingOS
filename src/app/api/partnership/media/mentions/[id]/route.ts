import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { SENTIMENTS, type Sentiment } from '@/lib/partnership/media';
import { setMentionSentiment } from '@/lib/partnership/media-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Body: { sentiment: "positive" | "neutral" | "negative" } — a manual correction of the model's label. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { sentiment?: unknown };
  const sentiment = String(body.sentiment ?? '') as Sentiment;
  if (!SENTIMENTS.includes(sentiment)) return NextResponse.json({ error: 'Sentiment must be positive, neutral or negative.' }, { status: 400 });
  if (!(await setMentionSentiment(id, sentiment))) return NextResponse.json({ error: 'Mention not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
