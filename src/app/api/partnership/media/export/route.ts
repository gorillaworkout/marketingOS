import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { buildMediaDashboard, parseDateRange } from '@/lib/partnership/media';
import { mediaReportFileName, renderMediaReportPdf } from '@/lib/partnership/media-pdf';
import { getMediaSettings, latestMediaInsights, listMentionsInRange } from '@/lib/partnership/media-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&inline=1] → A4 PDF report for the range. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const range = parseDateRange(params.get('from'), params.get('to'));
  const [settings, mentions, insights] = await Promise.all([getMediaSettings(), listMentionsInRange(range), latestMediaInsights(range)]);
  const dashboard = buildMediaDashboard(mentions, range, settings.adValue);
  const pdf = await renderMediaReportPdf(settings, dashboard, insights?.result ?? null);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${params.get('inline') === '1' ? 'inline' : 'attachment'}; filename="${mediaReportFileName(settings, dashboard)}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
