# Event Plan v2

Status: built on `main` after Video Script v2 (`df9517d`). No new menu item. Access stays the existing `event-plan` department grant. No migration: confirmed quotations are stored on the existing event-plan task in `output_data.input`. Uploaded files stay private under `data/event-plan-quotations/` and are not served from `public/`.

## New brief fields

- **Venue name** is the specific hall or hotel. Location remains the city.
- **Target participants** is a whole number from 1 to 100,000. The plan uses it for seating, catering, and materials. It does not invent a per-person price.
- **Speakers** is a list. When it has names, those names are the speaker slots. The model is told not to add other speakers.

## Quotations

Upload up to 5 files, 10 MB each: PDF, DOCX, XLSX, CSV, JPG, or PNG. The file is stored privately and read as data. It is never executed.

- PDF uses `unpdf`.
- DOCX uses Mammoth raw text, with external file access disabled.
- XLSX and CSV use the existing spreadsheet reader.
- JPG and PNG use the same vision chat path as other image descriptions, with the Event Plan model. If that model cannot read an image, upload a PDF, DOCX, XLSX, or CSV instead.

The model returns line items only. The table is editable: fix a row, add a line, or remove one. Totals are shown per category, then a subtotal, a contingency percent (default 10), and an IDR grand total. Amounts in another currency stay labeled and are not added into the IDR total.

When you generate, confirmed rows are copied into the budget and marked **Quotation**. Other lines stay **AI estimate**. An estimate is not presented as a quotation, and it keeps a Rupiah amount only when a public research excerpt states that price.
