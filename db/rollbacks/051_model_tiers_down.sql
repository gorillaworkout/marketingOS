-- Restore model settings from the 051 snapshots. Does not drop the snapshot tables.
BEGIN;

DELETE FROM feature_model_assignments;
INSERT INTO feature_model_assignments SELECT * FROM feature_model_assignments_legacy;

DELETE FROM task_model_preferences;
INSERT INTO task_model_preferences SELECT * FROM task_model_preferences_legacy;

DELETE FROM llm_model_mappings;
INSERT INTO llm_model_mappings SELECT * FROM llm_model_mappings_legacy;

DELETE FROM image_model_assignments;
INSERT INTO image_model_assignments SELECT * FROM image_model_assignments_legacy;

DROP TABLE IF EXISTS llm_tier_config;

ALTER TABLE llm_provider_settings DROP COLUMN IF EXISTS use_paid_openrouter;

DELETE FROM schema_migrations WHERE name = '051_model_tiers.sql';

COMMIT;
