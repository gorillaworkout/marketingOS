-- Customer Service division: CS Report.
-- Adds the `cs-report` Accounts feature, a Customer Service department that has
-- it, and the CS Report tables: agents (users or name-only historical agents),
-- one daily entry per agent per date, complaint cases, imported weekly notes,
-- and the bulk upload history. Access comes only from Accounts -> Departments
-- (admins always see it). View = daily input = bulk upload.
--
-- Additive and idempotent: CHECK is replaced, tables and indexes use
-- IF NOT EXISTS, and the department row is skipped when it already exists.
-- No existing rows are changed or removed.
-- Rollback: db/rollbacks/069_cs_report_down.sql

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
    'settlement-report',
    'partnership',
    'google-ads',
    'cs-report'
  ]::text[]
);

-- Customer Service department gets CS Report. Admins assign the CS agents to it
-- (or grant `cs-report` to another department) in Accounts. No user is moved.
INSERT INTO departments (id, name, permitted_features)
SELECT '00000000-0000-0000-0000-000000000008', 'Customer Service', ARRAY['cs-report']::TEXT[]
WHERE NOT EXISTS (
  SELECT 1 FROM departments
  WHERE name = 'Customer Service' OR id = '00000000-0000-0000-0000-000000000008'
);

UPDATE departments
SET permitted_features = permitted_features || ARRAY['cs-report']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'Customer Service'
  AND NOT (permitted_features @> ARRAY['cs-report']::TEXT[]);

-- One row per CS agent. user_id links a MarketingOS account (one agent per
-- user). Historical Excel names without an account are stored as name-only
-- agents (user_id NULL). aliases holds the normalised Excel names (lower case,
-- single spaces) that map to this agent on bulk upload.
CREATE TABLE IF NOT EXISTS cs_agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  aliases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cs_agents_aliases ON cs_agents USING GIN (aliases);

-- Bulk upload history (one row per committed upload).
CREATE TABLE IF NOT EXISTS cs_report_uploads (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name TEXT,
  sheets INTEGER NOT NULL DEFAULT 0,
  entries_total INTEGER NOT NULL DEFAULT 0,
  entries_inserted INTEGER NOT NULL DEFAULT 0,
  entries_skipped INTEGER NOT NULL DEFAULT 0,
  complaints_total INTEGER NOT NULL DEFAULT 0,
  complaints_inserted INTEGER NOT NULL DEFAULT 0,
  complaints_skipped INTEGER NOT NULL DEFAULT 0,
  notes_total INTEGER NOT NULL DEFAULT 0,
  notes_inserted INTEGER NOT NULL DEFAULT 0,
  notes_skipped INTEGER NOT NULL DEFAULT 0,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_from DATE,
  data_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cs_report_uploads_created ON cs_report_uploads (created_at DESC);

-- One row per agent per date (the Weekly Work List row). Counts are NULL when
-- the cell or field was left empty (summed as 0). follow_up_minutes is the N in
-- "Conversations not followed up within N minutes" (2, 4 or 5 in the old files).
CREATE TABLE IF NOT EXISTS cs_daily_entries (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES cs_agents(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'sick', 'annual_leave')),
  im_reception INTEGER CHECK (im_reception >= 0),
  email_reception INTEGER CHECK (email_reception >= 0),
  wa_business_reception INTEGER CHECK (wa_business_reception >= 0),
  social_media_reception INTEGER CHECK (social_media_reception >= 0),
  call_reception INTEGER CHECK (call_reception >= 0),
  account_problem INTEGER CHECK (account_problem >= 0),
  deposit_withdraw INTEGER CHECK (deposit_withdraw >= 0),
  orders_transactions INTEGER CHECK (orders_transactions >= 0),
  app_mt5 INTEGER CHECK (app_mt5 >= 0),
  reward_program INTEGER CHECK (reward_program >= 0),
  complaint INTEGER CHECK (complaint >= 0),
  unsolved_issues INTEGER CHECK (unsolved_issues >= 0),
  unsolved_uids TEXT NOT NULL DEFAULT '',
  unsolved_completed INTEGER CHECK (unsolved_completed >= 0),
  not_followed_up INTEGER CHECK (not_followed_up >= 0),
  follow_up_minutes INTEGER NOT NULL DEFAULT 4 CHECK (follow_up_minutes BETWEEN 1 AND 240),
  frequent_question TEXT NOT NULL DEFAULT '',
  difficult_question TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'upload')),
  upload_id TEXT REFERENCES cs_report_uploads(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agent_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_cs_daily_entries_date ON cs_daily_entries (entry_date);

-- One row per complaint case. agent_id is NULL for imported cases (the Excel
-- complaint table has no agent column). sla_met is NULL when unknown.
-- dedupe_key = sha1(date | uid | account | normalised description), computed in
-- the app, so the same case is never stored twice.
CREATE TABLE IF NOT EXISTS cs_complaints (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES cs_agents(id) ON DELETE SET NULL,
  complaint_date DATE NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  uid TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cause TEXT NOT NULL DEFAULT '',
  resolution TEXT NOT NULL DEFAULT '',
  completion_date DATE,
  status TEXT NOT NULL DEFAULT '',
  sla_met BOOLEAN,
  urgency TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'upload')),
  upload_id TEXT REFERENCES cs_report_uploads(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cs_complaints_date ON cs_complaints (complaint_date);

-- Imported "Notes:" block, one row per week and channel.
CREATE TABLE IF NOT EXISTS cs_weekly_notes (
  id TEXT PRIMARY KEY,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  channel TEXT NOT NULL,
  frequent_question TEXT NOT NULL DEFAULT '',
  difficult_question TEXT NOT NULL DEFAULT '',
  upload_id TEXT REFERENCES cs_report_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (week_start, channel)
);

COMMIT;
