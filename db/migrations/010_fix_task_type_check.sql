-- Add 'ai-research' to the allowed task_type CHECK constraint.
-- Migration 009 listed every generation feature EXCEPT ai-research, so saving
-- an AI Research model preference failed with PostgreSQL error 23514.
-- This only replaces the constraint definition; no rows are touched.

ALTER TABLE task_model_preferences
  DROP CONSTRAINT IF EXISTS task_model_preferences_task_type_check;

ALTER TABLE task_model_preferences
  ADD CONSTRAINT task_model_preferences_task_type_check
  CHECK (task_type IN (
    'caption',
    'image-prompt',
    'social-post',
    'video-script',
    'event-plan',
    'article-market-news',
    'market-research',
    'ai-research'
  ));
