-- Daily onboarding KPI summary (obd_kyc "Query result") and user_approved rows.
--
-- Why: from 2026-11-06 the classic monthly onboarding event export is retired.
-- Users upload two files every day: (a) the small daily KPI summary and
-- (b) the user_approved sheet (approver report). Dashboard funnel KPIs for a
-- WIB day that has a summary row come from that row; days without a summary
-- keep using onboarding_events (Jun–Oct already imported). user_approved never
-- feeds the funnel KPIs — only the Approver report.
--
-- Summary dedupe: one row per summary_date. Re-uploading identical numbers is
-- a no-op (rows_duplicate); different numbers replace the row (rows_updated).
-- user_approved: natural key record_id (fallback document_id|create_time|step);
-- INSERT ON CONFLICT DO NOTHING. Approver = 'Deposit Robot' is kept for rejection reasons but skipped from the Approver ranking. KYC rejection reasons come from Remark (mapped to the reject-reasons guide).
--
-- Non-destructive: creates tables and widens monthly_report_uploads.kind.
-- Idempotent: safe to run twice.
--
-- ROLLBACK (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS onboarding_user_approved;
--   DROP TABLE IF EXISTS onboarding_daily_summary;
--   ALTER TABLE monthly_report_uploads DROP CONSTRAINT IF EXISTS monthly_report_uploads_kind_check;
--   ALTER TABLE monthly_report_uploads ADD CONSTRAINT monthly_report_uploads_kind_check
--     CHECK (kind IN ('onboarding', 'ftd', 'rejection_reasons'));
--   DELETE FROM schema_migrations WHERE name = '045_onboarding_daily_summary_and_approvals.sql';
--   COMMIT;

BEGIN;

ALTER TABLE monthly_report_uploads DROP CONSTRAINT IF EXISTS monthly_report_uploads_kind_check;
ALTER TABLE monthly_report_uploads ADD CONSTRAINT monthly_report_uploads_kind_check
  CHECK (kind IN ('onboarding', 'ftd', 'rejection_reasons', 'onboarding_summary', 'user_approved'));

CREATE TABLE IF NOT EXISTS onboarding_daily_summary (
  summary_date DATE PRIMARY KEY,
  registrations INTEGER NOT NULL CHECK (registrations >= 0),
  total_real_account INTEGER NOT NULL CHECK (total_real_account >= 0),
  manual_kyc_approved INTEGER NOT NULL DEFAULT 0 CHECK (manual_kyc_approved >= 0),
  kyc_rejected INTEGER NOT NULL DEFAULT 0 CHECK (kyc_rejected >= 0),
  first_account INTEGER NOT NULL DEFAULT 0 CHECK (first_account >= 0),
  additional_account INTEGER NOT NULL DEFAULT 0 CHECK (additional_account >= 0),
  auto_kyc_approved INTEGER NOT NULL DEFAULT 0 CHECK (auto_kyc_approved >= 0),
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'api')),
  upload_id TEXT REFERENCES monthly_report_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_onboarding_daily_summary_upload ON onboarding_daily_summary (upload_id);

CREATE TABLE IF NOT EXISTS onboarding_user_approved (
  record_id TEXT PRIMARY KEY,
  document_id TEXT,
  create_time TIMESTAMPTZ NOT NULL,
  finished_time TIMESTAMPTZ,
  applicant_uid TEXT,
  approver_uid TEXT,
  approver TEXT,
  approval_method TEXT,
  step TEXT,
  step_status TEXT,
  approved_status TEXT,
  success_status TEXT,
  account TEXT,
  processing_time TEXT,
  remark TEXT,
  rejected_reason TEXT,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'api')),
  upload_id TEXT REFERENCES monthly_report_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_onboarding_user_approved_finished ON onboarding_user_approved (finished_time);
CREATE INDEX IF NOT EXISTS idx_onboarding_user_approved_create ON onboarding_user_approved (create_time);
CREATE INDEX IF NOT EXISTS idx_onboarding_user_approved_approver ON onboarding_user_approved (approver);

COMMIT;
