import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/** HTML uploads may be up to 10 MB. */
export const AI_RESEARCH_MAX_HTML_BYTES = 10 * 1024 * 1024;
export const HTML_MAX_TABLES = 50;
export const HTML_MAX_TABLE_ROWS = 5_000;
export const HTML_MAX_TABLE_COLUMNS = 100;
export const HTML_MAX_CELL_CHARS = 2_000;

export interface HtmlTable {
  /** Human-readable name from <caption>, the nearest heading, or "Table N". */
  name: string;
  /** First row is the header row. */
  rows: string[][];
}

export interface HtmlExtraction {
  title: string;
  text: string;
  tables: HtmlTable[];
}

/** Elements removed outright: active content, styling, and embedded objects. */
const STRIP_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset',
  'object', 'embed', 'applet', 'link', 'meta', 'base', 'svg', 'math', 'canvas',
  'form', 'input', 'button', 'select', 'textarea',
].join(',');

const BLOCK_SELECTOR = [
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'ul', 'tr', 'caption',
].join(',');

const UNSAFE_URL = /^\s*(javascript|vbscript|data):/i;
export const SAFE_IMAGE_DATA_URL = /^\s*data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;

function looksLikeUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  if (sample.length < 8) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] !== 0) continue;
    if (index % 2 === 0) evenZeros += 1;
    else oddZeros += 1;
  }
  const half = sample.length / 2;
  if (oddZeros > half * 0.6 && evenZeros < half * 0.1) return 'utf-16le';
  if (evenZeros > half * 0.6 && oddZeros < half * 0.1) return 'utf-16be';
  return null;
}

// Windows-1252 0x80-0x9F (undefined bytes keep their C1 code point).
const CP1252_HIGH = '\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F'
  + '\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178';

/** Node's TextDecoder treats windows-1252 as plain Latin-1, so decode it by hand. */
function decodeWindows1252(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    out += byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte);
  }
  return out;
}

function declaredCharset(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString('latin1');
  const match = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)/i);
  if (!match) return null;
  try {
    return new TextDecoder(match[1].toLowerCase()).encoding;
  } catch {
    return null;
  }
}

/**
 * Decode an uploaded HTML file. Honors a BOM (UTF-8/UTF-16), detects BOM-less
 * UTF-16, and uses UTF-8 when the bytes are valid UTF-8. Otherwise it uses the
 * <meta charset> (e.g. Excel/Word "Save as Web Page" files in windows-1252),
 * falling back to windows-1252.
 */
export function decodeHtmlBytes(bytes: Uint8Array): string {
  let encoding: string | null = null;
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'utf-8';
    start = 3;
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    start = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    start = 2;
  } else {
    encoding = looksLikeUtf16(bytes);
  }
  const body = bytes.subarray(start);
  if (encoding) return new TextDecoder(encoding, { fatal: false }).decode(body).replace(/^\uFEFF/, '');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body).replace(/^\uFEFF/, '');
  } catch {
    const declared = declaredCharset(body);
    const legacy = declared && !/^utf-(8|16)/.test(declared) ? declared : 'windows-1252';
    // WHATWG maps latin1/iso-8859-1/ascii labels to windows-1252 too.
    if (legacy === 'windows-1252') return decodeWindows1252(body);
    return new TextDecoder(legacy, { fatal: false }).decode(body);
  }
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t\f\v\r]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function cellText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, HTML_MAX_CELL_CHARS);
}

/**
 * Remove scripts, styles, embedded objects, every on* handler, and
 * javascript:/vbscript:/data: URLs. Returns a cheerio document for further work.
 */
export function loadSanitizedHtml(html: string): cheerio.CheerioAPI {
  const $ = cheerio.load(html);
  $(STRIP_SELECTOR).remove();
  $('*').contents().filter((_, node) => node.type === 'comment').remove();
  $('*').each((_, node) => {
    const element = node as Element;
    for (const name of Object.keys(element.attribs || {})) {
      const lower = name.toLowerCase();
      const value = element.attribs[name] || '';
      if (lower.startsWith('on') || lower === 'style' || lower === 'srcdoc') {
        $(element).removeAttr(name);
      } else if ((lower === 'href' || lower === 'src' || lower === 'action' || lower === 'formaction' || lower === 'xlink:href') && UNSAFE_URL.test(value)) {
        // Embedded raster images stay so PDF and Word conversion can render them.
        const embeddedImage = lower === 'src' && element.tagName?.toLowerCase() === 'img' && SAFE_IMAGE_DATA_URL.test(value);
        if (!embeddedImage) $(element).removeAttr(name);
      }
    }
  });
  return $;
}

/** Sanitized HTML string (scripts, styles, and on* handlers removed). */
export function sanitizeHtml(html: string): string {
  return loadSanitizedHtml(html).html() || '';
}

function nearestHeading($: cheerio.CheerioAPI, table: Element): string {
  let node: AnyNode | null = table;
  for (let depth = 0; node && depth < 6; depth += 1) {
    let previous: AnyNode | null = (node as Element).prev ?? null;
    let hops = 0;
    while (previous && hops < 8) {
      if (previous.type === 'tag') {
        const tag = (previous as Element).tagName?.toLowerCase();
        if (tag && /^h[1-6]$/.test(tag)) return cellText($(previous).text());
        const inner = $(previous).find('h1,h2,h3,h4,h5,h6').last();
        if (inner.length) return cellText(inner.text());
        if (tag === 'table') return '';
      }
      previous = (previous as Element).prev ?? null;
      hops += 1;
    }
    node = (node as Element).parent ?? null;
  }
  return '';
}

