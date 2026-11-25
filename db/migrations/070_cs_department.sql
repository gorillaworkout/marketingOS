-- Customer Service department (follow-up to 069).
-- 069 tried to insert Customer Service at 00000000-0000-0000-0000-000000000008,
-- but that id is already the DPM department on production, so the insert was
-- skipped and no Customer Service row was created. This migration inserts
-- Customer Service with a new unused id (...0009). DPM (...0008) is left
-- untouched.
--
-- Idempotent: if a department named Customer Service already exists (any id,
-- including ...0008 on a fresh database where 069 succeeded), only ensure it
-- has cs-report. No existing rows are renamed or removed.
-- The migration runner records applied files by name only (no checksum), so
-- 069 is left unchanged.
-- Rollback: db/rollbacks/070_cs_department_down.sql

BEGIN;

INSERT INTO departments (id, name, permitted_features)
SELECT '00000000-0000-0000-0000-000000000009', 'Customer Service', ARRAY['cs-report']::TEXT[]
WHERE NOT EXISTS (
  SELECT 1 FROM departments WHERE name = 'Customer Service'
);

UPDATE departments
SET permitted_features = permitted_features || ARRAY['cs-report']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'Customer Service'
  AND NOT (permitted_features @> ARRAY['cs-report']::TEXT[]);

COMMIT;
