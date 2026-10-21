import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { execute, queryOne } from '@/lib/database';
import { generateContent } from '@/lib/openai';
import { resolveFeatureModel } from '@/lib/model-routing';
import { rateLimit } from '@/lib/rate-limit';
import {
  EXTRACTION_MAX_OUTPUT_TOKENS,
  ExcelExportError,
  XLSX_MIME,
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
      loadConversation: (userId, conversationId) => queryOne<{ messages: unknown }>(
        'SELECT messages FROM ai_research_conversations WHERE id = ? AND user_id = ?',
        [conversationId, userId],
      ),
      saveConversationMessages: async (userId, conversationId, messages) => {
        await execute(
          'UPDATE ai_research_conversations SET messages = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
          [JSON.stringify(messages), conversationId, userId],
        );
      },
      saveExport: async row => {
        await execute(
          `INSERT INTO ai_research_exports
             (id, user_id, conversation_id, filename, mime_type, kind, sheet_count, row_count, byte_size, data, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [row.id, row.userId, row.conversationId, row.filename, XLSX_MIME, row.kind, row.sheetCount, row.rowCount, row.data.length, row.data],
        );
      },
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
    return NextResponse.json({ message: result.message, attachment: result.attachment });
  } catch (error) {
    if (error instanceof ExcelExportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[ai-research] Excel export failed:', error);
    return NextResponse.json({ error: 'Could not create the Excel file. Please try again.' }, { status: 502 });
  }
}
