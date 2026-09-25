-- Let Accounts assign Internal Docs per department, and keep current
-- members on it. Idempotent: the CHECK is replaced, and the feature is
-- appended only when a department does not already have it.
-- Document ACL (company vs it-only) is unchanged.

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
    'internal-docs'
  ]::text[]
);

UPDATE departments
SET permitted_features = permitted_features || ARRAY['internal-docs']::text[],
    updated_at = CURRENT_TIMESTAMP
WHERE NOT (permitted_features @> ARRAY['internal-docs']::text[]);

COMMIT;
