CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT departments_permitted_features_valid CHECK (permitted_features <@ ARRAY['social-post', 'video-script', 'event-plan']::TEXT[])
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id TEXT REFERENCES departments(id);

INSERT INTO departments (id, name, permitted_features)
VALUES ('00000000-0000-0000-0000-000000000001', 'General', ARRAY['social-post', 'video-script', 'event-plan']::TEXT[])
ON CONFLICT (name) DO NOTHING;

UPDATE users
SET department_id = (SELECT id FROM departments WHERE name = 'General')
WHERE role <> 'admin' AND department_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id);
