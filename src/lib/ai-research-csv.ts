import JSZip from 'jszip';

/** UTF-8 byte order mark: makes Excel open the file as UTF-8 instead of the system code page. */
export const CSV_BOM = '\uFEFF';
export const CSV_MIME = 'text/csv; charset=utf-8';
export const ZIP_MIME = 'application/zip';

const NUMERIC = /^-?\d[\d.,]*(e[+-]?\d+)?%?$/i;

/**
 * One CSV field (RFC 4180): quoted when it holds a comma, quote, line break,
 * or leading/trailing space; quotes are doubled. Values that a spreadsheet
 * would run as a formula (=, +, @, tab, or "-" not followed by a number) get a
 * leading apostrophe so opening the file cannot execute anything.
 */
export function csvField(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+@\t\r]/.test(text) || (text.startsWith('-') && !NUMERIC.test(text))) text = `'${text}`;
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Rows to CSV text with a UTF-8 BOM and CRLF line endings. Short rows are padded to the widest row. */
export function rowsToCsv(rows: unknown[][]): string {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const lines = rows.map(row => {
    const cells = Array.from({ length: width }, (_, index) => csvField(row[index]));
    return cells.join(',');
  });
  return `${CSV_BOM}${lines.join('\r\n')}${lines.length ? '\r\n' : ''}`;
}

export function rowsToCsvBuffer(rows: unknown[][]): Buffer {
  return Buffer.from(rowsToCsv(rows), 'utf8');
}

/** Safe, unique file stem (ASCII, no path characters) for a CSV inside a zip. */
export function csvEntryName(raw: string, used: Set<string>, fallback = 'table'): string {
  const base = (raw || '')
    .normalize('NFKD')
    .replace(/[^\w .()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim() || fallback;
  let name = base;
  let counter = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base} (${counter})`;
    counter += 1;
  }
  used.add(name.toLowerCase());
  return `${name}.csv`;
}

/** Zip of CSV files, one per named sheet. */
export async function csvZip(sheets: Array<{ name: string; rows: unknown[][] }>): Promise<Buffer> {
  const zip = new JSZip();
  const used = new Set<string>();
  sheets.forEach((sheet, index) => {
    zip.file(csvEntryName(sheet.name, used, `table-${index + 1}`), rowsToCsv(sheet.rows));
  });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
