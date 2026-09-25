import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { requireInternalDocsUser } from '@/lib/internal-docs-access';
import { canManageInternalDocs } from '@/lib/internal-docs-acl';
import { findVisibleDocument } from '@/lib/internal-docs';
import { collectDocxImages } from '@/lib/internal-docs-extract';
import { resolveStoredInternalDoc } from '@/lib/internal-docs-storage';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string; index: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const actor = await requireInternalDocsUser(request);
  if (actor instanceof NextResponse) return actor;
  const { id, index } = await context.params;
  if (!/^\d{1,2}$/.test(index)) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  const imageIndex = Number(index);
  const row = await findVisibleDocument<{
    access_level: string;
    storage_key: string;
    file_ext: string;
    status: string;
  }>(actor.principal, id, canManageInternalDocs(actor.principal));
  if (!row || row.file_ext !== '.docx' || (row.status !== 'indexed' && !canManageInternalDocs(actor.principal))) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  const stored = resolveStoredInternalDoc(row.storage_key);
  if (!stored) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  try {
    const images = await collectDocxImages(await readFile(stored));
    const image = images[imageIndex];
    if (!image) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    return new NextResponse(Buffer.from(image.bytes), {
      headers: {
        'Content-Type': image.contentType,
        'Content-Disposition': 'inline',
        'Content-Length': String(image.bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "frame-ancestors 'self'",
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
}
