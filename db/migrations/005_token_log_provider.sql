-- 005_token_log_provider.sql
-- Enrich token_logs with provider, account_source, department_id, task_type

ALTER TABLE token_logs ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'openrouter';
ALTER TABLE token_logs ADD COLUMN IF NOT EXISTS account_source TEXT NOT NULL DEFAULT 'office';
ALTER TABLE token_logs ADD COLUMN IF NOT EXISTS department_id TEXT REFERENCES departments(id);
ALTER TABLE token_logs ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_token_logs_provider ON token_logs(provider);
CREATE INDEX IF NOT EXISTS idx_token_logs_department ON token_logs(department_id);
CREATE INDEX IF NOT EXISTS idx_token_logs_created_at ON token_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_token_logs_user_provider ON token_logs(user_id, provider, created_at);
