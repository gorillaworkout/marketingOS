import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireFeature } from '@/lib/auth';
import { AVAILABLE_MODELS } from '@/lib/openai';
import { getSeoSite } from '@/lib/seo/sites';
import { HARD_MAX_CHECKS, parseSettingsInput } from '@/lib/seo/visibility';
import { getVisibilitySettings, saveVisibilitySettings } from '@/lib/seo/visibility-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const site = await getSeoSite(request.nextUrl.searchParams.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  return NextResponse.json({
    settings: await getVisibilitySettings(site.id),
    hardMaxChecks: HARD_MAX_CHECKS,
    availableModels: AVAILABLE_MODELS.map(model => ({ id: model.id, name: model.name })),
  });
}

/** Admin only: which models to check, the optional classifier, and the per-run cap. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const site = await getSeoSite(request.nextUrl.searchParams.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const input = parseSettingsInput(await request.json().catch(() => null));
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  await saveVisibilitySettings(site.id, input, auth.id);
  return NextResponse.json({ settings: await getVisibilitySettings(site.id) });
}
