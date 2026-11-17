import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { resolveSearchApiKeys, searchSerper } from '@/lib/ai-research-grounding';
import { fetchPublic } from '@/lib/partnership/public-fetch';
import { discoverSocialAccounts } from '@/lib/partnership/social-discovery';
import { getCompetitor } from '@/lib/partnership/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Suggest the competitor's social accounts from its own website (free; plus one web
 * search per missing platform when SERPER_API_KEY is set). Read-only: nothing is saved
 * until the user reviews the suggestions and saves the competitor.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const competitor = await getCompetitor(id);
  if (!competitor) return NextResponse.json({ error: 'Competitor not found.' }, { status: 404 });
  const serper = resolveSearchApiKeys().serper;
  const result = await discoverSocialAccounts(
    { name: competitor.name, website: competitor.website, region: competitor.region },
    {
      fetchPublic: (url, accept) => fetchPublic(url, accept),
      searchWeb: serper ? async query => {
        const attempt = await searchSerper(query, serper, fetch, 200_000, 8_000);
        return attempt.sources.map(source => ({ title: source.title, url: source.url, snippet: source.snippet }));
      } : undefined,
    },
  );
  return NextResponse.json({ competitorId: competitor.id, current: competitor.socialHandles, ...result });
}
