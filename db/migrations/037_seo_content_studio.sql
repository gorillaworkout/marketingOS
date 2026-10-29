-- SEO OS, Phase 3: Content Studio. Adds the `seo-content` model-routed
-- feature and the draft + version-history tables. Idempotent and
-- forward-only: tables and indexes use IF NOT EXISTS, the CHECK constraint is
-- dropped and re-added with every earlier value kept, and the model
-- assignment is inserted only when missing (admin changes are preserved).

BEGIN;

-- 1. `seo-content` must be a valid task_type before preferences can use it.
ALTER TABLE task_model_preferences
  DROP CONSTRAINT IF EXISTS task_model_preferences_task_type_check;

ALTER TABLE task_model_preferences
  ADD CONSTRAINT task_model_preferences_task_type_check
  CHECK (task_type IN (
    'caption',
    'image-prompt',
    'social-post',
    'video-script',
    'event-plan',
    'article-market-news',
    'market-research',
    'ai-research',
    'seo-content'
  ));

-- 2. Admin-editable model allowlist and default for Content Studio.
INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model, updated_at)
VALUES (
  'seo-content',
  '["ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb,
  'cc/claude-sonnet-5-5',
  CURRENT_TIMESTAMP
)
ON CONFLICT (feature_key) DO NOTHING;

-- 3. One row per article. `body_markdown` is the current text; every change
-- is also written to seo_content_versions. `queue_item_id` links the
-- opportunity hand-off (P2) that started the draft.
CREATE TABLE IF NOT EXISTS seo_content_drafts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  queue_item_id TEXT REFERENCES seo_content_queue(id) ON DELETE SET NULL,
  keyword TEXT NOT NULL,
  case_study TEXT,
  instructions TEXT,
  target_page_url TEXT,
  brand_guideline_id TEXT,
  brand_guideline_name TEXT,
  title TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  meta_description TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'queued', 'published')),
  current_version INTEGER NOT NULL DEFAULT 1,
  model TEXT,
  fallback_label TEXT,
  published_url TEXT,
  published_at TIMESTAMPTZ,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT seo_content_drafts_published_url CHECK (published_url IS NULL OR published_url ~ '^(http|https)://'),
  CONSTRAINT seo_content_drafts_target_url CHECK (target_page_url IS NULL OR target_page_url ~ '^(http|https)://')
);

CREATE INDEX IF NOT EXISTS idx_seo_content_drafts_site_status ON seo_content_drafts (site_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_content_drafts_queue_item ON seo_content_drafts (queue_item_id);

-- 4. Full snapshot per save, AI draft, AI rewrite or restore.
CREATE TABLE IF NOT EXISTS seo_content_versions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES seo_content_drafts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('create', 'edit', 'ai-draft', 'ai-rewrite', 'restore')),
  title TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  meta_description TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  note TEXT,
  model TEXT,
  fallback_label TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_content_versions_draft_version ON seo_content_versions (draft_id, version);

COMMIT;
