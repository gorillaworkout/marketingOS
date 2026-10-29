import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { CSV_MIME } from '@/lib/ai-research-csv';
import { execute } from '@/lib/database';
import { decodeCsvBytes } from '@/lib/seo/csv';
import { listKeywords, upsertKeywords } from '@/lib/seo/keyword-store';
import { keywordsToCsv, MAX_IMPORT_BYTES, parseKeywordCsv, siteRootHost } from '@/lib/seo/keywords';
import { getSeoSite } from '@/lib/seo/sites';

export const dynamic = 'force-dynamic';

const MAX_REPORTED_ERRORS = 50;

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const site = await getSeoSite(request.nextUrl.searchParams.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const keywords = await listKeywords(site.id);

  if (request.nextUrl.searchParams.get('format') === 'csv') {
    const stem = site.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'site';
    return new NextResponse(keywordsToCsv(keywords), {
      headers: { 'Content-Type': CSV_MIME, 'Content-Disposition': `attachment; filename="seo-keywords-${stem}.csv"`, 'Cache-Control': 'no-store' },
    });
  }
  return NextResponse.json({ keywords });
}

/** Import: the request body is the raw CSV file (UTF-8 with or without BOM, or UTF-16). */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const site = await getSeoSite(request.nextUrl.searchParams.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_IMPORT_BYTES) return NextResponse.json({ error: 'The file is larger than 2 MB' }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_IMPORT_BYTES) return NextResponse.json({ error: 'The file is larger than 2 MB' }, { status: 413 });
  if (!bytes.length) return NextResponse.json({ error: 'The file is empty' }, { status: 400 });

  const { text, encoding } = decodeCsvBytes(bytes);
  const parsed = parseKeywordCsv(text, { rootHost: siteRootHost(site.site_url, site.gsc_property) });
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const saved = dryRun ? { inserted: 0, updated: 0 } : await upsertKeywords(site.id, parsed.rows, auth.id);

  return NextResponse.json({
    dryRun,
    encoding,
    dataRows: parsed.dataRows,
    valid: parsed.rows.length,
    duplicates: parsed.duplicates,
    inserted: saved.inserted,
    updated: saved.updated,
    errorCount: parsed.errors.length,
    errors: parsed.errors.slice(0, MAX_REPORTED_ERRORS),
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = request.nextUrl.searchParams;
  const site = await getSeoSite(params.get('siteId'));
  const id = params.get('id');
  if (!site || !id) return NextResponse.json({ error: 'siteId and id are required' }, { status: 400 });
  const removed = await execute('DELETE FROM seo_keywords WHERE id = ? AND site_id = ?', [id, site.id]);
  if (!removed) return NextResponse.json({ error: 'Keyword not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
