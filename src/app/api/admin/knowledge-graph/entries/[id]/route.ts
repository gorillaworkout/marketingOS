import { NextRequest, NextResponse } from 'next/server';
import { execute, executeTransaction, queryOne } from '@/lib/database';
import { requireAdmin } from '@/lib/auth';
import {
  KNOWLEDGE_ENTRY_DELETE_SQL,
  KNOWLEDGE_ENTRY_EDGE_DELETE_SQL,
  KNOWLEDGE_ENTRY_TITLE_SQL,
  normalizeKnowledgeEntryId,
  normalizeKnowledgeEntryTitle,
} from '@/lib/knowledge-graph-entry';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const idResult = normalizeKnowledgeEntryId((await context.params).id);
  if ('error' in idResult) return NextResponse.json({ error: idResult.error }, { status: 400 });

  let body: { title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const titleResult = normalizeKnowledgeEntryTitle(body.title);
  if ('error' in titleResult) return NextResponse.json({ error: titleResult.error }, { status: 400 });

  const updated = await execute(KNOWLEDGE_ENTRY_TITLE_SQL, [titleResult.title, idResult.id]);
  if (!updated) return NextResponse.json({ error: 'Knowledge entry not found.' }, { status: 404 });
  return NextResponse.json({ id: idResult.id, title: titleResult.title });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const admin = await requireAdmin(_request);
  if (admin instanceof NextResponse) return admin;

  const idResult = normalizeKnowledgeEntryId((await context.params).id);
  if ('error' in idResult) return NextResponse.json({ error: idResult.error }, { status: 400 });

  const existing = await queryOne<{ id: string }>('SELECT id FROM knowledge_entries WHERE id = ?', [idResult.id]);
  if (!existing) return NextResponse.json({ error: 'Knowledge entry not found.' }, { status: 404 });

  await executeTransaction(async (transaction) => {
    await transaction.execute(KNOWLEDGE_ENTRY_EDGE_DELETE_SQL, [idResult.id, idResult.id]);
    await transaction.execute(KNOWLEDGE_ENTRY_DELETE_SQL, [idResult.id]);
  });
  return NextResponse.json({ id: idResult.id, deleted: true });
}
