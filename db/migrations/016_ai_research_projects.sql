-- Saved Dupoin AI Research projects.
-- A project groups conversations and stores pinned notes plus a short rolling summary
-- used as capped multi-turn memory. project_id NULL is the default inbox
-- ("Percakapan biasa"). Deleting a project returns its threads to the inbox.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_research_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_research_projects_user
  ON ai_research_projects (user_id, updated_at DESC);

ALTER TABLE ai_research_conversations
  ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES ai_research_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_research_conv_user_project
  ON ai_research_conversations (user_id, project_id, updated_at DESC);

COMMIT;
