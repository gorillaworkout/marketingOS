import { execute, queryOne } from './database';
import { resolveFeatureModel } from './model-routing';
import { validateStoredTables } from './ai-research';
import type { HtmlFileDeps, HtmlUploadRecord } from './ai-research-html-uploads';

interface UploadRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  filename: string;
  byte_size: number | string;
  title: string | null;
  sanitized_html: string;
  extracted_text: string | null;
  tables: unknown;
}

function parseTables(value: unknown) {
  if (typeof value === 'string') {
    try {
      return validateStoredTables(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return validateStoredTables(value);
}

/** Postgres-backed deps for HTML uploads, conversions, and Excel exports. All queries are scoped to the owner. */
export function htmlFileStore(): HtmlFileDeps {
  return {
    insertUpload: async (row: HtmlUploadRecord) => {
      await execute(
        `INSERT INTO ai_research_uploads
           (id, user_id, conversation_id, filename, mime_type, byte_size, title, sanitized_html, extracted_text, tables, created_at)
         VALUES (?, ?, ?, ?, 'text/html', ?, ?, ?, ?, ?, NOW())`,
        [row.id, row.userId, row.conversationId, row.filename, row.byteSize, row.title, row.sanitizedHtml, row.extractedText, JSON.stringify(row.tables)],
      );
    },
    loadUpload: async (userId, uploadId) => {
      const row = await queryOne<UploadRow>(
        `SELECT id, user_id, conversation_id, filename, byte_size, title, sanitized_html, extracted_text, tables
           FROM ai_research_uploads WHERE id = ? AND user_id = ?`,
        [uploadId, userId],
      );
      if (!row) return null;
      return {
        id: row.id,
        userId: row.user_id,
        conversationId: row.conversation_id,
        filename: row.filename,
        byteSize: Number(row.byte_size) || 0,
        title: row.title || '',
        sanitizedHtml: row.sanitized_html,
        extractedText: row.extracted_text || '',
        tables: parseTables(row.tables),
      };
    },
    linkUpload: async (userId, uploadId, conversationId) => {
      await execute(
        'UPDATE ai_research_uploads SET conversation_id = ? WHERE id = ? AND user_id = ?',
        [conversationId, uploadId, userId],
      );
    },
    loadConversation: (userId, conversationId) => queryOne<{ messages: unknown }>(
      'SELECT messages FROM ai_research_conversations WHERE id = ? AND user_id = ?',
      [conversationId, userId],
    ),
    createConversation: async (userId, conversationId, messages, projectId) => {
      let ownedProject: string | null = null;
      if (projectId) {
        const project = await queryOne<{ id: string }>(
          'SELECT id FROM ai_research_projects WHERE id = ? AND user_id = ?',
          [projectId, userId],
        );
        ownedProject = project?.id ?? null;
      }
      const model = await resolveFeatureModel(userId, 'ai-research');
      await execute(
        'INSERT INTO ai_research_conversations (id, user_id, messages, model, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
        [conversationId, userId, JSON.stringify(messages), model, ownedProject],
      );
    },
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
        [row.id, row.userId, row.conversationId, row.filename, row.mimeType, row.kind, row.sheetCount, row.rowCount, row.data.length, row.data],
      );
    },
  };
}
