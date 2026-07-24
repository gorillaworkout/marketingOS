-- Standard department catalogue. This preserves every existing member and assignment.
UPDATE departments
SET name = 'Marketing', updated_at = CURRENT_TIMESTAMP
WHERE name = 'General'
  AND NOT EXISTS (SELECT 1 FROM departments WHERE name = 'Marketing');

INSERT INTO departments (id, name, permitted_features)
VALUES
  ('00000000-0000-0000-0000-000000000002', 'Settlement', ARRAY[]::TEXT[]),
  ('00000000-0000-0000-0000-000000000003', 'Finance', ARRAY[]::TEXT[])
ON CONFLICT (name) DO NOTHING;
