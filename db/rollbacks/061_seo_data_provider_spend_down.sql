-- Undo 061. The spend history is lost: export it first if you need it, e.g.
--   \copy seo_data_provider_spend TO 'treg-spend.csv' CSV HEADER
-- Keyword gaps that ran on treg are relabelled 'free' so the 056 check can return;
-- their stored results stay readable.
BEGIN;

UPDATE seo_keyword_gaps SET provider = 'free' WHERE provider = 'treg';
ALTER TABLE seo_keyword_gaps DROP CONSTRAINT IF EXISTS seo_keyword_gaps_provider_check;
ALTER TABLE seo_keyword_gaps ADD CONSTRAINT seo_keyword_gaps_provider_check
  CHECK (provider IN ('free', 'semrush', 'dataforseo'));

DROP TABLE IF EXISTS seo_data_provider_spend;

DELETE FROM schema_migrations WHERE name = '061_seo_data_provider_spend.sql';

COMMIT;
