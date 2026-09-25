-- Link knowledge rows to the task that produced them, and store a content hash
-- so Approve / Publish / repeated research turns update a row instead of copying it.
-- Existing rows keep working: both columns are nullable.

BEGIN;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS task_id TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_user_task
  ON knowledge_entries (user_id, task_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_user_hash
  ON knowledge_entries (user_id, content_hash);

COMMIT;
