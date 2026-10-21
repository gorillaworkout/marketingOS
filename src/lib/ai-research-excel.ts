import ExcelJS from 'exceljs';
import type { HtmlTable } from './ai-research-html';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const EXTRACTION_MAX_COLUMNS = 50;
export const EXTRACTION_MAX_ROWS = 5_000;
const SHEET_NAME_MAX = 31;

export type SheetCell = string | number | boolean | null;

export interface WorkbookSheet {
  name: string;
  /** First row is the header row. */
  rows: SheetCell[][];
}

/**
 * Excel sheet name: at most 31 characters, none of []:*?/\, not blank,
 * no leading or trailing apostrophe, not "History", unique ignoring case.
 */
export function sanitizeSheetName(raw: string, used: Set<string>, fallback = 'Sheet'): string {
  let base = (raw || '')
    .replace(/[[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim();
  if (!base || base.toLowerCase() === 'history') base = fallback;
  base = base.slice(0, SHEET_NAME_MAX).trim() || fallback;
  let name = base;
  let counter = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${counter})`;
    name = `${base.slice(0, SHEET_NAME_MAX - suffix.length).trim()}${suffix}`;
    counter += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

export type ParsedNumber = { value: number; percent: boolean } | null;

/**
 * Parse a display string as a number when it clearly is one: "1,234.56",
 * "$1,234", "Rp 15.000", "-5", "(1,200)", "12.5%", "1.234,56". Values that
 * look like identifiers (leading zeros, 16+ digits, phone numbers, dates) stay text.
 */
export function parseNumericCell(raw: string): ParsedNumber {
  const text = raw.replace(/\u00a0/g, ' ').trim();
  if (!text || text.length > 40) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(text)) return null;
  let value = text;
  let negative = false;
  const percent = value.endsWith('%');
  if (percent) value = value.slice(0, -1).trim();
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1).trim();
  }
  const rupiah = /^(?:rp\.?|idr)\s*/i.test(value) || /\s*(?:rp|idr)$/i.test(value);
  value = value.replace(/^(?:rp\.?|idr|usd|us\$|\$|€|£|¥)\s*/i, '').replace(/\s*(?:rp|idr|usd|\$|€|£)$/i, '').trim();
  if (value.startsWith('-') || value.startsWith('−')) {
    negative = !negative;
    value = value.slice(1).trim();
  } else if (value.startsWith('+')) {
    value = value.slice(1).trim();
  }
  if (!/^[\d.,]+$/.test(value) || !/\d/.test(value)) return null;
  const digits = value.replace(/[.,]/g, '');
  if (digits.length > 15) return null;
  if (/^0\d/.test(value) && !/^0[.,]/.test(value)) return null;

  let normalized: string;
  const commaCount = (value.match(/,/g) || []).length;
  const dotCount = (value.match(/\./g) || []).length;
  if (commaCount && dotCount) {
    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');
    normalized = lastDot > lastComma
      ? value.replace(/,/g, '')
      : value.replace(/\./g, '').replace(',', '.');
  } else if (commaCount) {
    normalized = commaCount === 1 && !/^\d{1,3},\d{3}$/.test(value)
      ? value.replace(',', '.')
      : /^\d{1,3}(,\d{3})+$/.test(value) ? value.replace(/,/g, '') : '';
  } else if (dotCount > 1) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(value) ? value.replace(/\./g, '') : '';
  } else if (dotCount === 1 && rupiah && /^\d{1,3}\.\d{3}$/.test(value)) {
    // Rupiah uses "." for thousands: "Rp 15.000" is fifteen thousand.
    normalized = value.replace('.', '');
  } else {
    normalized = value;
  }
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) return null;
  let number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  if (negative) number = -number;
  return { value: percent ? number / 100 : number, percent };
}

function typedCell(value: SheetCell): { value: string | number | boolean | null; percent: boolean } {
  if (value == null) return { value: null, percent: false };
  if (typeof value === 'number') return { value: Number.isFinite(value) ? value : null, percent: false };
  if (typeof value === 'boolean') return { value, percent: false };
  const parsed = parseNumericCell(value);
  if (parsed) return { value: parsed.value, percent: parsed.percent };
  return { value: value.slice(0, 32_000), percent: false };
}

/** Build an .xlsx: one sheet each, bold frozen header row, numbers typed as numbers. */
export async function buildWorkbook(sheets: WorkbookSheet[]): Promise<Buffer> {
  if (!sheets.length) throw new Error('There is nothing to export.');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MarketingOS AI Research';
  workbook.created = new Date();
  const used = new Set<string>();
  sheets.forEach((sheet, index) => {
    const name = sanitizeSheetName(sheet.name, used, `Table ${index + 1}`);
    const worksheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });
    const width = Math.max(1, ...sheet.rows.map(row => row.length));
    const widths = Array.from({ length: width }, () => 8);
    sheet.rows.forEach((row, rowIndex) => {
      const excelRow = worksheet.getRow(rowIndex + 1);
      for (let column = 0; column < width; column += 1) {
        const raw = row[column] ?? null;
        const cell = excelRow.getCell(column + 1);
        if (rowIndex === 0) {
          cell.value = raw == null ? '' : String(raw);
        } else {
          const typed = typedCell(raw);
          cell.value = typed.value;
          if (typed.percent) cell.numFmt = '0.00%';
        }
        const shown = raw == null ? 0 : String(raw).length;
        widths[column] = Math.min(60, Math.max(widths[column], shown + 2));
      }
      if (rowIndex === 0) excelRow.font = { bold: true };
      excelRow.commit();
    });
    worksheet.columns.forEach((column, index) => {
      column.width = widths[index] ?? 10;
    });
    if (sheet.rows.length > 1) {
      worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: width } };
    }
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

export function htmlTablesToSheets(tables: HtmlTable[]): WorkbookSheet[] {
  return tables
    .filter(table => table.rows.length > 0)
    .map(table => ({ name: table.name, rows: table.rows }));
}

export class ExtractionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionValidationError';
  }
}

export interface ExtractionResult {
  sheetName: string;
  columns: string[];
  rows: SheetCell[][];
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1];
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function normalizeCell(value: unknown): SheetCell {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, 2_000);
  if (Array.isArray(value)) return value.map(item => (item == null ? '' : String(item))).join(', ').slice(0, 2_000);
  return JSON.stringify(value).slice(0, 2_000);
}

/**
 * Validate the model's JSON: { "sheetName"?, "columns": string[], "rows": [...] }.
 * Rows may be arrays (by column position) or objects keyed by column name.
 */
export function validateExtractionJson(raw: unknown): ExtractionResult {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(stripCodeFence(raw));
    } catch {
      throw new ExtractionValidationError('The AI response was not valid JSON.');
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ExtractionValidationError('The AI response must be a JSON object with columns and rows.');
  }
  const record = data as { columns?: unknown; rows?: unknown; sheetName?: unknown };
  if (!Array.isArray(record.columns) || record.columns.length === 0) {
    throw new ExtractionValidationError('The AI response has no columns.');
  }
  if (record.columns.length > EXTRACTION_MAX_COLUMNS) {
    throw new ExtractionValidationError(`The AI response has more than ${EXTRACTION_MAX_COLUMNS} columns.`);
  }
  const seen = new Set<string>();
  const columns = record.columns.map((column, index) => {
    let name = typeof column === 'string' ? column.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    if (!name) name = `Column ${index + 1}`;
    let unique = name;
    let counter = 2;
    while (seen.has(unique.toLowerCase())) unique = `${name} (${counter++})`;
    seen.add(unique.toLowerCase());
    return { label: unique, key: typeof column === 'string' ? column : unique };
  });
  if (!Array.isArray(record.rows)) {
    throw new ExtractionValidationError('The AI response has no rows array.');
  }
  const rows: SheetCell[][] = [];
  for (const row of record.rows.slice(0, EXTRACTION_MAX_ROWS)) {
    let cells: SheetCell[];
    if (Array.isArray(row)) {
      cells = columns.map((_, index) => normalizeCell(row[index]));
    } else if (row && typeof row === 'object') {
      const object = row as Record<string, unknown>;
      const lowerKeys = new Map(Object.keys(object).map(key => [key.toLowerCase().trim(), key]));
      cells = columns.map(column => {
        const key = lowerKeys.get(column.key.toLowerCase().trim()) ?? lowerKeys.get(column.label.toLowerCase());
        return normalizeCell(key ? object[key] : null);
      });
    } else {
      continue;
    }
    if (cells.some(cell => cell !== null && cell !== '')) rows.push(cells);
  }
  if (!rows.length) {
    throw new ExtractionValidationError('The AI found no rows that match the instruction.');
  }
  const sheetName = typeof record.sheetName === 'string' && record.sheetName.trim()
    ? record.sheetName.trim().slice(0, 60)
    : 'Extraction';
  return { sheetName, columns: columns.map(column => column.label), rows };
}

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured data from a web page for a spreadsheet.
Follow the user's instruction about which fields to extract.
Use only data that appears in the page content. Never invent values; use null when a value is missing.
Return ONLY a JSON object, with no Markdown and no commentary, in this exact shape:
{"sheetName": "short English name", "columns": ["Column A", "Column B"], "rows": [["value", 123], ["value", 456]]}
Each row is an array in the same order as "columns". Write numbers as JSON numbers without currency symbols or thousands separators when the value is clearly numeric. Keep dates as text in the format shown on the page. Use English column names.`;

export function buildExtractionUserPrompt(instruction: string, sourceName: string, content: string): string {
  return `Instruction: ${instruction.trim().slice(0, 1_000)}

Source file: ${sourceName}

Page content:
"""
${content}
"""`;
}

export function xlsxFilename(base: string, suffix: string): string {
  const stem = (base || 'export')
    .replace(/\.(html?|xlsx)$/i, '')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'export';
  return `${stem}-${suffix}.xlsx`;
}
