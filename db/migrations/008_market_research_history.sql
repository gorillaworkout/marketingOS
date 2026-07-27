-- Add Market Research to task history without modifying existing rows.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_type_check
  CHECK(type IN ('social-post', 'video-script', 'event-plan', 'article-market-news', 'market-research'));
