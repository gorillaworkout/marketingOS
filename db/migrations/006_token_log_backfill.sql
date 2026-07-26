-- 006_token_log_backfill.sql
-- Backfill department_id and task_type for existing logs

UPDATE token_logs
SET department_id = (SELECT department_id FROM users WHERE users.id = token_logs.user_id)
WHERE department_id IS NULL;

UPDATE token_logs
SET task_type = (SELECT type FROM tasks WHERE tasks.id = token_logs.task_id)
WHERE task_id IS NOT NULL AND task_type = '';
