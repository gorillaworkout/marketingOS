import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { queryOne } from '@/lib/database';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
  const row = await queryOne<{ filename: string; mime_type: string; data: Buffer }>(
    'SELECT filename, mime_type, data FROM ai_research_exports WHERE id = ? AND user_id = ?',
    [id, auth.id],
  );
  if (!row) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
  const filename = row.filename.replace(/[^A-Za-z0-9._-]+/g, '-');
  return new Response(new Uint8Array(row.data), {
    headers: {
      'Content-Type': row.mime_type,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(row.data.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
