import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import {
  IMPORT_FILE_BYTE_LIMIT,
  MultiChatImportError,
  decodeUtf8,
  importFileError,
  importPasteError,
  isChatImportSource,
  parseImportedChat,
} from '@/lib/chat-import-parse';
import { createChatImport, listChatImports, postgresChatImportDeps } from '@/lib/chat-import';

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  try {
    const imports = await listChatImports(auth.id, postgresChatImportDeps());
    return json({ imports });
  } catch {
    console.error('[ai-research] chat import', { status: 'list_failed' });
    return json({ error: 'Could not load imports.' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      let body: { source?: unknown; text?: unknown };
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Send the chat as JSON or as a file.' }, 400);
      }
      if (!isChatImportSource(body.source)) return json({ error: 'Choose a source.' }, 400);
      const text = typeof body.text === 'string' ? body.text : '';
      const pasteError = importPasteError(text);
      if (pasteError) return json({ error: pasteError.error }, pasteError.status);
      try {
        parseImportedChat(body.source, text);
      } catch (error) {
        if (error instanceof MultiChatImportError) return json({ error: error.message }, 400);
        throw error;
      }
      const result = await createChatImport(auth.id, body.source, text, postgresChatImportDeps());
      return json(result.body, result.status);
    }
    if (!contentType.includes('multipart/form-data')) {
      return json({ error: 'Send the chat as JSON or as a file.' }, 400);
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'Send the chat as JSON or as a file.' }, 400);
    }
    const source = form.get('source');
    if (!isChatImportSource(source)) return json({ error: 'Choose a source.' }, 400);
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'Send the chat as JSON or as a file.' }, 400);
    if (file.size > IMPORT_FILE_BYTE_LIMIT) return json({ error: 'File is limited to 5 MB.' }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = decodeUtf8(bytes);
    const uploaded = file.name;
    const fileError = importFileError({ filename: uploaded, bytes: file.size, text: decoded });
    if (fileError) return json({ error: fileError.error }, fileError.status);
    try {
      parseImportedChat(source, decoded as string);
    } catch (error) {
      if (error instanceof MultiChatImportError) return json({ error: error.message }, 400);
      throw error;
    }
    const result = await createChatImport(auth.id, source, decoded as string, postgresChatImportDeps());
    return json(result.body, result.status);
  } catch {
    console.error('[ai-research] chat import', { status: 'create_failed' });
    return json({ error: 'Could not import that chat.' }, 500);
  }
}
