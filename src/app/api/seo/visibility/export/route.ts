import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getSeoSite } from '@/lib/seo/sites';
import { XLSX_MIME, gapReportCsv, gapReportPdf, gapReportXlsx } from '@/lib/seo/visibility-export';
import { addAiSummary, loadGapReport } from '@/lib/seo/visibility-gap-service';

export const dynamic = 'force-dynamic';

const FORMATS = ['json', 'csv', 'xlsx', 'pdf'] as const;
type Format = typeof FORMATS[number];

function fileBase(siteName: string, generatedAt: string): string {
  const slug = siteName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site';
  const date = new Date(generatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  return `ai-visibility-${slug}-${date}`;
}

/**
 * AI Visibility export and gap report.
 * ?siteId=&format=json|csv|xlsx|pdf (default json) &ai=1 adds one LLM summary call.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const site = await getSeoSite(params.get('siteId'));
  if (!site) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });
  const requested = (params.get('format') ?? 'json').toLowerCase();
  if (!FORMATS.includes(requested as Format)) return NextResponse.json({ error: 'format must be json, csv, xlsx or pdf' }, { status: 400 });
  const format = requested as Format;

  let report = await loadGapReport(site);
  if (params.get('ai') === '1') report = await addAiSummary(report, site.id, auth.id);
  if (format === 'json') return NextResponse.json({ report });

  const base = fileBase(site.name, report.generatedAt);
  const headers = (type: string, ext: string) => ({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${base}.${ext}"`, 'Cache-Control': 'no-store' });
  if (format === 'csv') return new NextResponse(gapReportCsv(report), { headers: headers('text/csv; charset=utf-8', 'csv') });
  if (format === 'xlsx') return new NextResponse(new Uint8Array(await gapReportXlsx(report)), { headers: headers(XLSX_MIME, 'xlsx') });
  return new NextResponse(new Uint8Array(await gapReportPdf(report)), { headers: headers('application/pdf', 'pdf') });
}
