-- Monthly Report (Onboarding now, Settlement later).
--  * `monthly-report` becomes an assignable department feature.
--  * monthly_report_access was created for per-user grants. The app no longer
--    uses it (access is department-only via Accounts → Departments). The table
--    is retained; no destructive drop.
--  * Normalized data tables carry `source` ('upload' | 'api') so a future API
--    sync writes the same rows as today's Excel/CSV uploads.
-- Forward-only and idempotent: safe to run twice, never deletes data.
BEGIN;

ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_permitted_features_valid;
ALTER TABLE departments ADD CONSTRAINT departments_permitted_features_valid CHECK (
  permitted_features <@ ARRAY[
    'social-post',
    'video-script',
    'event-plan',
    'article-market-news',
    'market-research',
    'ai-research',
    'internal-docs',
    'seo',
    'monthly-report'
  ]::text[]
);

-- Table retained after the Access tab was removed. Access is now department-only
-- (Accounts → Departments). No destructive drop; this table is unused by the app.
CREATE TABLE IF NOT EXISTS monthly_report_access (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  can_upload BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS monthly_report_uploads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('onboarding', 'ftd', 'rejection_reasons')),
  file_name TEXT NOT NULL,
  source_utc_offset TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name TEXT,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  data_from DATE,
  data_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_monthly_report_uploads_created ON monthly_report_uploads (created_at DESC);

-- One row per onboarding step event from the "real account conversion" export.
CREATE TABLE IF NOT EXISTS onboarding_events (
  document_id TEXT PRIMARY KEY,
  event_at TIMESTAMPTZ NOT NULL,
  uid TEXT,
  is_first_account BOOLEAN,
  trading_account_no TEXT,
  approval_method TEXT,
  step TEXT NOT NULL,
  step_status TEXT NOT NULL,
  account_status TEXT,
  remarks TEXT,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'api')),
  upload_id TEXT REFERENCES monthly_report_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_event_at ON onboarding_events (event_at);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_account ON onboarding_events (trading_account_no);

-- First-time deposits, one row per trading account.
CREATE TABLE IF NOT EXISTS onboarding_ftd (
  account_no TEXT PRIMARY KEY,
  account_type TEXT,
  join_date DATE,
  ftd_at TIMESTAMPTZ NOT NULL,
  amount NUMERIC(16, 2) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'api')),
  upload_id TEXT REFERENCES monthly_report_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_onboarding_ftd_ftd_at ON onboarding_ftd (ftd_at);

-- Rejection reasons (separate Metabase export, parser not built yet).
-- Keyed by onboarding Document ID or UID plus date and reason.
CREATE TABLE IF NOT EXISTS onboarding_rejection_reasons (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  uid TEXT,
  reason_date DATE NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'api')),
  upload_id TEXT REFERENCES monthly_report_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (document_id IS NOT NULL OR uid IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_rejection_reasons_key
  ON onboarding_rejection_reasons (COALESCE(document_id, ''), COALESCE(uid, ''), reason_date, reason);
CREATE INDEX IF NOT EXISTS idx_onboarding_rejection_reasons_date ON onboarding_rejection_reasons (reason_date);

COMMIT;
