CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', last_active TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('social-post', 'video-script', 'event-plan')),
  title TEXT NOT NULL, brief TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'review', 'approved', 'published', 'completed', 'archived')),
  output_data TEXT, rating INTEGER DEFAULT 0, feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS token_logs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT REFERENCES tasks(id), model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('image', 'document', 'script', 'proposal')), file_path TEXT NOT NULL, original_name TEXT, mime_type TEXT, file_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS brand_guidelines (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), brand_name TEXT NOT NULL, tone_of_voice TEXT, target_market TEXT, key_messages TEXT,
  do_list TEXT DEFAULT '[]', dont_list TEXT DEFAULT '[]', examples TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS content_calendar (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT REFERENCES tasks(id), platform TEXT, scheduled_date TEXT NOT NULL, scheduled_time TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'published', 'cancelled')), notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('social-post', 'video-script', 'event-plan')),
  platform TEXT, brief_template TEXT, output_template TEXT, tags TEXT, use_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_preferences (id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), preferred_model TEXT NOT NULL DEFAULT 'deepseek/deepseek-v4-flash', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS task_model_preferences (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), task_type TEXT NOT NULL CHECK(task_type IN ('caption', 'image-prompt', 'video-script', 'event-plan')), model TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'openrouter', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, task_type));
CREATE TABLE IF NOT EXISTS knowledge_entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), task_type TEXT NOT NULL, brief TEXT NOT NULL, selected_output TEXT NOT NULL, rejected_outputs TEXT, style_cluster TEXT, platform TEXT, audience TEXT, embedding TEXT, quality_score DOUBLE PRECISION NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS knowledge_edges (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES knowledge_entries(id), target_id TEXT NOT NULL REFERENCES knowledge_entries(id), relationship TEXT NOT NULL, weight DOUBLE PRECISION NOT NULL DEFAULT 1.0, metadata TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS style_clusters (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, example_ids TEXT, centroid_embedding TEXT, entry_count INTEGER NOT NULL DEFAULT 0, last_analyzed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS user_style_preferences (id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), preferred_cluster TEXT, style_summary TEXT, tone_preferences TEXT, hook_preferences TEXT, platform_preferences TEXT, total_selections INTEGER NOT NULL DEFAULT 0, last_analyzed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS global_style_profile (id TEXT PRIMARY KEY, task_type TEXT UNIQUE NOT NULL, team_summary TEXT, top_examples TEXT, cluster_distribution TEXT, last_analyzed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS kanban_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready', 'running', 'blocked', 'completed', 'archived')), priority INTEGER NOT NULL DEFAULT 2, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, result TEXT);
CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_token_logs_user_created ON token_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_user ON knowledge_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_source ON knowledge_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_target ON knowledge_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_user ON kanban_tasks(user_id, created_at DESC);
