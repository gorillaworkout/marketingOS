# AI Research: convert uploaded HTML to Excel, PDF, and Word

Status: implemented on `feat/ai-research-html-convert`
Builds on: PR #109 (HTML upload, table detection, Excel export)

## Goal

Every HTML file uploaded to AI Research gets a compact **Convert** menu with
**Excel (.xlsx)**, **PDF**, and **Word (.docx)**. It works straight after
upload, with no need to ask a question or wait for an answer. The existing
**Export tables to Excel** and **Extract to Excel…** buttons are enabled at the
same time. Each result appears in the chat thread as an attachment message
with **Download** and **Copy link**, like the #109 XLSX card. The UI is
English only.

## Flow

1. **Upload right away.** When an `.html`/`.htm` file is added to the
   composer, the client POSTs `{ name, dataUrl }` to `/api/ai-research/uploads`.
   The server:
   - validates the file (HTML only, 10 MB)
   - sanitizes it with the #109 cheerio sanitizer
   - stores the sanitized HTML, readable text, detected tables, and title in
     `ai_research_uploads`
   - saves the readable text to the Knowledge Graph, using the same payload as
     #109 (fire-and-forget)
   - returns `{ uploadId, tableCount, title }`

   The pending chip shows "Preparing…" until it has an `uploadId`. **Raw HTML
   is never stored.**
2. **Convert or export from the chip.**
   - **Convert** POSTs `{ uploadId, format, conversationId?, projectId? }` to
     `/api/ai-research/convert`.
   - **Excel** POSTs to the existing `/api/ai-research/excel` with `uploadId`
     instead of `conversationId`.

   Both use `deliverToThread`:
   - **No conversation yet:** a new one is created, scoped to the active
     project when the user owns it. It holds an `Uploaded <file>` user message
     carrying the file (text, tables, `uploadId`) and then the assistant
     attachment message.
   - **Conversation already open:** the messages are appended. The
     `Uploaded <file>` message is only added if that `uploadId` isn't in the
     thread yet, so converting to a second format adds one message.

   The upload is linked to the conversation. The client switches to the new
   conversation (using `skipNextLoadRef`), appends the returned messages, and
   removes the chip, because the file is now in the thread.
3. **After sending.** When a message is sent with an HTML file, its `uploadId`
   travels with the file. It is kept by validation, hydration, storage, and
   the GET mapping, so Convert keeps working on sent messages and after a
   reload. Files sent before this change have no `uploadId`: Convert is
   disabled with "Re-upload this file to convert it", and Excel uses the
   legacy conversation path.

The "Uploaded <file>" message is a normal stored user message, so later
questions in the thread have the page text in context.

## Converters (`src/lib/ai-research-html-convert.ts`)

All three read one intermediate model from `htmlToBlocks`
(`src/lib/ai-research-html-blocks.ts`), built from the **sanitized** HTML. Its
blocks are:

- headings (h1–h6) and paragraphs, with inline runs (bold, italic, underline,
  code, links)
- list items, with ordered/unordered, depth, and number
- quotes, pre, and rules
- tables, with the header detected
- images

Images:

- Only `data:image/(png|jpeg|gif|webp);base64` sources are kept by the
  sanitizer. Limits are 30 images and 5 MB each.
- **Remote images are never fetched.** They become an `[Image: alt]`
  placeholder, which avoids SSRF, tracking pixels, and slow pages.

### Excel

- **Tables:** reuses #109 `htmlTablesToSheets` + `buildWorkbook`, giving one
  sheet per table, a frozen bold header, and numeric cells.
- **No tables:** one sheet named after the page title (or "Content") with
  columns `Type | Text`. Each heading, paragraph, list item, quote, and
  preformatted block is one row. `textOnly` skips number typing so text like
  "2026" stays as written.

### PDF

- **No browser.** The existing AI Research PDF export renders on the client
  (jsPDF from markdown) and can't run on the server, and headless Chromium
  risks OOM on the VPS. So this uses **pdfkit**: pure JS, small memory, and
  under 100 ms for a typical page.
- **Layout:** A4 with 54 pt margins.
  - Content: the page title, headings sized by level, and paragraphs with
    mixed bold/italic runs and clickable links.
  - Lists: bullets or numbers, indented by depth.
  - Tables: grid, a shaded header that repeats on page breaks, and equal
    column widths.
  - Images: PNG/JPEG are embedded and scaled to fit; GIF/WebP become a
    placeholder.
  - Quotes have a left bar, pre uses Courier, and rules are drawn.
  - Every page has a "Page x of n" footer.
- **Fonts:** standard fonts are Windows-1252 only, so `pdfSafeText`
  transliterates common symbols (→, ≥, thin spaces), drops emoji, and
  replaces other characters with "?". Pages that are mostly non-Latin will
  lose text in the PDF; Word and Excel keep it. Embedding a Unicode TTF is the
  follow-up if needed.

### Word

- Uses the existing `docx` library.
- Headings use HeadingLevel 1–6. Paragraphs keep bold, italic, underline,
  code, and hyperlinks.
- Lists use bullet or decimal numbering. Each list gets its own `instance`, so
  numbering restarts per list.
- Tables have a shaded, bold header row. Quotes are indented. Pre uses
  Courier.
- PNG/JPEG/GIF images are embedded with `ImageRun`, scaled to 600 px wide or
  less.

## Storage and access

Migration **033_ai_research_html_uploads.sql**:

- `ai_research_uploads` columns: `id`, `user_id` (FK, cascade),
  `conversation_id`, `filename`, `mime_type`, `byte_size`, `title`,
  `sanitized_html`, `extracted_text`, `tables` JSONB, `created_at`. It is
  indexed on `(user_id, created_at DESC)`.
- `ai_research_exports.kind` is widened to `tables | extract | convert-xlsx |
  convert-pdf | convert-docx`.

Converted files are stored in `ai_research_exports` and downloaded through
the existing owner-only `GET /api/ai-research/exports/:id`, which serves the
row's MIME type.

Every upload, convert, and export query filters on `user_id`. Another user's
`uploadId` returns 404.

Attachment metadata is `{ kind: 'xlsx' | 'pdf' | 'docx', exportId, filename,
source: 'tables' | 'extract' | 'convert', sheetCount, rowCount, byteSize? }`.
The card shows XLSX, PDF, or DOCX with the matching label.

## Limits

- **Size and access:** upload 10 MB (the same as #109). The `ai-research`
  feature is required.
- **Rate limits:** `rateLimit` on uploads, convert, and AI extraction.
- **Disabled states:** actions are disabled while an answer is streaming.

## Tests

`tests/ai-research-html-convert.test.ts` reads the outputs back:

- **Excel:** loaded with exceljs. Table sheets have numeric cells; the
  text-block fallback has `Type | Text` rows.
- **PDF:** starts with `%PDF-`, ends with `%%EOF`, and is parsed with `unpdf`,
  which finds the headings, list, and table text. The embedded image is
  present.
- **Word:** unzipped with JSZip. `document.xml` has Heading1/2, `<w:tbl>`,
  bold/italic, numbering, and `word/media`.
- **Immediate-availability flow (fake deps):**
  - convert with no conversation creates one with upload and file messages
  - an existing conversation is appended to without repeating the upload
    message
  - another user is denied
  - Excel export by `uploadId` works before any message
- **Other:** sanitizer image rule, normalization of the new attachment kinds
  and `uploadId`, English UI strings, and the migration.
