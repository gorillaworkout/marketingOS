-- Settlement Report phase 1: own feature key, Settlement department grant,
-- personal access, CRM deposits / withdrawals, MT5 Deposit & Withdrawal deals,
-- Dealing FTD list (Initial Margin) and office holidays.
--
-- Why: replaces the manual Settlement Excel work (Daily Reconciliation CRM vs MT5,
-- Processing Time, Withdrawal %, Margin In-Out, Swap CRM-S/CRM-SR). Uploaded on
-- Settlement Report (its own menu) via POST /api/settlement-report/uploads.
--
-- Access: feature key `settlement-report`. The existing Settlement department
-- (003) gets it by default. The settlement_report_access table was created for
-- personal grants; the app no longer uses it (access is department-only).
-- Onboarding's monthly-report feature and monthly_report_access are not changed.
--
-- Keys: CRM Reference per table (deposit and withdrawal References are separate sequences),
-- MT5 Deal, FTD Login. Re-uploading the same export is a no-op (upsert with IS DISTINCT FROM).
-- CRM times are WIB; MT5 server times (EET/EEST) are kept in server_time and converted to occurred_at / ftd_at.
--
-- Non-destructive: creates tables, widens monthly_report_uploads.kind, and appends one feature.
-- Onboarding tables are not touched. Idempotent: safe to run twice.
--
-- ROLLBACK (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS settlement_mt5_deals;
--   DROP TABLE IF EXISTS settlement_crm_withdrawals;
--   DROP TABLE IF EXISTS settlement_crm_deposits;
--   DROP TABLE IF EXISTS settlement_ftd;
--   DROP TABLE IF EXISTS settlement_holidays;
--   DROP TABLE IF EXISTS settlement_report_access;
--   DELETE FROM monthly_report_uploads WHERE kind LIKE 'settlement_%';
--   ALTER TABLE monthly_report_uploads DROP CONSTRAINT IF EXISTS monthly_report_uploads_kind_check;
--   ALTER TABLE monthly_report_uploads ADD CONSTRAINT monthly_report_uploads_kind_check
--     CHECK (kind IN ('onboarding', 'ftd', 'rejection_reasons', 'onboarding_summary', 'user_approved'));
--   UPDATE departments
--      SET permitted_features = array_remove(permitted_features, 'settlement-report'),
--          updated_at = CURRENT_TIMESTAMP
--    WHERE 'settlement-report' = ANY(permitted_features);
--   ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_permitted_features_valid;
--   ALTER TABLE departments ADD CONSTRAINT departments_permitted_features_valid CHECK (
--     permitted_features <@ ARRAY[
--       'social-post', 'video-script', 'event-plan', 'article-market-news', 'market-research',
--       'ai-research', 'internal-docs', 'seo', 'monthly-report'
--     ]::text[]
--   );
--   DELETE FROM schema_migrations WHERE name = '046_settlement_phase1.sql';
--   COMMIT;

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
    'monthly-report',
    'settlement-report'
  ]::text[]
);

-- Settlement already exists from 003 (empty features). Create it only if a fresh
-- database never ran that seed, then grant settlement-report by default.
INSERT INTO departments (id, name, permitted_features)
SELECT '00000000-0000-0000-0000-000000000002', 'Settlement', ARRAY['settlement-report']::TEXT[]
WHERE NOT EXISTS (
  SELECT 1 FROM departments
  WHERE name = 'Settlement' OR id = '00000000-0000-0000-0000-000000000002'
);

UPDATE departments
SET permitted_features = permitted_features || ARRAY['settlement-report']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'Settlement'
  AND NOT (permitted_features @> ARRAY['settlement-report']::TEXT[]);

