import { after, NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { EVIDENCE_IMAGE_MAX_BYTES, EVIDENCE_IMAGE_TYPES, extractScreenshotText, storeScreenshot } from '@/lib/partnership/evidence';
import { instagramPostText, isInstagramPostUrl } from '@/lib/partnership/campaigns';
import { readInstagramPost } from '@/lib/partnership/collect';
import { parseEvidenceInput } from '@/lib/partnership/intel';
import { fetchPublic } from '@/lib/partnership/public-fetch';
import { createEvidence, deleteEvidence, getCompetitor, getEvidence, saveEvidenceExtraction } from '@/lib/partnership/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

/** Reads the caption, date and hashtags of a pasted public Instagram post (no login) and stores them on the evidence. */
function captureInstagramCaption(evidenceId: string, sourceUrl: string | null, hasScreenshot: boolean) {
  if (!sourceUrl || !isInstagramPostUrl(sourceUrl)) return;
  after(async () => {
    const post = await readInstagramPost(sourceUrl, (url, accept) => fetchPublic(url, accept)).catch(() => null);
    // A screenshot's vision text wins; the caption is only stored for link evidence.
    if (post && !hasScreenshot) await saveEvidenceExtraction(evidenceId, instagramPostText(post));
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!(await getCompetitor(id))) return NextResponse.json({ error: 'Competitor not found.' }, { status: 404 });

  if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: 'Send the evidence form.' }, { status: 400 });
    const file = form.get('file');
    const hasFile = file instanceof File && file.size > 0;
    if (hasFile) {
      if (!EVIDENCE_IMAGE_TYPES.has(file.type)) return NextResponse.json({ error: 'Use a PNG, JPG, or WebP image.' }, { status: 400 });
      if (file.size > EVIDENCE_IMAGE_MAX_BYTES) return NextResponse.json({ error: 'Image must be 5 MB or smaller.' }, { status: 400 });
    }
    const parsed = parseEvidenceInput({
      sourceUrl: form.get('sourceUrl'), pastedText: form.get('pastedText'), observedOn: form.get('observedOn'),
    }, { hasScreenshot: hasFile });
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const screenshotKey = hasFile ? await storeScreenshot(file) : null;
    const evidenceId = await createEvidence(id, { ...parsed.value, screenshotKey }, auth.id);
    if (screenshotKey) {
      // Vision runs after the response; without a vision model the screenshot stays stored and the caption text is used.
      after(async () => { await saveEvidenceExtraction(evidenceId, await extractScreenshotText(auth.id, screenshotKey)); });
    }
    captureInstagramCaption(evidenceId, parsed.value.sourceUrl, Boolean(screenshotKey));
    return NextResponse.json({ id: evidenceId }, { status: 201 });
  }

  const parsed = parseEvidenceInput(await request.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const evidenceId = await createEvidence(id, parsed.value, auth.id);
  captureInstagramCaption(evidenceId, parsed.value.sourceUrl, false);
  return NextResponse.json({ id: evidenceId }, { status: 201 });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const evidenceId = request.nextUrl.searchParams.get('evidenceId') || '';
  const evidence = evidenceId ? await getEvidence(evidenceId) : undefined;
  if (!evidence || evidence.competitorId !== id) return NextResponse.json({ error: 'Evidence not found.' }, { status: 404 });
  if (auth.role !== 'admin' && evidence.createdBy !== auth.id) {
    return NextResponse.json({ error: 'Only the person who added this evidence, or an admin, can delete it.' }, { status: 403 });
  }
  await deleteEvidence(evidenceId);
  return NextResponse.json({ success: true });
}
