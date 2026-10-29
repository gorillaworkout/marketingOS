import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { DEFAULT_GUIDELINE_NAME, generateSeoDraft, resolveBrandGuideline } from '@/lib/seo/content-ai';
import { parseCreateRequest, slugify } from '@/lib/seo/content-prompt';
import { isContentStatus } from '@/lib/seo/content-status';
import { QueueItemTakenError, countDraftsByStatus, createDraft, draftForQueueItem, getPendingQueueItem, listDrafts } from '@/lib/seo/content-store';
import { siteRootHost, validateTargetUrl } from '@/lib/seo/keywords';
import { getSeoSite } from '@/lib/seo/sites';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = request.nextUrl.searchParams;
  const site = await getSeoSite(params.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const status = params.get('status') ?? 'all';
  if (status !== 'all' && !isContentStatus(status)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
  const [drafts, counts] = await Promise.all([listDrafts(site.id, status), countDraftsByStatus(site.id)]);
  return NextResponse.json({ drafts, counts });
}

/** Starts an article from a keyword (+ case study), optionally claiming a pending queue item. */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const site = await getSeoSite(typeof body?.siteId === 'string' ? body.siteId : null);
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const parsed = parseCreateRequest(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  let queueItem: Awaited<ReturnType<typeof getPendingQueueItem>>;
  if (parsed.queueItemId) {
    queueItem = await getPendingQueueItem(site.id, parsed.queueItemId);
    if (!queueItem) {
      const existing = await draftForQueueItem(parsed.queueItemId);
      return NextResponse.json({ error: 'This queue item is no longer pending', draftId: existing }, { status: 409 });
    }
  }
  const target = validateTargetUrl(parsed.targetPageUrl || queueItem?.target_page_url || '', siteRootHost(site.site_url, site.gsc_property));
  if ('error' in target) return NextResponse.json({ error: target.error }, { status: 400 });
  const guideline = await resolveBrandGuideline(auth.id, parsed.brandGuidelineId);
  if (!guideline) return NextResponse.json({ error: 'Brand guideline not found' }, { status: 400 });

  let content = { title: parsed.keyword, slug: slugify(parsed.keyword), metaDescription: '', bodyMarkdown: '' };
  let model: string | null = null;
  let fallbackLabel: string | null = null;
  if (parsed.mode === 'ai') {
    try {
      const draft = await generateSeoDraft(auth.id, {
        siteName: site.name,
        siteUrl: site.site_url,
        keyword: parsed.keyword,
        caseStudy: parsed.caseStudy,
        targetPageUrl: target.url,
        opportunityType: queueItem?.opportunity_type ?? null,
        metrics: (queueItem?.metrics ?? null) as Record<string, number> | null,
        instructions: [parsed.instructions, queueItem?.note ? `Note from SEO OS: ${queueItem.note}` : null].filter(Boolean).join('\n') || null,
      }, guideline);
      content = { title: draft.title, slug: draft.slug, metaDescription: draft.metaDescription, bodyMarkdown: draft.bodyMarkdown };
      model = draft.model;
      fallbackLabel = draft.fallbackLabel;
    } catch (error) {
      console.error('SEO content draft generation failed:', error instanceof Error ? error.message : error);
      return NextResponse.json({ error: `AI draft failed: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 502 });
    }
  }

  try {
    const id = await createDraft({
      siteId: site.id,
      queueItemId: queueItem?.id ?? null,
      keyword: parsed.keyword,
      caseStudy: parsed.caseStudy,
      instructions: parsed.instructions,
      targetPageUrl: target.url,
      brandGuidelineId: parsed.brandGuidelineId,
      brandGuidelineName: parsed.brandGuidelineId ? guideline.brand_name : DEFAULT_GUIDELINE_NAME,
      content,
      source: parsed.mode === 'ai' ? 'ai-draft' : 'create',
      model,
      fallbackLabel,
      userId: auth.id,
    });
    return NextResponse.json({ id, model, fallbackLabel }, { status: 201 });
  } catch (error) {
    if (error instanceof QueueItemTakenError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
