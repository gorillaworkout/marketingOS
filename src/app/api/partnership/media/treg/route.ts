import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { MEDIA_TREG_PLATFORMS, MEDIA_TREG_SPECS, estimateMediaTreg, parseMediaTregPlatforms } from '@/lib/partnership/media-treg-platforms';
import { getMediaSettings } from '@/lib/partnership/media-store';
import { tregConfig } from '@/lib/seo/treg-client';
import { tregStatus } from '@/lib/seo/treg-cost-guard';

export const dynamic = 'force-dynamic';

/** treg status (balance cached 5 minutes, today's spend, daily limit), the platform catalog, and the estimate for ?platforms=a,b. Never includes the token. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const [status, settings] = await Promise.all([tregStatus(tregConfig(), auth.role), getMediaSettings()]);
  const requested = parseMediaTregPlatforms((request.nextUrl.searchParams.get('platforms') || '').split(','));
  return NextResponse.json({
    ...status,
    platforms: MEDIA_TREG_PLATFORMS.map(id => ({ id, ...MEDIA_TREG_SPECS[id], estimate: estimateMediaTreg(settings, [id]) })),
    estimate: estimateMediaTreg(settings, requested),
  });
}
