import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { htmlFileStore } from '@/lib/ai-research-html-store';
import { HtmlFileError, convertUpload, readConvertBody } from '@/lib/ai-research-html-uploads';

export const maxDuration = 120;

/** Convert a stored HTML upload to Excel, PDF, or Word and add it to the chat thread. */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const limited = rateLimit(request, `ai-research-convert:${auth.id}`);
  if (limited) return limited;

  let input;
  try {
    input = readConvertBody(await request.json());
  } catch (error) {
    if (error instanceof HtmlFileError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await convertUpload(auth.id, input, htmlFileStore());
    return NextResponse.json({
      conversationId: result.conversationId,
      messages: result.appended,
      created: result.created,
      attachment: result.attachment,
    });
  } catch (error) {
    if (error instanceof HtmlFileError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[ai-research] HTML convert failed:', error);
    return NextResponse.json({ error: 'Could not convert the file. Please try again.' }, { status: 502 });
  }
}
