/**
 * CSV reading for SEO OS imports. Accepts what spreadsheets actually export:
 * UTF-8 with or without a BOM, UTF-16 LE/BE (Excel "Unicode text"), and
 * comma, semicolon, or tab delimiters.
 */

export type CsvEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

function swapBytes(bytes: Uint8Array): Uint8Array {
  const swapped = new Uint8Array(bytes.length - (bytes.length % 2));
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    swapped[index] = bytes[index + 1];
    swapped[index + 1] = bytes[index];
  }
  return swapped;
}

/** BOM first; without one, a file whose odd (or even) bytes are mostly NUL is UTF-16. */
export function detectEncoding(bytes: Uint8Array): { encoding: CsvEncoding; bomLength: number } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', bomLength: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', bomLength: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', bomLength: 2 };
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) {
      if (index % 2 === 0) evenNulls += 1;
      else oddNulls += 1;
    }
  }
  const pairs = Math.floor(sample.length / 2);
  if (pairs > 0 && oddNulls / pairs > 0.3 && evenNulls < oddNulls / 4) return { encoding: 'utf-16le', bomLength: 0 };
  if (pairs > 0 && evenNulls / pairs > 0.3 && oddNulls < evenNulls / 4) return { encoding: 'utf-16be', bomLength: 0 };
  return { encoding: 'utf-8', bomLength: 0 };
}

export function decodeCsvBytes(input: Uint8Array | ArrayBuffer): { text: string; encoding: CsvEncoding } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { encoding, bomLength } = detectEncoding(bytes);
  const body = bytes.subarray(bomLength);
  const text = encoding === 'utf-8'
    ? new TextDecoder('utf-8').decode(body)
    : new TextDecoder('utf-16le').decode(encoding === 'utf-16be' ? swapBytes(body) : body);
  // A stray BOM can survive when a file was re-saved; drop it.
  return { text: text.replace(/^\uFEFF/, ''), encoding };
}

/** The delimiter that appears most often (outside quotes) on the first line. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char in counts) counts[char as keyof typeof counts] += 1;
  }
  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
}

/** RFC 4180 parser: quoted fields, doubled quotes, and CRLF, LF, or CR line ends. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 2; continue; }
        quoted = false;
      } else {
        field += char;
      }
      index += 1;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) endField();
    else if (char === '\r') { endRow(); if (text[index + 1] === '\n') index += 1; }
    else if (char === '\n') endRow();
    else field += char;
    index += 1;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}
