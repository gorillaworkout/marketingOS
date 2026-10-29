import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { resolveBrandGuideline, rewriteSeoDraft } from '@/lib/seo/content-ai';
import { MAX_INSTRUCTIONS_LENGTH } from '@/lib/seo/content-prompt';
import { editResetsStatus } from '@/lib/seo/content-status';
import { VersionConflictError, getDraft, saveVersion } from '@/lib/seo/content-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

/** AI rewrite of the current version: { instruction, expectedVersion }. Saved as a new version. */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as { instruction?: unknown; expectedVersion?: unknown } | null;
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction) return NextResponse.json({ error: 'Tell the AI what to change' }, { status: 400 });
  if (instruction.length > MAX_INSTRUCTIONS_LENGTH) return NextResponse.json({ error: `Instruction is longer than ${MAX_INSTRUCTIONS_LENGTH} characters` }, { status: 400 });
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion)) return NextResponse.json({ error: 'expectedVersion is required' }, { status: 400 });
  if (expectedVersion !== draft.current_version) return NextResponse.json({ error: new VersionConflictError().message }, { status: 409 });

  // Reuse the guideline the article was started with; fall back to the default if it was deleted.
  const guideline = await resolveBrandGuideline(null, draft.brand_guideline_id) ?? await resolveBrandGuideline(null, null);
  let result;
  try {
    result = await rewriteSeoDraft(auth.id, {
      keyword: draft.keyword, title: draft.title, metaDescription: draft.meta_description, bodyMarkdown: draft.body_markdown, instruction,
    }, guideline!);
  } catch (error) {
    console.error('SEO content rewrite failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: `AI rewrite failed: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 502 });
  }
  try {
    const version = await saveVersion({
      draftId: id, expectedVersion,
      content: { title: result.title, slug: draft.slug || result.slug, metaDescription: result.metaDescription || draft.meta_description, bodyMarkdown: result.bodyMarkdown },
      source: 'ai-rewrite', nextStatus: editResetsStatus(draft.status), note: instruction.slice(0, 500),
      model: result.model, fallbackLabel: result.fallbackLabel, userId: auth.id,
    });
    return NextResponse.json({ ok: true, version, model: result.model, fallbackLabel: result.fallbackLabel });
  } catch (error) {
    if (error instanceof VersionConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