export function tableRows($: cheerio.CheerioAPI, table: Element): string[][] {
  const rows: string[][] = [];
  const pending: Array<{ text: string; remaining: number } | undefined> = [];
  const rowElements = $(table).find('tr').filter((_, tr) => $(tr).closest('table')[0] === table);
  rowElements.each((_, tr) => {
    if (rows.length >= HTML_MAX_TABLE_ROWS) return false;
    const row: string[] = [];
    let column = 0;
    const fillPending = () => {
      while (pending[column] && pending[column]!.remaining > 0) {
        row.push(pending[column]!.text);
        pending[column]!.remaining -= 1;
        column += 1;
      }
    };
    $(tr).children('th,td').each((__, cell) => {
      fillPending();
      const text = cellText($(cell).text());
      const colspan = Math.min(Math.max(Number($(cell).attr('colspan')) || 1, 1), HTML_MAX_TABLE_COLUMNS);
      const rowspan = Math.min(Math.max(Number($(cell).attr('rowspan')) || 1, 1), HTML_MAX_TABLE_ROWS);
      for (let span = 0; span < colspan; span += 1) {
        row.push(span === 0 ? text : '');
        if (rowspan > 1) pending[column] = { text: '', remaining: rowspan - 1 };
        column += 1;
      }
    });
    fillPending();
    const trimmed = row.slice(0, HTML_MAX_TABLE_COLUMNS);
    if (trimmed.some(cell => cell)) rows.push(trimmed);
    return undefined;
  });
  const width = Math.max(0, ...rows.map(row => row.length));
  return rows.map(row => Array.from({ length: width }, (_, index) => row[index] ?? ''));
}

/** Every <table> with at least one non-empty cell, outermost first in document order. */
export function extractHtmlTables(input: string | cheerio.CheerioAPI): HtmlTable[] {
  const $ = typeof input === 'string' ? loadSanitizedHtml(input) : input;
  const tables: HtmlTable[] = [];
  $('table').each((_, node) => {
    if (tables.length >= HTML_MAX_TABLES) return false;
    const table = node as Element;
    const rows = tableRows($, table);
    if (!rows.length) return undefined;
    const caption = cellText($(table).children('caption').first().text());
    const label = cellText($(table).attr('aria-label') || $(table).attr('summary') || '');
    const name = caption || label || nearestHeading($, table) || `Table ${tables.length + 1}`;
    tables.push({ name: name.slice(0, 120), rows });
    return undefined;
  });
  return tables;
}

function markdownTable(rows: string[][], maxRows = 250): string {
  const escape = (value: string) => value.replace(/\|/g, '\\|');
  const limited = rows.slice(0, maxRows);
  const [header, ...body] = limited;
  if (!header) return '';
  const lines = [
    `| ${header.map(escape).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.map(escape).join(' | ')} |`),
  ];
  if (rows.length > limited.length) lines.push(`… ${rows.length - limited.length} more rows omitted`);
  return lines.join('\n');
}

/** Sanitize the HTML and return its title, readable text (tables as Markdown), and tables. */
export function extractHtmlContent(html: string): HtmlExtraction {
  const $ = loadSanitizedHtml(html);
  const title = cellText($('title').first().text());
  const tables = extractHtmlTables($);

  let tableIndex = 0;
  $('table').each((_, node) => {
    const table = node as Element;
    if ($(table).parents('table').length) return;
    const extracted = tables[tableIndex];
    tableIndex += 1;
    const block = extracted
      ? `\n\nTable ${tableIndex}: ${extracted.name}\n${markdownTable(extracted.rows)}\n\n`
      : '\n';
    $(table).replaceWith(`<pre data-table="1">${escapeForHtml(block)}</pre>`);
  });
  $('title, head').remove();
  $('br').replaceWith('\n');
  $(BLOCK_SELECTOR).each((_, element) => {
    $(element).prepend('\n');
    $(element).append('\n');
  });
  const raw = $.root().text();
  const text = raw
    .split(/\n{2,}/)
    .map(paragraph => paragraph.includes('| ---') ? paragraph.trim() : cleanText(paragraph))
    .filter(Boolean)
    .join('\n\n');
  return { title, text, tables };
}

function escapeForHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Text the research model sees for one HTML upload. */
export function formatHtmlForResearch(extraction: HtmlExtraction): string {
  const lines: string[] = [];
  if (extraction.title) lines.push(`Page title: ${extraction.title}`);
  if (extraction.tables.length) {
    lines.push(`Tables detected: ${extraction.tables.length} (${extraction.tables.map(table => table.name).join('; ')})`);
  }
  lines.push(extraction.text || '(no readable text)');
  return lines.join('\n\n');
}

export function extractHtmlBytes(bytes: Uint8Array): HtmlExtraction {
  return extractHtmlContent(decodeHtmlBytes(bytes));
}
