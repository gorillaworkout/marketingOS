# AI Research: CSV output and HTML send-flow fixes

Builds on: PR #110 (Convert menu for uploaded HTML)

## CSV

- **Convert → CSV (.csv)**:
  - **One table:** a single `.csv`.
  - **Several tables:** a `.zip` with one CSV per table. Entry names come from
    the sheet names, made ASCII-safe and unique.
  - **Choosing a table:** with more than one table, the menu opens a sub-list:
    "All tables (.zip)" or one table by name. The choice is sent as
    `tableIndex`, and the file is named `<page>-<table>.csv`.
  - **No tables:** a two-column `Type,Text` CSV of the headings, paragraphs,
    and list items.
- **Extract to Excel/CSV…:** the extraction form has an Excel / CSV selector
  (`output: 'csv'`).
- **Format** (`src/lib/ai-research-csv.ts`):
  - Encoding: UTF-8 with a BOM, so Excel detects UTF-8, and CRLF line endings.
  - Quoting follows RFC 4180: a field with a comma, quote, line break, or a
    leading/trailing space is quoted, and quotes are doubled.
  - Formula injection: a value starting with `=`, `+`, `@`, a tab, or a `-`
    that is not a number gets a leading apostrophe.
- **Storage:** `ai_research_exports` with kind `convert-csv` (MIME `text/csv`
  or `application/zip`) or `extract-csv`.
  - Migration **034** widens the kind check. `mime_type` has no constraint.
  - The cards show CSV or ZIP badges with Download and Copy link.

## Send-flow fixes

1. **"Preparing…" never ended when the same file was attached again.**
   - Cause: pending ids were `name-size-lastModified-position`, so removing a
     chip, or converting from it, and re-adding the same file gave the same
     id. The upload effect skips ids it has already started, so the new chip
     stayed in "Preparing…" with Convert and Excel disabled.
   - Fix: ids are now unique per add.
2. **No timeout on the upload.**
   - Cause: a stalled request left the chip in "Preparing…" with no way out.
   - Fix: the upload now aborts after 90 s, and the error shows a **Retry**
     button.
3. **Upload and send payload size.**
   - Cause: the upload sent the HTML as base64 JSON, about 33% larger. Then
     sending the message sent the whole file again as base64.
   - Probe: unauthenticated POSTs to production returned 401 up to 14 MB and
     a Cloudflare 502 at 15 MB, so something on the request path caps bodies
     near 14–15 MB.
   - Fix: the upload now posts the raw file (`?name=`). A message with a
     prepared HTML file sends only `{ mimeType, name, uploadId }`, and the
     server hydrates the text and tables from `ai_research_uploads`, scoped
     to the owner. A file that isn't prepared yet still goes inline as
     before.
4. **Proxy errors were unclear.**
   - Cause: a 413 or 502 HTML page showed as "Server error (502)".
   - Fix: these now show a hint about large attachments.
5. **Office-saved HTML was garbled.**
   - Cause: files saved with Excel/Word "Save as Web Page", or as UTF-16,
     were decoded as UTF-8.
   - Fix: `decodeHtmlBytes` honors a BOM, detects UTF-16 without a BOM, and
     uses UTF-8 when the bytes are valid UTF-8. Otherwise it uses
     `<meta charset>` or windows-1252, with a hand-written windows-1252 table
     because Node decodes windows-1252 as Latin-1.
6. **Raw uploads with a missing or wrong browser MIME type.** A file with an
   empty, `application/octet-stream`, or `text/plain` type is accepted when
   the name ends in `.html`/`.htm`.
7. **Composer hint.** The hint now lists HTML.
8. **Duplicate Knowledge Graph rows.** HTML files with an `uploadId` were
   saved to the Knowledge Graph twice: once at upload and again in the chat
   route. The chat route now skips them.

## Tests

`tests/ai-research-html-csv.test.ts` covers:

- CSV quoting and the BOM, read back with an RFC 4180 parser
- the single / zip / chosen-table / text-block outputs
- the convert card kinds and MIME types, and extract → CSV
- the decoders
- MIME acceptance for raw uploads
- send-by-reference hydration
- UI regressions (unique ids, timeout, raw upload, reference send)
- migration 034
