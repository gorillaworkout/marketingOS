import { unlink } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/database';
import { requireInternalDocsManager, requireInternalDocsUser } from '@/lib/internal-docs-access';
import { canManageInternalDocs, isInternalDocAccessLevel } from '@/lib/internal-docs-acl';
import { findVisibleDocument, publicDocument, type InternalDocListRow } from '@/lib/internal-docs';
import { resolveStoredInternalDoc, sanitizeDocumentTitle } from '@/lib/internal-docs-storage';

type RouteContext = { params: Promise<{ id: string }> };

interface DocumentRow extends InternalDocListRow {
  storage_key: string;
  extracted_text: string;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const actor = await requireInternalDocsUser(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const row = await findVisibleDocument<DocumentRow>(actor.principal, id, canManageInternalDocs(actor.principal));
  if (!row) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  return NextResponse.json({
    document: {
      ...publicDocument(row),
      extractedText: row.extracted_text || '',
    },
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await requireInternalDocsManager(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const existing = await findVisibleDocument<DocumentRow>(actor.principal, id, true);
  if (!existing) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  let body: { title?: unknown; accessLevel?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  if (body.title !== undefined) {
    const title = sanitizeDocumentTitle(String(body.title || ''));
    if (!title) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
    updates.push('title = ?');
    params.push(title);
  }
  if (body.accessLevel !== undefined) {
    const accessLevel = String(body.accessLevel);
    if (!isInternalDocAccessLevel(accessLevel)) {
      return NextResponse.json({ error: 'Access level must be Company or IT-only.' }, { status: 400 });
    }
    updates.push('access_level = ?');
    params.push(accessLevel);
  }
  if (!updates.length) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  await execute(`UPDATE internal_documents SET ${updates.join(', ')} WHERE id = ?`, params);
  const row = await findVisibleDocument<DocumentRow>(actor.principal, id, true);
  return NextResponse.json({ document: row ? { ...publicDocument(row), extractedText: row.extracted_text || '' } : null });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const actor = await requireInternalDocsManager(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const existing = await findVisibleDocument<DocumentRow>(actor.principal, id, true);
  if (!existing) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  await execute('DELETE FROM internal_documents WHERE id = ?', [id]);
  const stored = resolveStoredInternalDoc(existing.storage_key);
  if (stored) await unlink(stored).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
