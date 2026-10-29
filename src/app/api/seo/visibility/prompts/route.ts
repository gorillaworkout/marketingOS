import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { decodeCsvBytes } from '@/lib/seo/csv';
import { MAX_IMPORT_BYTES } from '@/lib/seo/keywords';
import { getSeoSite } from '@/lib/seo/sites';
import { parsePromptCsv, parsePromptInput } from '@/lib/seo/visibility';
import { DuplicatePromptError, PromptLimitError, createPrompt, importPrompts, listPrompts } from '@/lib/seo/visibility-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const site = await getSeoSite(request.nextUrl.searchParams.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  return NextResponse.json({ prompts: await listPrompts(site.id) });
}

/**
 * JSON body { prompt, brandTerms, competitors, active } creates one prompt.
 * With ?import=1 the body is a raw CSV file (prompt, brand_terms, competitors, active); add &dryRun=1 to preview.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const site = await getSeoSite(params.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });

  try {
    if (params.get('import') === '1') {
      if (Number(request.headers.get('content-length') ?? 0) > MAX_IMPORT_BYTES) return NextResponse.json({ error: 'The file is larger than 2 MB' }, { status: 413 });
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > MAX_IMPORT_BYTES) return NextResponse.json({ error: 'The file is larger than 2 MB' }, { status: 413 });
      if (!bytes.length) return NextResponse.json({ error: 'The file is empty' }, { status: 400 });
      const parsed = parsePromptCsv(decodeCsvBytes(bytes).text);
      const dryRun = params.get('dryRun') === '1';
      const saved = dryRun ? { inserted: 0, updated: 0 } : await importPrompts(site.id, parsed.rows, auth.id);
      return NextResponse.json({ dryRun, dataRows: parsed.dataRows, valid: parsed.rows.length, ...saved, errorCount: parsed.errors.length, errors: parsed.errors.slice(0, 50) });
    }
    const input = parsePromptInput(await request.json().catch(() => null));
    if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
    const id = await createPrompt(site.id, input, auth.id);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicatePromptError || error instanceof PromptLimitError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
