import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getDraft } from '@/lib/seo/content-store';
import { renderHtmlExport, renderMarkdownExport } from '@/lib/seo/markdown';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Download the current version as Markdown (?format=md) or HTML (?format=html). */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  const format = request.nextUrl.searchParams.get('format') === 'html' ? 'html' : 'md';
  const name = (draft.slug || 'article').replace(/[^a-z0-9-]/g, '') || 'article';
  const body = format === 'html' ? renderHtmlExport(draft) : renderMarkdownExport(draft);
  return new NextResponse(body, {
    headers: {
      'Content-Type': format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
}
