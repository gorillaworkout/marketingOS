/**
 * Reads MT5 Manager text exports: UTF-16LE/BE (BOM) or UTF-8, one title line
 * ("Trades\Deposit and Withdrawal Report for …" / "MetaTrader 5 Manager …"),
 * a header line, tab- or ';'-separated rows, and an optional "Total" footer.
 */
export interface TextTable { title: string; header: string[]; rows: string[][]; footer: string[] | null; separator: '\t' | ';' }

export function decodeText(buffer: Buffer | Uint8Array): string {
  const bytes = Buffer.from(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  const text = bytes.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function isZipOrXlsx(buffer: Buffer | Uint8Array): boolean {
  return buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Splits the export. Returns null when no header line is found within the first 5 lines. */
export function readTextTable(buffer: Buffer | Uint8Array, requiredHeader: string): TextTable | null {
  const lines = decodeText(buffer).split(/\r?\n/).map(line => line.replace(/\s+$/, ''));
  const headerIndex = lines.slice(0, 5).findIndex(line => line.split(/[\t;]/).some(cell => cell.trim().toLowerCase() === requiredHeader.toLowerCase()));
  if (headerIndex < 0) return null;
  const headerLine = lines[headerIndex];
  const separator: '\t' | ';' = headerLine.includes('\t') ? '\t' : ';';
  const header = headerLine.split(separator).map(cell => cell.trim());
  const body = lines.slice(headerIndex + 1).filter(line => line.trim() !== '').map(line => line.split(separator));
  let footer: string[] | null = null;
  if (body.length && body[body.length - 1][0]?.trim().toLowerCase() === 'total') footer = body.pop() ?? null;
  return { title: lines.slice(0, headerIndex).join(' ').trim(), header, rows: body, footer, separator };
}
