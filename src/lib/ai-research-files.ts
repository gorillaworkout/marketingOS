import * as XLSX from 'xlsx';
import {
  AI_RESEARCH_MAX_EXTRACTED_CHARS,
  AI_RESEARCH_MAX_SPREADSHEET_ROWS,
  attachmentError,
  inferSpreadsheetType,
  splitFileDataUrl,
  type AiResearchChatMessage,
  type AiResearchFile,
} from './ai-research';

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

function truncateExtracted(text: string): string {
  if (text.length <= AI_RESEARCH_MAX_EXTRACTED_CHARS) return text;
  return `${text.slice(0, AI_RESEARCH_MAX_EXTRACTED_CHARS)}\n… extracted text truncated`;
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
  return truncateExtracted(formatSheetRows(rows) || '(empty spreadsheet)');
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

  return truncateExtracted(parts.join('\n\n') || '(empty spreadsheet)');
}

function fileLooksLikeCsv(name?: string, mimeType?: string): boolean {
  return (name || '').toLowerCase().endsWith('.csv') || mimeType === 'text/csv' || mimeType === 'application/csv';
}

export function hydrateMessageFiles(messages: AiResearchChatMessage[]): AiResearchChatMessage[] {
  return messages.map((message) => {
    if (!message.files?.length) return message;
    const files = message.files.map((file, index) => hydrateOneFile(file, index));
    return { ...message, files };
  });
}

function hydrateOneFile(file: AiResearchFile, index: number): AiResearchFile {
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
    throw attachmentError('Unsupported file type. Use XLSX, XLS, or CSV.');
  }
  let extractedText: string;
  try {
    extractedText = extractSpreadsheetText(
      Buffer.from(parsed.base64, 'base64'),
      parsed.mimeType,
      file.name,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unreadable spreadsheet';
    throw attachmentError(`Could not read ${file.name || 'spreadsheet'}. Use a valid XLSX, XLS, or CSV file. (${detail})`);
  }
  return {
    mimeType: parsed.mimeType,
    name: file.name,
    extractedText,
  };
}
