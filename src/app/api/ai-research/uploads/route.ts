import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { htmlFileStore } from '@/lib/ai-research-html-store';
import { HtmlFileError, createHtmlUpload, readHtmlUploadBody } from '@/lib/ai-research-html-uploads';
import { htmlUploadKnowledgePayload } from '@/lib/ai-research-html-knowledge';
import { persistKnowledgeQuietly } from '@/lib/knowledge-persist';

export const maxDuration = 60;

/** Store a sanitized HTML upload right away so Convert/Excel work before any question is sent. */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const limited = rateLimit(request, `ai-research-upload:${auth.id}`);
  if (limited) return limited;

  let input;
  try {
    input = readHtmlUploadBody(await request.json());
  } catch (error) {
    const message = error instanceof HtmlFileError ? error.message : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
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
      byteSize: upload.byteSize,
    });
  } catch (error) {
    if (error instanceof HtmlFileError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[ai-research] HTML upload failed:', error);
    return NextResponse.json({ error: 'Could not read the HTML file. Please try again.' }, { status: 500 });
  }
}
