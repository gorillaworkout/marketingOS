-- Settlement phase 2 group A: MT5 Deals History facts, keyed by Deal.
--
-- Chunks stage on a session. Commit upserts settlement_mt5_deal_facts and
-- rebuilds settlement_dh_daily from that table for the touched server dates.
-- A deal that is not in the new file is not deleted. Abort deletes staging only.
-- Name and comment are not columns. Phase 1 tables are not altered.
-- Idempotent: safe to run twice.
--
-- Disk: after loading the 5-day file, measure (read-only):
--   SELECT c.relname, pg_total_relation_size(c.oid) AS bytes
--   FROM pg_class c
--   WHERE c.relname IN ('settlement_mt5_deal_facts', 'settlement_dh_staging', 'settlement_dh_daily');
-- About 10 GB free on the shared root is a historical snapshot, not a budget.
-- Check free disk again at deploy. This migration does not delete facts.
--
-- ROLLBACK (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS settlement_dh_daily;
--   DROP TABLE IF EXISTS settlement_dh_coverage;
--   DROP TABLE IF EXISTS settlement_dh_staging;
--   DROP TABLE IF EXISTS settlement_dh_chunks;
--   DROP TABLE IF EXISTS settlement_mt5_deal_facts;
--   DROP TABLE IF EXISTS settlement_dh_sessions;
--   DELETE FROM schema_migrations WHERE name = '047_settlement_deals_history.sql';
--   COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS settlement_dh_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'committed', 'aborted')),
  title_filter TEXT,
  range_from DATE,
  range_to DATE,
  footer_commission NUMERIC(18,2),
  footer_swap NUMERIC(18,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS settlement_dh_chunks (
  session_id TEXT NOT NULL REFERENCES settlement_dh_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  deal_count INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS settlement_dh_staging (
  session_id TEXT NOT NULL REFERENCES settlement_dh_sessions(id) ON DELETE CASCADE,
  deal TEXT NOT NULL,
  seq INTEGER NOT NULL,
  login TEXT NOT NULL,
  server_time TIMESTAMP NOT NULL,
  entry TEXT NOT NULL,
  volume NUMERIC(18,2) NOT NULL,
  commission NUMERIC(18,2) NOT NULL,
  fee NUMERIC(18,2) NOT NULL,
  swap NUMERIC(18,2) NOT NULL,
  profit NUMERIC(18,2) NOT NULL,
  currency TEXT,
  rate INTEGER,
  PRIMARY KEY (session_id, deal)
);
CREATE INDEX IF NOT EXISTS idx_settlement_dh_staging_seq ON settlement_dh_staging (session_id, seq);

CREATE TABLE IF NOT EXISTS settlement_mt5_deal_facts (
  deal TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  server_time TIMESTAMP NOT NULL,
  entry TEXT NOT NULL,
  volume NUMERIC(18,2) NOT NULL,
  commission NUMERIC(18,2) NOT NULL,
  fee NUMERIC(18,2) NOT NULL,
  swap NUMERIC(18,2) NOT NULL,
  profit NUMERIC(18,2) NOT NULL,
  currency TEXT,
  rate INTEGER,
  session_id TEXT REFERENCES settlement_dh_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_settlement_mt5_deal_facts_time ON settlement_mt5_deal_facts (server_time);
CREATE INDEX IF NOT EXISTS idx_settlement_mt5_deal_facts_login ON settlement_mt5_deal_facts (login);

CREATE TABLE IF NOT EXISTS settlement_dh_coverage (
  server_date DATE PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('full', 'partial')),
  session_id TEXT REFERENCES settlement_dh_sessions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settlement_dh_daily (
  server_date DATE NOT NULL,
  rate INTEGER NOT NULL,
  commission_in NUMERIC(18,2) NOT NULL,
  swap_amount NUMERIC(18,2) NOT NULL,
  deals INTEGER NOT NULL,
  PRIMARY KEY (server_date, rate)
);

COMMIT;
