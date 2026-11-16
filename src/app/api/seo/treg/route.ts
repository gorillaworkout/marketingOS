import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { tregConfig } from '@/lib/seo/treg-client';
import { tregStatus } from '@/lib/seo/treg-cost-guard';

export const dynamic = 'force-dynamic';

/** treg balance (cached 5 minutes), today's spend and the daily limit for <TregCostNotice> on every treg feature. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await tregStatus(tregConfig(), auth.role));
}
