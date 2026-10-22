import PDFDocument from 'pdfkit';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type ParagraphChild,
} from 'docx';
import { loadSanitizedHtml, extractHtmlTables } from './ai-research-html';
import { htmlToBlocks, runsText, type HtmlBlock, type HtmlDocumentModel, type InlineRun } from './ai-research-html-blocks';
import { buildWorkbook, htmlTablesToSheets, type WorkbookSheet } from './ai-research-excel';
import { CSV_MIME, ZIP_MIME, csvZip, rowsToCsvBuffer } from './ai-research-csv';

export type HtmlConvertFormat = 'xlsx' | 'pdf' | 'docx' | 'csv';

export const CONVERT_MIME: Record<HtmlConvertFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: CSV_MIME,
};

export const CONVERT_LABEL: Record<HtmlConvertFormat, string> = {
  xlsx: 'Excel',
  pdf: 'PDF',
  docx: 'Word',
  csv: 'CSV',
};

export interface ConvertedFile {
  data: Buffer;
  sheetCount: number;
  rowCount: number;
  /** True when an Excel/CSV export fell back to text blocks because the page has no tables. */
  textBlocks?: boolean;
  /** Overrides the format's default MIME type and extension (CSV of several tables is a .zip). */
  mimeType?: string;
  extension?: string;
  /** Name of the single table written, when one table was chosen. */
  tableName?: string;
}

export interface ConvertOptions {
  /** CSV only: write just this table (index into the detected tables). */
  tableIndex?: number;
}

const BLOCK_LABEL: Record<string, string> = {
  paragraph: 'Paragraph',
  'list-item': 'List item',
  quote: 'Quote',
  pre: 'Preformatted',
};

/** One row per readable block (headings and paragraphs) for pages without tables. */
export function textBlockSheet(model: HtmlDocumentModel): WorkbookSheet {
  const rows: string[][] = [['Type', 'Text']];
  for (const block of model.blocks) {
    if (block.type === 'heading') rows.push([`Heading ${block.level}`, runsText(block.runs).replace(/\s+/g, ' ').trim()]);
    else if (block.type === 'paragraph' || block.type === 'list-item' || block.type === 'quote') {
      rows.push([BLOCK_LABEL[block.type], runsText(block.runs).replace(/\s*\n\s*/g, ' ').trim()]);
    } else if (block.type === 'pre') rows.push([BLOCK_LABEL.pre, block.text]);
  }
  return { name: model.title || 'Content', rows, textOnly: true };
}

/** Excel: one sheet per table, or one sheet of text blocks when there are none. */
export async function convertHtmlToXlsx(html: string): Promise<ConvertedFile> {
  const $ = loadSanitizedHtml(html);
  const sheets = htmlTablesToSheets(extractHtmlTables($));
  if (sheets.length) {
    return {
      data: await buildWorkbook(sheets),
      sheetCount: sheets.length,
      rowCount: sheets.reduce((sum, sheet) => sum + Math.max(0, sheet.rows.length - 1), 0),
    };
  }
  const sheet = textBlockSheet(htmlToBlocks($));
  if (sheet.rows.length === 1) sheet.rows.push(['Paragraph', '(This page has no readable content.)']);
  return { data: await buildWorkbook([sheet]), sheetCount: 1, rowCount: sheet.rows.length - 1, textBlocks: true };
}

/**
 * CSV: one table gives one .csv; several give a .zip with one CSV per table
 * (named after the sheets) unless a table is chosen; no tables gives a
 * Type,Text CSV of the readable blocks. UTF-8 with BOM, RFC 4180 quoting.
 */
export async function convertHtmlToCsv(html: string, options: ConvertOptions = {}): Promise<ConvertedFile> {
  const $ = loadSanitizedHtml(html);
  const sheets = htmlTablesToSheets(extractHtmlTables($));
  const rowCountOf = (sheet: WorkbookSheet) => Math.max(0, sheet.rows.length - 1);
  if (sheets.length) {
    const chosen = typeof options.tableIndex === 'number' && Number.isInteger(options.tableIndex)
      ? sheets[options.tableIndex]
      : sheets.length === 1 ? sheets[0] : undefined;
    if (typeof options.tableIndex === 'number' && !chosen) throw new RangeError('That table was not found in the page.');
    if (chosen) {
      return { data: rowsToCsvBuffer(chosen.rows), sheetCount: 1, rowCount: rowCountOf(chosen), tableName: chosen.name };
    }
    return {
      data: await csvZip(sheets),
      sheetCount: sheets.length,
      rowCount: sheets.reduce((sum, sheet) => sum + rowCountOf(sheet), 0),
      mimeType: ZIP_MIME,
      extension: 'zip',
    };
  }
  const sheet = textBlockSheet(htmlToBlocks($));
  if (sheet.rows.length === 1) sheet.rows.push(['Paragraph', '(This page has no readable content.)']);
  return { data: rowsToCsvBuffer(sheet.rows), sheetCount: 1, rowCount: sheet.rows.length - 1, textBlocks: true };
}

