import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { TREG_IG_POSTS_MAX_USD, estimateInstagramFeedMicro, instagramFeedEnabled } from '@/lib/partnership/treg-instagram';
import { TREG_PLATFORMS, TREG_PLATFORM_SPECS } from '@/lib/partnership/treg-social';
import { tregConfig } from '@/lib/seo/treg-client';
import { tregStatus } from '@/lib/seo/treg-cost-guard';

export const dynamic = 'force-dynamic';

/**
 * treg status for Competitor Intelligence (balance cached 5 minutes, today's spend,
 * daily limit) plus the Instagram feed estimate per competitor. Never includes the token.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const config = tregConfig();
  const status = await tregStatus(config, auth.role);
  const enabled = instagramFeedEnabled();
  return NextResponse.json({
    ...status,
    configured: status.configured && enabled,
    canRun: status.canRun && enabled,
    platforms: TREG_PLATFORMS.map(id => ({ id, ...TREG_PLATFORM_SPECS[id] })),
    instagram: { perCompetitorMicro: estimateInstagramFeedMicro(1).totalMicro, maxPerCompetitorUsd: TREG_IG_POSTS_MAX_USD, enabled },
  });
}
