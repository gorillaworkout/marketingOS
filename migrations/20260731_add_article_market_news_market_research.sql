-- Migration: Add article-market-news and market-research to departments permitted_features constraint
-- Date: 2026-07-31
-- Safe: drops old constraint, adds new one with 5 features (backward compatible, existing data valid)

BEGIN;

-- Drop old constraint (3 features)
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_permitted_features_valid;

-- Add new constraint (5 features)
ALTER TABLE departments ADD CONSTRAINT departments_permitted_features_valid 
  CHECK (permitted_features <@ ARRAY['social-post', 'video-script', 'event-plan', 'article-market-news', 'market-research']::text[]);

COMMIT;