// ---------- PDF (pdfkit, standard fonts; no browser) ----------

const PDF_MARGIN = 54;
const INK = '#1D2939';
const TITLE_INK = '#101828';
const MUTED = '#667085';
const LINK = '#3538CD';
const HEADING_SIZE = [20, 16, 14, 12, 11, 11];
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

const PDF_TRANSLITERATION: Record<string, string> = {
  '\u2212': '-', '\u2010': '-', '\u2011': '-', '\u2192': '->', '\u2190': '<-', '\u2194': '<->',
  '\u21D2': '=>', '\u2264': '<=', '\u2265': '>=', '\u2260': '!=', '\u2248': '~', '\u2713': 'v', '\u2714': 'v',
  '\u2009': ' ', '\u200A': ' ', '\u2002': ' ', '\u2003': ' ', '\u202F': ' ', '\u200B': '', '\u200C': '', '\u200D': '', '\uFE0F': '',
};

/**
 * Standard PDF fonts only cover Windows-1252: common symbols are transliterated,
 * emoji are dropped, and anything else becomes "?".
 */
export function pdfSafeText(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (char === '\n' || (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(char)) out += char;
    else if (code === 9) out += ' ';
    else if (char in PDF_TRANSLITERATION) out += PDF_TRANSLITERATION[char];
    else if (code >= 0x1F000 || (code >= 0x2600 && code <= 0x27BF)) continue;
    else out += '?';
  }
  return out;
}

