-- Onboarding events: identity = Document ID + event time + Steps (natural key).
--
-- Why: one Document ID can appear in several monthly exports with different
-- events (e.g. auto_kyc Pending at the end of September, the manual_kyc
-- decision in October). With PRIMARY KEY (document_id) the last file loaded
-- overwrote the earlier event, so month totals depended on load order.
-- Collision analysis of the Jun/Jul/Sep/Oct 2026 exports: (document_id,
-- event_at, step) has 0 collisions inside every file, while identical rows in
-- two files (the two Sep copies) collide on all 23,494 rows. Step Status is
-- not in the key, so a re-export of the same event with a changed status is
-- treated as the same event (skipped), never as a second registration.
--
-- Imports now INSERT ... ON CONFLICT (document_id, event_at, step) DO NOTHING:
-- re-importing a file inserts 0 rows and reports every row as a duplicate.
--
-- Non-destructive: no row is deleted or changed. Existing rows are unique by
-- document_id, so they are unique by any superset key; the new primary key is
-- built from columns that are already NOT NULL (no backfill needed). The swap
-- runs in one transaction, so there is never a moment without a unique key.
-- Idempotent: running it twice is a no-op.
--
-- Also adds monthly_report_uploads.rows_duplicate (rows skipped because the
-- event was already stored or repeated inside the file).
--
-- ROLLBACK (manual; only valid while every Document ID still has one row,
-- i.e. before multi-month imports, otherwise restore the pg_dump backup or first
-- delete the rows of the later uploads by upload_id):
--   BEGIN;
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM onboarding_events GROUP BY document_id HAVING COUNT(*) > 1) THEN
--       RAISE EXCEPTION 'onboarding_events has Document IDs with several events; cannot restore PRIMARY KEY (document_id)';
--     END IF;
--   END $$;
--   ALTER TABLE onboarding_events DROP CONSTRAINT onboarding_events_pkey;
--   ALTER TABLE onboarding_events ADD CONSTRAINT onboarding_events_pkey PRIMARY KEY (document_id);
--   ALTER TABLE monthly_report_uploads DROP COLUMN IF EXISTS rows_duplicate;
--   DELETE FROM schema_migrations WHERE name = '043_onboarding_event_natural_key.sql';
--   COMMIT;
BEGIN;

ALTER TABLE monthly_report_uploads ADD COLUMN IF NOT EXISTS rows_duplicate INTEGER NOT NULL DEFAULT 0;

DO $$
DECLARE
  pk_name TEXT;
  pk_columns TEXT[];
BEGIN
  SELECT c.conname, ARRAY(
           SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
           ORDER BY k.ord)
    INTO pk_name, pk_columns
    FROM pg_constraint c
   WHERE c.conrelid = 'onboarding_events'::regclass AND c.contype = 'p';

  IF pk_columns = ARRAY['document_id', 'event_at', 'step'] THEN
    RETURN; -- already migrated
  END IF;
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE onboarding_events DROP CONSTRAINT %I', pk_name);
  END IF;
  ALTER TABLE onboarding_events ADD CONSTRAINT onboarding_events_pkey PRIMARY KEY (document_id, event_at, step);
END $$;

COMMIT;
