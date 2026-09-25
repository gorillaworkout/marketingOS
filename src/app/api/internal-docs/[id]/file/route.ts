import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { requireInternalDocsUser } from '@/lib/internal-docs-access';
import { canManageInternalDocs } from '@/lib/internal-docs-acl';
import { findVisibleDocument } from '@/lib/internal-docs';
import { contentDispositionFor, inlineDocumentRequested, resolveStoredInternalDoc, safeDownloadName } from '@/lib/internal-docs-storage';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const actor = await requireInternalDocsUser(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const row = await findVisibleDocument<{
    access_level: string;
    storage_key: string;
    mime_type: string;
    original_name: string;
    file_ext: string;
    status: string;
  }>(actor.principal, id, canManageInternalDocs(actor.principal));
  if (!row || (row.status !== 'indexed' && !canManageInternalDocs(actor.principal))) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  const stored = resolveStoredInternalDoc(row.storage_key);
  if (!stored) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  try {
    const bytes = await readFile(stored);
    const filename = safeDownloadName(row.original_name, row.file_ext);
    const inline = inlineDocumentRequested(request.nextUrl.searchParams.get('inline'));
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': row.mime_type || 'application/octet-stream',
        'Content-Disposition': contentDispositionFor(filename, inline),
        'Content-Length': String(bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "frame-ancestors 'self'",
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
}
