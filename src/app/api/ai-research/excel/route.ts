import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { htmlFileStore } from '@/lib/ai-research-html-store';
import { generateContent } from '@/lib/openai';
import { resolveFeatureModel } from '@/lib/model-routing';
import { rateLimit } from '@/lib/rate-limit';
import {
  EXTRACTION_MAX_OUTPUT_TOKENS,
  ExcelExportError,
  createExcelExport,
  parseExcelExportRequest,
} from '@/lib/ai-research-excel-export';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let parsed;
  try {
    parsed = parseExcelExportRequest(await request.json());
  } catch (error) {
    const message = error instanceof ExcelExportError ? error.message : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (parsed.mode === 'extract') {
    const limited = rateLimit(request, `ai-research-excel:${auth.id}`);
    if (limited) return limited;
  }

  try {
    const result = await createExcelExport(auth.id, parsed, {
      ...htmlFileStore(),
      generateJson: async ({ userId, system, user }) => {
        const model = await resolveFeatureModel(userId, 'ai-research');
        const generated = await generateContent(system, user, userId, undefined, {
          model,
          responseFormat: { type: 'json_object' },
          temperature: 0.1,
          maxTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
          taskType: 'ai-research',
        });
        return { content: generated.content, fallbackLabel: generated.fallbackLabel };
      },
    });
    return NextResponse.json({
      message: result.message,
      attachment: result.attachment,
      conversationId: result.conversationId,
      messages: result.appended,
      created: result.created,
    });
  } catch (error) {
    if (error instanceof ExcelExportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[ai-research] Excel export failed:', error);
    return NextResponse.json({ error: 'Could not create the Excel file. Please try again.' }, { status: 502 });
  }
}
