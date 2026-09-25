import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { requireInternalDocsManager } from '@/lib/internal-docs-access';
import { findVisibleDocument, reindexStoredDocument } from '@/lib/internal-docs';
import { resolveStoredInternalDoc } from '@/lib/internal-docs-storage';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const actor = await requireInternalDocsManager(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const row = await findVisibleDocument<{ access_level: string; storage_key: string; file_ext: string }>(
    actor.principal,
    id,
    true,
  );
  if (!row) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  const stored = resolveStoredInternalDoc(row.storage_key);
  if (!stored) return NextResponse.json({ error: 'Stored file is missing.' }, { status: 404 });
  try {
    const bytes = await readFile(stored);
    const indexed = await reindexStoredDocument(id, bytes, row.file_ext);
    return NextResponse.json({ id, status: indexed.status, errorMessage: indexed.errorMessage });
  } catch (error) {
    console.error('Internal doc reindex failed:', error);
    return NextResponse.json({ error: 'Could not index this document.' }, { status: 500 });
  }
}
