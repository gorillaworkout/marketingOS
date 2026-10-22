-- Uploaded HTML files for AI Research, stored sanitized so they can be
-- converted (Excel, PDF, Word) or exported right after upload, before any
-- question is asked or answer saved. Raw HTML is never stored.
-- Also widens ai_research_exports.kind for the new conversion outputs.
-- Idempotent and forward-only.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_research_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'text/html',
  byte_size INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  sanitized_html TEXT NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  tables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_research_uploads_user
  ON ai_research_uploads (user_id, created_at DESC);

ALTER TABLE ai_research_exports
  DROP CONSTRAINT IF EXISTS ai_research_exports_kind_check;

ALTER TABLE ai_research_exports
  ADD CONSTRAINT ai_research_exports_kind_check
  CHECK (kind IN ('tables', 'extract', 'convert-xlsx', 'convert-pdf', 'convert-docx'));

COMMIT;