-- Table retained after the Access tab was removed. Access is now department-only
-- (Accounts → Departments). No destructive drop; this table is unused by the app.
CREATE TABLE IF NOT EXISTS settlement_report_access (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  can_upload BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE monthly_report_uploads DROP CONSTRAINT IF EXISTS monthly_report_uploads_kind_check;
ALTER TABLE monthly_report_uploads ADD CONSTRAINT monthly_report_uploads_kind_check
  CHECK (kind IN ('onboarding', 'ftd', 'rejection_reasons', 'onboarding_summary', 'user_approved',
                  'settlement_crm_deposit', 'settlement_crm_withdrawal', 'settlement_mt5_dw', 'settlement_ftd'));

CREATE TABLE IF NOT EXISTS settlement_crm_deposits (
  reference TEXT PRIMARY KEY,
  ticket TEXT,
  account_no TEXT NOT NULL,
  uid TEXT,
  funding_method TEXT,
  requested_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  amount_usd NUMERIC(18,5),
  transfer_amount NUMERIC(20,5),
  transfer_currency TEXT,
  rate INTEGER,
  channel TEXT,
  payment_method TEXT,
  gateway_reference TEXT,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'api')),
  upload_id TEXT REFERENCES monthly_report_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_settlement_crm_deposits_requested ON settlement_crm_deposits (requested_at);
CREATE INDEX IF NOT EXISTS idx_settlement_crm_deposits_completed ON settlement_crm_deposits (completed_at);
CREATE INDEX IF NOT EXISTS idx_settlement_crm_deposits_account ON settlement_crm_deposits (account_no);

CREATE TABLE IF NOT EXISTS settlement_crm_withdrawals (
  reference TEXT PRIMARY KEY,
  ticket TEXT,
  account_no TEXT NOT NULL,
  uid TEXT,
  funding_method TEXT,
  requested_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  amount_usd NUMERIC(18,5),
  transfer_amount NUMERIC(20,5),
  transfer_currency TEXT,
  rate INTEGER,
  channel TEXT,
  payment_method TEXT,
  gateway_reference TEXT,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'api')),
  upload_id TEXT REFERENCES monthly_report_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_settlement_crm_withdrawals_requested ON settlement_crm_withdrawals (requested_at);
CREATE INDEX IF NOT EXISTS idx_settlement_crm_withdrawals_completed ON settlement_crm_withdrawals (completed_at);
CREATE INDEX IF NOT EXISTS idx_settlement_crm_withdrawals_account ON settlement_crm_withdrawals (account_no);

CREATE TABLE IF NOT EXISTS settlement_mt5_deals (
  deal TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  name TEXT,
  server_time TIMESTAMP NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  comment TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('D', 'W', 'WC', 'S', 'SR', 'TI', 'TO', 'AD', 'OTHER')),
  crm_reference TEXT,
  swap_date DATE,
  amount_usd NUMERIC(18,2) NOT NULL,
  currency TEXT,
  rate INTEGER,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'api')),
  upload_id TEXT REFERENCES monthly_report_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_settlement_mt5_deals_occurred ON settlement_mt5_deals (occurred_at);
CREATE INDEX IF NOT EXISTS idx_settlement_mt5_deals_kind_occurred ON settlement_mt5_deals (kind, occurred_at);
CREATE INDEX IF NOT EXISTS idx_settlement_mt5_deals_reference ON settlement_mt5_deals (crm_reference);
CREATE INDEX IF NOT EXISTS idx_settlement_mt5_deals_login ON settlement_mt5_deals (login);

CREATE TABLE IF NOT EXISTS settlement_ftd (
  login TEXT PRIMARY KEY,
  account_type TEXT,
  server_time TIMESTAMP NOT NULL,
  ftd_at TIMESTAMPTZ NOT NULL,
  balance_usd NUMERIC(18,2) NOT NULL CHECK (balance_usd >= 0),
  rate INTEGER,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'api')),
  upload_id TEXT REFERENCES monthly_report_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_settlement_ftd_server_time ON settlement_ftd (server_time);

CREATE TABLE IF NOT EXISTS settlement_holidays (
  holiday_date DATE PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO settlement_holidays (holiday_date, label) VALUES
  ('2026-03-19', 'Hari Suci Nyepi'),
  ('2026-04-03', 'Jumat Agung'),
  ('2026-05-01', 'Hari Buruh'),
  ('2026-05-27', 'Idul Adha'),
  ('2026-06-01', 'Hari Lahir Pancasila'),
  ('2026-07-06', 'Libur kantor'),
  ('2026-08-17', 'HUT RI'),
  ('2026-08-25', 'Maulid Nabi'),
  ('2026-12-25', 'Hari Natal')
ON CONFLICT (holiday_date) DO NOTHING;

COMMIT;
