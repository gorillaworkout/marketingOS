-- Rollback 070. Only touches the department row this migration inserts
-- (...0009, name Customer Service). A Customer Service row created by 069
-- (...0008, on a fresh database) is left alone. DPM (...0008) is never
-- touched. If users are assigned to the ...0009 row, the row is kept and
-- only cs-report is removed from it.
BEGIN;

UPDATE departments
SET permitted_features = array_remove(permitted_features, 'cs-report'),
    updated_at = CURRENT_TIMESTAMP
WHERE id = '00000000-0000-0000-0000-000000000009'
  AND name = 'Customer Service';

DELETE FROM departments
WHERE id = '00000000-0000-0000-0000-000000000009'
  AND name = 'Customer Service'
  AND NOT EXISTS (
    SELECT 1 FROM users WHERE users.department_id = departments.id
  );

DELETE FROM schema_migrations WHERE name = '070_cs_department.sql';

COMMIT;
