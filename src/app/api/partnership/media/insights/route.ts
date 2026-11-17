import { NextRequest, NextResponse } from 'next/server';
import { aiProviderErrorBody } from '@/lib/ai-http-status';
import { requireFeature } from '@/lib/auth';
import { parseDateRange } from '@/lib/partnership/media';
import { generateMediaInsights } from '@/lib/partnership/media-run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Body: { from, to }. Generates Dataxet-style insights and recommendations for the range with the MarketingOS LLM helper. */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as { from?: unknown; to?: unknown };
  const range = parseDateRange(body.from, body.to);
  try {
    const { result, model, mentions } = await generateMediaInsights(range, auth.id);
    return NextResponse.json({ insights: { range, result, model, createdAt: new Date().toISOString() }, mentions });
  } catch (error) {
    const provider = aiProviderErrorBody(error);
    return NextResponse.json({ error: provider.error || (error instanceof Error ? error.message : 'Could not generate insights.') }, { status: 400 });
  }
}
