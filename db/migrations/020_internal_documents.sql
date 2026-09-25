-- Internal Docs corpus. Kept separate from the marketing knowledge graph.
-- Idempotent: IF NOT EXISTS, and the IT department insert is skipped when the
-- name or seed id already exists. Existing rows are left in place.
--
-- ACL: access_level is 'company' (every employee) or 'it-only'.
-- Admins and members of the department named IT may read IT-only documents
-- and manage the corpus. Other members read Company documents only.

CREATE TABLE IF NOT EXISTS internal_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_ext TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL UNIQUE,
  access_level TEXT NOT NULL CHECK (access_level IN ('company', 'it-only')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexed', 'failed')),
  error_message TEXT,
  extracted_text TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS internal_document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES internal_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_internal_documents_access_created
  ON internal_documents (access_level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_document_chunks_document
  ON internal_document_chunks (document_id, chunk_index);

INSERT INTO departments (id, name, permitted_features)
SELECT
  '00000000-0000-0000-0000-000000000004',
  'IT',
  ARRAY[]::TEXT[]
WHERE NOT EXISTS (
  SELECT 1 FROM departments
  WHERE name = 'IT' OR id = '00000000-0000-0000-0000-000000000004'
);