function pdfFont(run: InlineRun): string {
  if (run.code) return run.bold ? 'Courier-Bold' : 'Courier';
  if (run.bold && run.italic) return 'Helvetica-BoldOblique';
  if (run.bold) return 'Helvetica-Bold';
  if (run.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

type Pdf = InstanceType<typeof PDFDocument>;

function contentWidth(doc: Pdf): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function bottomLimit(doc: Pdf): number {
  return doc.page.height - doc.page.margins.bottom;
}

function ensureSpace(doc: Pdf, height: number) {
  if (doc.y + height > bottomLimit(doc)) doc.addPage();
}

function writeRuns(doc: Pdf, runs: InlineRun[], options: { size: number; indent?: number; color?: string; italic?: boolean; prefix?: string }) {
  const x = doc.page.margins.left + (options.indent ?? 0);
  const width = contentWidth(doc) - (options.indent ?? 0);
  const all: InlineRun[] = options.prefix ? [{ text: options.prefix }, ...runs] : runs;
  ensureSpace(doc, options.size * 1.6);
  all.forEach((run, index) => {
    const last = index === all.length - 1;
    doc.font(pdfFont({ ...run, italic: run.italic || options.italic }))
      .fontSize(options.size)
      .fillColor(run.href ? LINK : options.color ?? INK);
    const text = pdfSafeText(run.text);
    const textOptions = { width, continued: !last, link: run.href, underline: Boolean(run.underline || run.href), lineGap: 2 };
    if (index === 0) doc.text(text, x, doc.y, textOptions);
    else doc.text(text, textOptions);
  });
}

function drawTable(doc: Pdf, rows: string[][], header: boolean) {
  const columns = Math.max(1, ...rows.map(row => row.length));
  const width = contentWidth(doc);
  const colWidth = width / columns;
  const size = columns > 8 ? 6.5 : columns > 5 ? 8 : 9;
  const pad = 4;
  const left = doc.page.margins.left;
  const cellText = (value: string) => pdfSafeText(value.slice(0, 600));
  const rowHeight = (row: string[], bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    return Math.max(...Array.from({ length: columns }, (_, index) => doc.heightOfString(cellText(row[index] ?? ''), { width: colWidth - pad * 2 }))) + pad * 2;
  };
  const drawRow = (row: string[], bold: boolean) => {
    const height = Math.min(rowHeight(row, bold), bottomLimit(doc) - doc.page.margins.top);
    if (doc.y + height > bottomLimit(doc)) {
      doc.addPage();
      if (header && !bold) drawRow(rows[0], true);
    }
    const top = doc.y;
    if (bold) doc.rect(left, top, width, height).fill('#EEF2FF');
    doc.lineWidth(0.5).strokeColor('#D0D5DD');
    for (let index = 0; index < columns; index += 1) {
      const x = left + index * colWidth;
      doc.rect(x, top, colWidth, height).stroke();
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(bold ? TITLE_INK : INK)
        .text(cellText(row[index] ?? ''), x + pad, top + pad, { width: colWidth - pad * 2, height: height - pad * 2, ellipsis: true });
    }
    doc.x = left;
    doc.y = top + height;
  };
  rows.forEach((row, index) => drawRow(row, header && index === 0));
  doc.moveDown(0.6);
}

function drawImage(doc: Pdf, block: Extract<HtmlBlock, { type: 'image' }>) {
  if (block.format === 'gif') {
    writeRuns(doc, [{ text: `[Image${block.alt ? `: ${block.alt}` : ''}]`, italic: true }], { size: 9, color: MUTED });
    return;
  }
  const maxWidth = contentWidth(doc);
  const maxHeight = Math.min(420, bottomLimit(doc) - doc.page.margins.top);
  const scale = Math.min(1, maxWidth / block.width, maxHeight / block.height);
  const width = block.width * scale;
  const height = block.height * scale;
  ensureSpace(doc, height + 6);
  try {
    doc.image(block.data, doc.page.margins.left, doc.y, { width, height });
    doc.y += height + 6;
    doc.x = doc.page.margins.left;
  } catch {
    writeRuns(doc, [{ text: `[Image${block.alt ? `: ${block.alt}` : ''}]`, italic: true }], { size: 9, color: MUTED });
  }
}

/** Render sanitized HTML to PDF with pdfkit: headings, paragraphs, lists, tables, embedded images. */
export async function convertHtmlToPdf(html: string, fallbackTitle = 'Document'): Promise<ConvertedFile> {
  const model = htmlToBlocks(html);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PDF_MARGIN, bottom: PDF_MARGIN, left: PDF_MARGIN, right: PDF_MARGIN },
    bufferPages: true,
    info: { Title: pdfSafeText(model.title || fallbackTitle).slice(0, 200), Creator: 'MarketingOS AI Research' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });

  if (model.title) {
    writeRuns(doc, [{ text: model.title, bold: true }], { size: 22, color: TITLE_INK });
    doc.moveDown(0.5);
  }
  if (!model.blocks.length) writeRuns(doc, [{ text: '(This page has no readable content.)', italic: true }], { size: 11, color: MUTED });
  for (const block of model.blocks) {
    switch (block.type) {
      case 'heading':
        doc.moveDown(block.level <= 2 ? 0.6 : 0.4);
        writeRuns(doc, block.runs.map(run => ({ ...run, bold: true })), { size: HEADING_SIZE[block.level - 1], color: TITLE_INK });
        doc.moveDown(0.25);
        break;
      case 'paragraph':
        writeRuns(doc, block.runs, { size: 11 });
        doc.moveDown(0.5);
        break;
      case 'list-item':
        writeRuns(doc, block.runs, { size: 11, indent: 14 + block.depth * 16, prefix: block.ordered ? `${block.index}. ` : '• ' });
        doc.moveDown(0.15);
        break;
      case 'quote':
        writeRuns(doc, block.runs, { size: 11, indent: 18, italic: true, color: MUTED });
        doc.moveDown(0.5);
        break;
      case 'pre':
        writeRuns(doc, [{ text: block.text, code: true }], { size: 9, indent: 8 });
        doc.moveDown(0.5);
        break;
      case 'table':
        drawTable(doc, block.rows, block.header);
        break;
      case 'image':
        drawImage(doc, block);
        break;
      case 'image-placeholder':
        writeRuns(doc, [{ text: `[Image: ${block.alt}]`, italic: true }], { size: 9, color: MUTED });
        doc.moveDown(0.3);
        break;
      case 'rule': {
        ensureSpace(doc, 12);
        const y = doc.y + 4;
        doc.lineWidth(0.6).strokeColor('#E4E7EC').moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
        doc.y = y + 8;
        break;
      }
    }
  }

  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`Page ${index + 1} of ${range.count}`, PDF_MARGIN, doc.page.height - 34, { lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await finished;
  return { data: Buffer.concat(chunks), sheetCount: 0, rowCount: 0 };
}

// ---------- Word (docx) ----------

const DOCX_HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];
const DOCX_CONTENT_WIDTH = 9360;

function docxRuns(runs: InlineRun[], extra: { italics?: boolean; color?: string; size?: number } = {}): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const run of runs) {
    const parts = run.text.split('\n');
    const textRuns = parts.map((part, index) => new TextRun({
      text: part,
      break: index > 0 ? 1 : undefined,
      bold: run.bold || undefined,
      italics: run.italic || extra.italics || undefined,
      underline: run.underline ? {} : undefined,
      font: run.code ? 'Consolas' : undefined,
      color: run.href ? '3538CD' : extra.color,
      size: extra.size,
    }));
    if (run.href) children.push(new ExternalHyperlink({ link: run.href, children: textRuns }));
    else children.push(...textRuns);
  }
  return children.length ? children : [new TextRun('')];
}

