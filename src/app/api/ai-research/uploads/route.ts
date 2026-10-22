import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { AI_RESEARCH_MAX_HTML_DOCUMENT_BYTES } from '@/lib/ai-research';
import { htmlFileStore } from '@/lib/ai-research-html-store';
import {
  HtmlFileError,
  createHtmlUpload,
  readHtmlUploadBody,
  readRawUploadName,
  type HtmlUploadInput,
} from '@/lib/ai-research-html-uploads';
import { htmlUploadKnowledgePayload } from '@/lib/ai-research-html-knowledge';
import { persistKnowledgeQuietly } from '@/lib/knowledge-persist';

export const maxDuration = 60;

const TOO_LARGE = 'Each HTML file must be 10 MB or smaller.';

/**
 * Store a sanitized HTML upload right away so Convert/Excel work before any
 * question is sent. Accepts the raw file as the body (?name=page.html; no
 * base64 overhead) or JSON { name, dataUrl }.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const limited = rateLimit(request, `ai-research-upload:${auth.id}`);
  if (limited) return limited;

  const contentType = request.headers.get('content-type') || '';
  let input: HtmlUploadInput & { conversationId?: string | null };
  try {
    if (contentType.toLowerCase().startsWith('application/json')) {
      input = readHtmlUploadBody(await request.json());
    } else {
      // A custom header forces a CORS preflight, so other sites cannot post raw bodies here.
      if (request.headers.get('x-ai-research-upload') !== '1') throw new HtmlFileError('Invalid upload request.');
      const declared = Number(request.headers.get('content-length') || 0);
      if (declared > AI_RESEARCH_MAX_HTML_DOCUMENT_BYTES) throw new HtmlFileError(TOO_LARGE, 413);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > AI_RESEARCH_MAX_HTML_DOCUMENT_BYTES) throw new HtmlFileError(TOO_LARGE, 413);
      input = { name: readRawUploadName(request.url), bytes, mimeType: contentType };
    }
  } catch (error) {
    if (error instanceof HtmlFileError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Invalid upload body' }, { status: 400 });
  }

  try {
    const upload = await createHtmlUpload(auth.id, input, htmlFileStore());
    const knowledge = htmlUploadKnowledgePayload({
      userId: auth.id,
      name: upload.filename,
      text: upload.extractedText,
      conversationId: upload.conversationId,
    });
    if (knowledge) {
      void persistKnowledgeQuietly(knowledge).catch(error => console.warn('[ai-research] HTML knowledge save failed:', error));
    }
    return NextResponse.json({
      uploadId: upload.id,
      name: upload.filename,
      title: upload.title,
      tableCount: upload.tables.length,
      tableNames: upload.tables.map(table => table.name),
      byteSize: upload.byteSize,
    });
  } catch (error) {
    if (error instanceof HtmlFileError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[ai-research] HTML upload failed:', error);
    return NextResponse.json({ error: 'Could not read the HTML file. Please try again.' }, { status: 500 });
  }
}
