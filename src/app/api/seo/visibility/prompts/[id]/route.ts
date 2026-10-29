import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getSeoSite } from '@/lib/seo/sites';
import { parsePromptInput } from '@/lib/seo/visibility';
import { DuplicatePromptError, deletePrompt, updatePrompt } from '@/lib/seo/visibility-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const site = await getSeoSite(request.nextUrl.searchParams.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const { id } = await context.params;
  const input = parsePromptInput(await request.json().catch(() => null));
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  try {
    if (!await updatePrompt(site.id, id, input, auth.id)) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
  } catch (error) {
    if (error instanceof DuplicatePromptError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}

/** Deleting a prompt keeps its past checks (prompt_id becomes null) so history and rates stay intact. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const site = await getSeoSite(request.nextUrl.searchParams.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const { id } = await context.params;
  if (!await deletePrompt(site.id, id)) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
