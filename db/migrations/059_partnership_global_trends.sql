-- Partnership module, PR 3: Global Industry Trends.
-- Additive and idempotent. No secrets.
--  * partnership_reports (from 057) is reused for the weekly digest: `kind`
--    now also allows 'global-trends' (competitor_id stays NULL).
--  * One global-trends digest can run at a time (partial unique index).
--  * partnership_trend_brands is the editable global brand watchlist.
--
-- Seeded URLs were checked on 2026-11-15 to load on each broker's official
-- domain. Newsroom URLs are only set where the page is a real press/news/blog
-- listing; otherwise they are blank on purpose (team can add them in the UI).
-- Plus500 and FxPro homepages answer automated requests with a Cloudflare 403,
-- so their newsroom crawl may be blocked; news search still covers them.
--
-- Rollback script: db/rollbacks/059_partnership_global_trends_down.sql

BEGIN;

ALTER TABLE partnership_reports DROP CONSTRAINT IF EXISTS partnership_reports_kind_check;
ALTER TABLE partnership_reports ADD CONSTRAINT partnership_reports_kind_check CHECK (kind IN ('competitor-activity', 'global-trends'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_partnership_reports_one_global_running
  ON partnership_reports (kind) WHERE status IN ('queued', 'running') AND competitor_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_partnership_reports_kind_created ON partnership_reports (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS partnership_trend_brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  newsroom_url TEXT,
  search_terms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnership_trend_brands_name ON partnership_trend_brands (LOWER(name));

INSERT INTO partnership_trend_brands (id, name, website, newsroom_url, search_terms, notes, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000801', 'Exness', 'https://www.exness.com/', NULL, ARRAY[]::TEXT[], 'No public newsroom listing found (/press serves a sign-up page).', 10),
  ('00000000-0000-0000-0000-000000000802', 'XTB', 'https://www.xtb.com/', 'https://www.xtb.com/en/company-news', ARRAY[]::TEXT[], NULL, 20),
  ('00000000-0000-0000-0000-000000000803', 'Valetax', 'https://valetax.com/', NULL, ARRAY[]::TEXT[], 'No public newsroom listing found.', 30),
  ('00000000-0000-0000-0000-000000000804', 'IG', 'https://www.ig.com/', 'https://www.iggroup.com/', ARRAY['IG Group']::TEXT[], 'Newsroom is the IG Group corporate site.', 40),
  ('00000000-0000-0000-0000-000000000805', 'IC Markets', 'https://www.ic.com/en/', 'https://www.ic.com/blog/', ARRAY[]::TEXT[], 'icmarkets.com now redirects to ic.com.', 50),
  ('00000000-0000-0000-0000-000000000806', 'Pepperstone', 'https://pepperstone.com/en', 'https://pepperstone.com/en/about-us/press', ARRAY[]::TEXT[], NULL, 60),
  ('00000000-0000-0000-0000-000000000807', 'eToro', 'https://www.etoro.com/', 'https://www.etoro.com/news-and-analysis/press-releases/', ARRAY[]::TEXT[], NULL, 70),
  ('00000000-0000-0000-0000-000000000808', 'Plus500', 'https://www.plus500.com/', 'https://investors.plus500.com/', ARRAY[]::TEXT[], 'Homepage blocks automated reads (Cloudflare); newsroom is the investor site.', 80),
  ('00000000-0000-0000-0000-000000000809', 'OANDA', 'https://www.oanda.com/', 'https://www.oanda.com/group/media-resource-centre/', ARRAY[]::TEXT[], NULL, 90),
  ('00000000-0000-0000-0000-000000000810', 'FxPro', 'https://www.fxpro.com/', NULL, ARRAY[]::TEXT[], 'Site blocks automated reads (Cloudflare); news search only.', 100),
  ('00000000-0000-0000-0000-000000000811', 'Deriv', 'https://deriv.com/', 'https://deriv.com/newsroom', ARRAY[]::TEXT[], NULL, 110),
  ('00000000-0000-0000-0000-000000000812', 'FBS', 'https://fbs.com/', 'https://fbs.com/news', ARRAY[]::TEXT[], 'Newsroom loads in a browser but answered the crawler with 403 in testing; news search still covers FBS.', 120),
  ('00000000-0000-0000-0000-000000000813', 'CMC Markets', 'https://www.cmcmarkets.com/', 'https://www.cmcmarkets.com/group', ARRAY[]::TEXT[], 'Newsroom is the CMC Markets Group site.', 130)
ON CONFLICT DO NOTHING;

COMMIT;
