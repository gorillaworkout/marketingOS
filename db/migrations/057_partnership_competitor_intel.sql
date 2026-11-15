-- Partnership module, PR 1: Competitor Intelligence.
-- Adds the `partnership` Accounts feature, a Partnership department, and the
-- competitor / evidence / report tables. Idempotent. No secrets. Screenshots
-- stay in private storage (data/partnership-evidence), not in this script.
--
-- Seeded websites were checked on 2026-11-15 to resolve to each broker's
-- official site. Elve and every Instagram handle are blank on purpose.
--
-- Rollback script: db/rollbacks/057_partnership_competitor_intel_down.sql

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
    'partnership'
  ]::text[]
);

-- Partnership department gets the feature. Admins can grant `partnership` to
-- any other department in Accounts. No user is moved.
INSERT INTO departments (id, name, permitted_features)
SELECT '00000000-0000-0000-0000-000000000006', 'Partnership', ARRAY['partnership']::TEXT[]
WHERE NOT EXISTS (
  SELECT 1 FROM departments
  WHERE name = 'Partnership' OR id = '00000000-0000-0000-0000-000000000006'
);

UPDATE departments
SET permitted_features = permitted_features || ARRAY['partnership']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'Partnership'
  AND NOT (permitted_features @> ARRAY['partnership']::TEXT[]);

CREATE TABLE IF NOT EXISTS partnership_competitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('local', 'international')),
  website TEXT,
  instagram_handle TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnership_competitors_name ON partnership_competitors (LOWER(name));

CREATE TABLE IF NOT EXISTS partnership_evidence (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES partnership_competitors(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'text', 'screenshot')),
  source_url TEXT,
  pasted_text TEXT,
  screenshot_key TEXT,
  extracted_text TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'none' CHECK (extraction_status IN ('none', 'done', 'failed')),
  observed_on DATE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partnership_evidence_competitor ON partnership_evidence (competitor_id, created_at DESC);

-- `kind` leaves room for Global Trends reports in a later PR.
CREATE TABLE IF NOT EXISTS partnership_reports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'competitor-activity' CHECK (kind IN ('competitor-activity')),
  competitor_id TEXT REFERENCES partnership_competitors(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  message TEXT NOT NULL DEFAULT '',
  window_start DATE,
  window_end DATE,
  result JSONB,
  model TEXT,
  error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_partnership_reports_competitor ON partnership_reports (competitor_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnership_reports_one_running
  ON partnership_reports (kind, competitor_id) WHERE status IN ('queued', 'running');

INSERT INTO partnership_competitors (id, name, region, website, notes, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000701', 'MIFX', 'local', 'https://mifx.com/', NULL, 10),
  ('00000000-0000-0000-0000-000000000702', 'Finex', 'local', 'https://www.finex.co.id/', NULL, 20),
  ('00000000-0000-0000-0000-000000000703', 'Valbury', 'local', 'https://valbury.co.id/', NULL, 30),
  ('00000000-0000-0000-0000-000000000704', 'Forex IMF', 'local', 'https://www.foreximf.com/', 'PT International Mitra Futures rebranded as PT QuickPro Berjangka Indonesia (Feb 2026). Bappebti lists www.quickpro.co.id.', 40),
  ('00000000-0000-0000-0000-000000000705', 'XTB', 'local', 'https://www.xtb.com/id', 'Region set to Local as listed by the Partnership team (XTB Indonesia site).', 50),
  ('00000000-0000-0000-0000-000000000706', 'Valetax', 'international', 'https://valetax.com/', NULL, 60),
  ('00000000-0000-0000-0000-000000000707', 'Exness', 'international', 'https://www.exness.com/', NULL, 70),
  ('00000000-0000-0000-0000-000000000708', 'Elve', 'international', NULL, 'Website pending: the Partnership team will send the official link.', 80)
ON CONFLICT DO NOTHING;

COMMIT;
