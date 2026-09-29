-- Short card blurb for FAQ & Guides. Filled when a document is indexed.
-- Existing indexed guides get a plain-text prefix so cards are not blank
-- until the next reindex. Re-running this file only fills rows that are still empty.

BEGIN;

ALTER TABLE internal_documents
  ADD COLUMN IF NOT EXISTS card_summary TEXT NOT NULL DEFAULT '';

UPDATE internal_documents
SET card_summary = left(
  btrim(regexp_replace(regexp_replace(extracted_text, '#+', '', 'g'), '[[:space:]]+', ' ', 'g')),
  200
)
WHERE card_summary = ''
  AND status = 'indexed'
  AND btrim(extracted_text) <> '';

COMMIT;
