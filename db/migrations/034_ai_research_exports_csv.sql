-- CSV output for AI Research HTML uploads: Convert -> CSV ('convert-csv';
-- a single .csv, or a .zip of one CSV per table stored with mime_type
-- application/zip) and Extract -> CSV ('extract-csv').
-- mime_type has no constraint, so text/csv and application/zip need no change.
-- Idempotent and forward-only.

BEGIN;

ALTER TABLE ai_research_exports
  DROP CONSTRAINT IF EXISTS ai_research_exports_kind_check;

ALTER TABLE ai_research_exports
  ADD CONSTRAINT ai_research_exports_kind_check
  CHECK (kind IN ('tables', 'extract', 'extract-csv', 'convert-xlsx', 'convert-pdf', 'convert-docx', 'convert-csv'));

COMMIT;
