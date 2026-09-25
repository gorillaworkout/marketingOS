import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireInternalDocsManager, requireInternalDocsUser } from '@/lib/internal-docs-access';
import { canManageInternalDocs, isInternalDocAccessLevel } from '@/lib/internal-docs-acl';
import { createIndexedDocument, listInternalDocuments, publicDocument } from '@/lib/internal-docs';
import { internalDocUploadIssue } from '@/lib/internal-docs-upload';
import {
  internalDocKind,
  internalDocsDirectory,
  resolveStoredInternalDoc,
  sanitizeDocumentTitle,
  storageKeyFor,
  titleFromFilename,
} from '@/lib/internal-docs-storage';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const actor = await requireInternalDocsUser(request);
  if (actor instanceof NextResponse) return actor;
  const search = request.nextUrl.searchParams.get('q') || '';
  const documents = await listInternalDocuments(actor.principal, search);
  return NextResponse.json({
    canManage: canManageInternalDocs(actor.principal),
    documents: documents.map(publicDocument),
  });
}

export async function POST(request: NextRequest) {
  const actor = await requireInternalDocsManager(request);
  if (actor instanceof NextResponse) return actor;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Upload a PDF, DOCX, MD, or TXT file.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'File is required.' }, { status: 400 });
  const issue = internalDocUploadIssue(file);
  if (issue) return NextResponse.json({ error: issue }, { status: 400 });

  const kind = internalDocKind(file.name || '', file.type || '');
  if (!kind) return NextResponse.json({ error: 'Unsupported file type. Use PDF, DOCX, MD, or TXT.' }, { status: 400 });

  const accessValue = String(form.get('accessLevel') || '');
  if (!isInternalDocAccessLevel(accessValue)) {
    return NextResponse.json({ error: 'Access level must be Company or IT-only.' }, { status: 400 });
  }

  const requestedTitle = sanitizeDocumentTitle(String(form.get('title') || ''));
  const title = requestedTitle || titleFromFilename(file.name || 'Document');
  const id = uuidv4();
  const storageKey = storageKeyFor(id, kind.ext);
  const absolute = resolveStoredInternalDoc(storageKey);
  if (!absolute) return NextResponse.json({ error: 'Could not store this file.' }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  await mkdir(internalDocsDirectory(), { recursive: true });
  await writeFile(absolute, bytes);

  try {
    const indexed = await createIndexedDocument({
      id,
      title,
      originalName: (file.name || `document${kind.ext}`).split(/[/\\]/).pop() || `document${kind.ext}`,
      mimeType: kind.mimeType,
      fileExt: kind.ext,
      fileSize: bytes.byteLength,
      storageKey,
      accessLevel: accessValue,
      uploadedBy: actor.user.id,
      bytes,
    });
    return NextResponse.json({
      id,
      title,
      accessLevel: accessValue,
      status: indexed.status,
      errorMessage: indexed.errorMessage,
    }, { status: 201 });
  } catch (error) {
    await unlink(absolute).catch(() => undefined);
    console.error('Internal doc upload failed:', error);
    return NextResponse.json({ error: 'Could not save this document.' }, { status: 500 });
  }
}
