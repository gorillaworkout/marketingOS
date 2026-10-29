import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { MAX_BODY_LENGTH, MAX_META_LENGTH, MAX_SLUG_LENGTH, MAX_TITLE_LENGTH, slugify } from '@/lib/seo/content-prompt';
import { availableActions, canApprove, editResetsStatus, isContentAction, transitionStatus } from '@/lib/seo/content-status';
import { VersionConflictError, changeStatus, getDraft, getVersion, listVersions, saveVersion, type DraftContent } from '@/lib/seo/content-store';
import { siteRootHost, validateTargetUrl } from '@/lib/seo/keywords';
import { getSeoSite } from '@/lib/seo/sites';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  return NextResponse.json({
    draft,
    versions: await listVersions(id),
    actions: availableActions(draft.status),
    canApprove: canApprove(auth, draft.created_by),
  });
}

function parseContent(body: Record<string, unknown>): DraftContent | { error: string } {
  const field = (key: string) => (typeof body[key] === 'string' ? body[key] as string : '');
  const title = field('title').trim();
  const metaDescription = field('metaDescription').trim();
  const bodyMarkdown = field('bodyMarkdown');
  const slug = slugify(field('slug') || title);
  if (!title) return { error: 'Title is required' };
  if (title.length > MAX_TITLE_LENGTH) return { error: `Title is longer than ${MAX_TITLE_LENGTH} characters` };
  if (metaDescription.length > MAX_META_LENGTH) return { error: `Meta description is longer than ${MAX_META_LENGTH} characters` };
  if (bodyMarkdown.length > MAX_BODY_LENGTH) return { error: `Article is longer than ${MAX_BODY_LENGTH} characters` };
  if (slug.length > MAX_SLUG_LENGTH) return { error: `Slug is longer than ${MAX_SLUG_LENGTH} characters` };
  return { title, slug, metaDescription, bodyMarkdown };
}

/**
 * { action: 'save', expectedVersion, title, slug, metaDescription, bodyMarkdown, note }
 * { action: 'restore', expectedVersion, versionId }
 * { action: 'submit' | 'request-changes' | 'approve' | 'queue' | 'unqueue' | 'publish', url }
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const action = body.action;

  if (action === 'save' || action === 'restore') {
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion)) return NextResponse.json({ error: 'expectedVersion is required' }, { status: 400 });
    let content: DraftContent | { error: string };
    let note: string | null = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    if (action === 'restore') {
      const version = typeof body.versionId === 'string' ? await getVersion(id, body.versionId) : undefined;
      if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 });
      content = { title: version.title, slug: version.slug, metaDescription: version.meta_description, bodyMarkdown: version.body_markdown ?? '' };
      note = `Restored version ${version.version}`;
    } else {
      content = parseContent(body);
    }
    if ('error' in content) return NextResponse.json({ error: content.error }, { status: 400 });
    const unchanged = content.title === draft.title && content.slug === draft.slug
      && content.metaDescription === draft.meta_description && content.bodyMarkdown === draft.body_markdown;
    if (unchanged && action === 'save') return NextResponse.json({ ok: true, version: draft.current_version, unchanged: true });
    try {
      const version = await saveVersion({
        draftId: id, expectedVersion, content, source: action === 'restore' ? 'restore' : 'edit',
        nextStatus: editResetsStatus(draft.status), note, model: null, fallbackLabel: null, userId: auth.id,
      });
      return NextResponse.json({ ok: true, version });
    } catch (error) {
      if (error instanceof VersionConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
  }

  if (!isContentAction(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  const next = transitionStatus(draft.status, action);
  if (typeof next === 'object') return NextResponse.json({ error: next.error }, { status: 409 });
  if (action === 'approve' && !canApprove(auth, draft.created_by)) {
    return NextResponse.json({ error: 'You cannot approve your own article; ask a teammate or an admin to review it' }, { status: 403 });
  }
  if (action === 'submit' && !draft.body_markdown.trim()) return NextResponse.json({ error: 'Write the article before submitting it for review' }, { status: 400 });
  let publishedUrl: string | null = null;
  if (action === 'publish') {
    const site = await getSeoSite(draft.site_id);
    const url = validateTargetUrl(typeof body.url === 'string' ? body.url.trim() : '', site ? siteRootHost(site.site_url, site.gsc_property) : null);
    if ('error' in url) return NextResponse.json({ error: url.error.replace('Target page URL', 'Published URL') }, { status: 400 });
    if (!url.url) return NextResponse.json({ error: 'Published URL is required' }, { status: 400 });
    publishedUrl = url.url;
  }
  if (!await changeStatus({ draftId: id, from: draft.status, to: next, userId: auth.id, publishedUrl })) {
    return NextResponse.json({ error: 'The article status changed meanwhile. Reload and try again.' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, status: next });
}