function docxTable(rows: string[][], header: boolean): Table {
  const columns = Math.max(1, ...rows.map(row => row.length));
  const width = Math.floor(DOCX_CONTENT_WIDTH / columns);
  return new Table({
    width: { size: width * columns, type: WidthType.DXA },
    columnWidths: Array.from({ length: columns }, () => width),
    rows: rows.map((row, rowIndex) => {
      const isHeader = header && rowIndex === 0;
      return new TableRow({
        tableHeader: isHeader || undefined,
        children: Array.from({ length: columns }, (_, index) => new TableCell({
          width: { size: width, type: WidthType.DXA },
          shading: isHeader ? { type: ShadingType.CLEAR, fill: 'EEF2FF' } : undefined,
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: row[index] ?? '', bold: isHeader || undefined, size: columns > 6 ? 16 : 20 })] })],
        })),
      });
    }),
  });
}

/** Convert sanitized HTML to .docx: headings, paragraphs, bold/italic, lists, tables, embedded images. */
export async function convertHtmlToDocx(html: string, fallbackTitle = 'Document'): Promise<ConvertedFile> {
  const model = htmlToBlocks(html);
  const children: FileChild[] = [];
  if (model.title) {
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: model.title })] }));
  }
  if (!model.blocks.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: '(This page has no readable content.)', italics: true, color: '667085' })] }));
  }
  for (const block of model.blocks) {
    switch (block.type) {
      case 'heading':
        children.push(new Paragraph({ heading: DOCX_HEADINGS[block.level - 1], children: docxRuns(block.runs) }));
        break;
      case 'paragraph':
        children.push(new Paragraph({ spacing: { after: 140 }, children: docxRuns(block.runs) }));
        break;
      case 'list-item':
        children.push(new Paragraph({
          numbering: { reference: block.ordered ? 'html-ordered' : 'html-bullet', level: Math.min(block.depth, 4), instance: block.listId },
          spacing: { after: 60 },
          children: docxRuns(block.runs),
        }));
        break;
      case 'quote':
        children.push(new Paragraph({ indent: { left: 720 }, spacing: { after: 140 }, children: docxRuns(block.runs, { italics: true, color: '475467' }) }));
        break;
      case 'pre':
        for (const line of block.text.split('\n')) {
          children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: 'F4F4F5' }, spacing: { after: 0 }, children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })] }));
        }
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      case 'table':
        children.push(docxTable(block.rows, block.header));
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      case 'image': {
        const scale = Math.min(1, 600 / block.width, 800 / block.height);
        children.push(new Paragraph({
          children: [new ImageRun({
            type: block.format === 'jpeg' ? 'jpg' : block.format,
            data: block.data,
            transformation: { width: Math.max(1, Math.round(block.width * scale)), height: Math.max(1, Math.round(block.height * scale)) },
            altText: block.alt ? { name: block.alt.slice(0, 100), description: block.alt, title: block.alt.slice(0, 100) } : undefined,
          })],
        }));
        break;
      }
      case 'image-placeholder':
        children.push(new Paragraph({ children: [new TextRun({ text: `[Image: ${block.alt}]`, italics: true, color: '667085' })] }));
        break;
      case 'rule':
        children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E4E7EC', space: 1 } }, children: [] }));
        break;
    }
  }
  const levels = (ordered: boolean) => Array.from({ length: 5 }, (_, level) => ({
    level,
    format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : ['•', '◦', '▪', '•', '◦'][level],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
  }));
  const document = new Document({
    creator: 'MarketingOS AI Research',
    title: (model.title || fallbackTitle).slice(0, 200),
    styles: { default: { document: { run: { font: 'Calibri', size: 22, color: '1D2939' } } } },
    numbering: {
      config: [
        { reference: 'html-bullet', levels: levels(false) },
        { reference: 'html-ordered', levels: levels(true) },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 1008, bottom: 1008, left: 1080, right: 1080 } } }, children }],
  });
  return { data: await Packer.toBuffer(document), sheetCount: 0, rowCount: 0 };
}

export async function convertHtml(
  html: string,
  format: HtmlConvertFormat,
  fallbackTitle?: string,
  options: ConvertOptions = {},
): Promise<ConvertedFile> {
  if (format === 'xlsx') return convertHtmlToXlsx(html);
  if (format === 'csv') return convertHtmlToCsv(html, options);
  if (format === 'pdf') return convertHtmlToPdf(html, fallbackTitle);
  return convertHtmlToDocx(html, fallbackTitle);
}
