# AI Research: HTML uploads and Excel export — design

Date: 2026-10-21
Status: Approved

## Goal

Users can attach a web page (`.html` / `.htm`) to AI Research and ask about it.
They can also turn its tables, or any data in it, into an Excel workbook that
appears in the chat thread as a downloadable, shareable attachment.

## 1. Upload

- **Accepted files:** `.html` and `.htm`, as `text/html` (`application/xhtml+xml` is
  an alias). HTML counts as a *document* attachment, so the existing limits of 4
  documents per message and 16 MB in total still apply. The per-file limit for
  HTML is **10 MB**; other documents keep 8 MB. The limit is enforced on both the
  client (`researchDocumentMaxBytes`) and the server (`validateFileAttachment`,
  which returns "Each HTML file must be 10 MB or smaller.").
- **Server-side sanitizing** (`src/lib/ai-research-html.ts`, using cheerio):
  - Remove `script`, `style`, `noscript`, `template`, `iframe`/`frame`,
    `object`/`embed`/`applet`, `link`, `meta`, `base`, `svg`, `math`, `canvas`,
    form controls, and comments.
  - Strip every `on*` attribute, along with `style` and `srcdoc`.
  - Drop `href`/`src`/`action` attributes that use `javascript:`, `vbscript:`, or
    `data:` URLs.
- **Readable text:** the page title, then the text with block elements on
  separate lines. Each table is rendered inline as `Table N: <name>` followed by
  a Markdown table (at most 250 rows in the prompt). The text is truncated with
  the usual note at 80,000 characters.
- **Research context:** `hydrateMessageFiles` turns the uploaded HTML into
  `{ mimeType: 'text/html', name, extractedText, tables }`. The model sees it as
  "Attached HTML page (name)". The system prompt explains that scripts and styles
  were removed. The raw HTML is never stored; only the extracted text and tables
  are.
- **Knowledge Graph:** each HTML attachment in the incoming turn is saved with
  `persistKnowledgeQuietly`, the same path FAQ & Guides uploads use. The entry has
  task type `ai-research` (so AI Research can retrieve it), brief
  `Uploaded HTML: <title or file name>`, the first 8,000 characters of the text,
  and `action: 'complete'`. Its `taskId` is `html-<sha256>` of the content, with
  `upsertTask` set, so a re-upload updates the entry instead of duplicating it.
  The save runs in the background and never blocks the answer.

## 2. Automatic tables

- `extractHtmlTables` finds every `<table>` that has at least one non-empty cell,
  including nested tables, up to 50 tables, 5,000 rows, and 100 columns each.
  `colspan` and `rowspan` are expanded to blank cells, and rows are padded to the
  same width.
- **Table name:** the `<caption>`, then `aria-label`/`summary`, then the nearest
  preceding heading, then `Table N`.
- Tables are stored on the stored message's file (`files[].tables`) so they can
  be exported after a reload. The conversation `GET` removes them from the client
  payload.
- **"Export tables to Excel"** builds an .xlsx with exceljs:
  - **one sheet per table.** Sheet names are Excel-safe: no `[]:*?/\`, at most 31
    characters, not `History`, unique ignoring case (with a ` (2)` suffix).
  - **a frozen, bold header row** (the first row) with an autofilter.
  - **numeric cells typed as numbers:** `1,234.56`, `$1,234`, `Rp 15.000`,
    `1.234,56`, `(2.25)` (negative), and `12.5%` (stored as 0.125 with format
    `0.00%`). Values that look like identifiers or dates stay text: leading zeros,
    16 or more digits, ISO or slash dates.

## 3. AI extraction

- The user types an instruction, for example "extract product name, price, date".
  The request goes to `generateContent` with the user's routed AI Research model
  (`resolveFeatureModel(userId, 'ai-research')`). Because it goes through
  `callApi`, the existing model fallback in `src/lib/model-fallback.ts` applies.
  The call uses `response_format: json_object`, temperature 0.1, and up to 8,000
  output tokens. The source is the extracted text, at most 60,000 characters.
- The prompt asks for `{"sheetName","columns":[...],"rows":[[...]]}` using only
  data on the page, with `null` for missing values.
- **`validateExtractionJson`:**
  - Accepts code fences or text around the JSON.
  - Requires 1–50 columns. Blank column names become `Column N`, and duplicate
    names get ` (2)`.
  - Rows can be arrays (by position) or objects (keyed by column name, ignoring
    case). Fully empty rows are dropped, with at most 5,000 rows.
  - Fails with a clear English error when the JSON is invalid, columns are missing,
    or no rows are found.
- The validated result is written to a one-sheet workbook with the same header,
  freeze, and number handling as table export.

## 4. Delivery

- `POST /api/ai-research/excel` takes `{ conversationId, messageIndex,
  fileIndex, fileName, mode: 'tables'|'extract', instruction? }`.
  - It loads the user's stored conversation and finds the HTML file. It uses the
    index when it matches; otherwise it falls back to the latest HTML attachment
    with that name.
  - It builds the workbook and stores its bytes in **`ai_research_exports`**
    (migration `032_ai_research_exports.sql`).
  - It appends an assistant message to the thread:
    `{ content: "Exported 2 tables from page.html to Excel …", attachments:
    [{ kind: 'xlsx', exportId, filename, source, sheetCount, rowCount }] }`.
  - Extraction is rate-limited per user.
- `GET /api/ai-research/exports/:id` returns the file to its owner only, as an
  attachment with `nosniff`.
- **UI** (English only):
  - Under each HTML attachment on a user message are two buttons: **Export tables
    to Excel** and **Extract to Excel…**. The second opens an instruction field
    with the placeholder "e.g. extract product name, price, date".
  - The resulting assistant message shows an XLSX card with the file name and
    sheet/row counts. **Download** gets the file, and **Copy link** copies a URL
    that can be sent to someone.
  - The card survives a reload because the attachment is stored in the
    conversation messages (`validateExportAttachments`).

## Libraries

- `exceljs` ^4.4.0 writes the .xlsx workbooks: frozen panes, number formats, and
  read-back in tests. It is listed in `serverExternalPackages`.
- `cheerio` ^1.2.0 parses and sanitizes the HTML.
- The existing `xlsx` (SheetJS) dependency is still used only for reading
  uploaded spreadsheets.

## Tests

`tests/ai-research-html-excel.test.ts` covers:
- sanitizing (script, style, on*, javascript: URLs, iframe)
- readable text and Markdown tables
- table detection, naming, colspan, and nested tables
- numeric parsing
- sheet-name rules
- an xlsx built from tables and **read back with exceljs** (sheets, frozen
  header, bold header, numeric types, percent format)
- AI extraction JSON validation, for valid and invalid inputs
- the 10 MB upload limit
- server hydration
- the export flow and the extraction flow with fake dependencies
- the Knowledge Graph entry
- the UI and migration wiring
