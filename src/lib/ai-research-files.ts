import JSZip from 'jszip';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import * as XLSX from 'xlsx';
import {
  AI_RESEARCH_MAX_DOCUMENT_PAGES,
  AI_RESEARCH_MAX_EXTRACTED_CHARS,
  AI_RESEARCH_MAX_PRESENTATION_SLIDES,
  AI_RESEARCH_MAX_SPREADSHEET_ROWS,
  AI_RESEARCH_UNSUPPORTED_FILE_ERROR,
  attachmentError,
  fileExtension,
  inferResearchFileType,
  inferSpreadsheetType,
  isResearchDocument,
  splitFileDataUrl,
  type AiResearchChatMessage,
  type AiResearchFile,
} from './ai-research';

type MammothResult = { value: string; messages: Array<{ type: string; message: string }> };

const readDocx = mammoth as typeof mammoth & {
  convertToMarkdown: (input: { buffer: Buffer }) => Promise<MammothResult>;
};

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
}

export function detectCsvDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find(line => line.trim()) || '';
  const candidates = [',', ';', '\t'] as const;
  let best: (typeof candidates)[number] = ',';
  let bestCount = -1;
  for (const delimiter of candidates) {
    const count = first.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsvRows(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const delimiter = detectCsvDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < src.length; index += 1) {
    const char = src[index];
    if (inQuotes) {
      if (char === '"') {
        if (src[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      field = '';
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    if (row.some(cell => cell.trim())) rows.push(row);
  }
  return rows;
}

function escapeMdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function rowsToMarkdownTable(rows: unknown[][]): string {
  if (!rows.length) return '';
  const stringRows = rows.map(row => row.map(cell => String(cell ?? '').replace(/\s+/g, ' ').trim()));
  const width = Math.max(...stringRows.map(row => row.length), 1);
  const padded = stringRows.map(row => Array.from({ length: width }, (_, index) => escapeMdCell(row[index] || '')));
  if (padded.length === 1) return `| ${padded[0].join(' | ')} |`;
  const [header, ...body] = padded;
  const separator = header.map(() => '---');
  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
}

const EXTRACTION_TRUNCATION_NOTE = '\n… extracted text truncated — only part of the file was sent to the model';

export function truncateExtractedText(text: string): string {
  if (text.length <= AI_RESEARCH_MAX_EXTRACTED_CHARS) return text;
  const keep = Math.max(0, AI_RESEARCH_MAX_EXTRACTED_CHARS - EXTRACTION_TRUNCATION_NOTE.length);
  return `${text.slice(0, keep)}${EXTRACTION_TRUNCATION_NOTE}`;
}

export function limitLabeledSections(sections: string[], maxSections: number, omittedNoun: 'pages' | 'slides'): string {
  const kept = sections.slice(0, Math.max(0, maxSections));
  const omitted = Math.max(0, sections.length - kept.length);
  const body = kept.map(section => section.trim()).filter(Boolean).join('\n\n');
  if (!omitted) return body;
  const note = `… ${omitted} more ${omittedNoun} omitted`;
  return body ? `${body}\n\n${note}` : note;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unescapeMammothMarkdown(text: string): string {
  return normalizeWhitespace(text.replace(/\\([\\`*_{}[\]()#+.!|-])/g, '$1').replace(/!\[[^\]]*]\([^)]*\)/g, ''));
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function codePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10FFFF) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function drawingText(xml: string): string {
  const paragraphs = xml.split(/<a:p\b/).slice(1);
  const lines = paragraphs.map((chunk) => {
    const end = chunk.indexOf('</a:p>');
    const paragraph = end >= 0 ? chunk.slice(0, end) : chunk;
    return [...paragraph.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map(match => decodeXml(match[1]))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }).filter(Boolean);
  if (lines.length) return lines.join('\n');
  return [...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map(match => decodeXml(match[1]))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attachmentFailureDetail(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return (message.replace(/\s+/g, ' ').trim() || fallback).slice(0, 180);
}

function formatSheetRows(rows: unknown[][], sheetName?: string, sheetCount = 1): string {
  if (!rows.length) return '';
  const limited = rows.slice(0, AI_RESEARCH_MAX_SPREADSHEET_ROWS);
  const table = rowsToMarkdownTable(limited);
  const header = sheetCount > 1 && sheetName ? `Sheet: ${sheetName}\n` : '';
  const omitted = rows.length > limited.length
    ? `\n… ${rows.length - limited.length} more rows omitted`
    : '';
  return `${header}${table}${omitted}`;
}

export function extractCsvText(bytes: Uint8Array): string {
  const rows = parseCsvRows(decodeText(bytes));
  return truncateExtractedText(formatSheetRows(rows) || '(empty spreadsheet)');
}

export function extractSpreadsheetText(bytes: Uint8Array, mimeType: string, name?: string): string {
  const inferred = inferSpreadsheetType(mimeType, name) || mimeType;
  if (inferred === 'text/csv' || inferred === 'application/csv' || fileLooksLikeCsv(name, inferred)) {
    return extractCsvText(bytes);
  }

  const workbook = XLSX.read(bytes, { type: 'array', raw: false, cellDates: true });
  const parts = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    });
    return formatSheetRows(rows, sheetName, workbook.SheetNames.length);
  }).filter(Boolean);

  return truncateExtractedText(parts.join('\n\n') || '(empty spreadsheet)');
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const sections = pages.map((page, index) => {
    const body = normalizeWhitespace(String(page ?? ''));
    return body ? `Page ${index + 1}\n${body}` : '';
  });
  const joined = limitLabeledSections(sections, AI_RESEARCH_MAX_DOCUMENT_PAGES, 'pages');
  if (!joined) return '(no extractable text — the file may be scanned or image-only)';
  return truncateExtractedText(joined);
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes);
  let markdown = '';
  try {
    const result = await readDocx.convertToMarkdown({ buffer });
    markdown = unescapeMammothMarkdown(result.value || '');
  } catch {
    markdown = '';
  }
  if (!markdown) {
    const raw = await mammoth.extractRawText({ buffer });
    markdown = normalizeWhitespace(raw.value || '');
    if (!markdown) {
      const errors = raw.messages.filter(message => message.type === 'error').map(message => message.message);
      if (errors.length) throw new Error(errors.join('; '));
      return '(empty document)';
    }
  }
  return truncateExtractedText(markdown);
}

function slideIndex(path: string): number {
  const match = path.replace(/\\/g, '/').match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : 0;
}

async function extractPptxText(bytes: Uint8Array): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('unreadable presentation');
  }
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name.replace(/\\/g, '/')) && !zip.files[name]?.dir)
    .sort((left, right) => slideIndex(left) - slideIndex(right));
  if (!slideFiles.length) throw new Error('presentation has no slides');
  if (slideFiles.length > 500) throw new Error('presentation has too many slides');

  const sections: string[] = [];
  for (const path of slideFiles) {
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    if (xml.length > 1_500_000) throw new Error('slide is too large');
    const number = slideIndex(path);
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${number}.xml`)?.async('string');
    const body = drawingText(xml);
    const notes = notesXml && notesXml.length <= 1_500_000 ? drawingText(notesXml) : '';
    if (!body && !notes) {
      sections.push('');
      continue;
    }
    const lines = [`Slide ${number}`];
    if (body) lines.push(body);
    if (notes) lines.push(`Notes: ${notes}`);
    sections.push(lines.join('\n'));
  }

  const joined = limitLabeledSections(sections, AI_RESEARCH_MAX_PRESENTATION_SLIDES, 'slides');
  if (!joined) return '(empty presentation)';
  return truncateExtractedText(joined);
}

export async function extractResearchFileText(bytes: Uint8Array, mimeType: string, name?: string): Promise<string> {
  const inferred = inferResearchFileType(mimeType, name) || mimeType;
  if (!isResearchDocument({ mimeType: inferred, name })) {
    return extractSpreadsheetText(bytes, inferred, name);
  }
  const ext = fileExtension(name);
  if (inferred === 'application/pdf' || ext === '.pdf') return extractPdfText(bytes);
  if (ext === '.docx' || inferred.endsWith('wordprocessingml.document')) return extractDocxText(bytes);
  if (ext === '.pptx' || inferred.endsWith('presentationml.presentation')) return extractPptxText(bytes);
  throw new Error('unsupported document');
}

function fileLooksLikeCsv(name?: string, mimeType?: string): boolean {
  return (name || '').toLowerCase().endsWith('.csv') || mimeType === 'text/csv' || mimeType === 'application/csv';
}

export async function hydrateMessageFiles(messages: AiResearchChatMessage[]): Promise<AiResearchChatMessage[]> {
  return Promise.all(messages.map(async (message) => {
    if (!message.files?.length) return message;
    const files = await Promise.all(message.files.map((file, index) => hydrateOneFile(file, index)));
    return { ...message, files };
  }));
}

async function hydrateOneFile(file: AiResearchFile, index: number): Promise<AiResearchFile> {
  if (file.extractedText?.trim() && !file.dataUrl) {
    return {
      mimeType: file.mimeType,
      name: file.name,
      extractedText: file.extractedText.slice(0, AI_RESEARCH_MAX_EXTRACTED_CHARS),
    };
  }
  if (!file.dataUrl) {
    throw attachmentError(`File ${index + 1} is missing file data.`);
  }
  const parsed = splitFileDataUrl(file.dataUrl, file.name);
  if (!parsed) {
    throw attachmentError(AI_RESEARCH_UNSUPPORTED_FILE_ERROR);
  }
  const document = isResearchDocument({ mimeType: parsed.mimeType, name: file.name });
  let extractedText: string;
  try {
    extractedText = await extractResearchFileText(
      Buffer.from(parsed.base64, 'base64'),
      parsed.mimeType,
      file.name,
    );
  } catch (error) {
    const detail = attachmentFailureDetail(error, document ? 'unreadable document' : 'unreadable spreadsheet');
    const label = file.name || (document ? 'document' : 'spreadsheet');
    const expected = document ? 'PDF, DOCX, or PPTX' : 'XLSX, XLS, or CSV';
    throw attachmentError(`Could not read ${label}. Use a valid ${expected} file. (${detail})`);
  }
  return {
    mimeType: parsed.mimeType,
    name: file.name,
    extractedText,
  };
}
