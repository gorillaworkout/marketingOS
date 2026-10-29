import { rowsToCsv } from '@/lib/ai-research-csv';
import { parseCsv } from './csv';

export const KEYWORD_INTENTS = ['informational', 'commercial', 'transactional', 'navigational'] as const;
export type KeywordIntent = typeof KEYWORD_INTENTS[number];

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
export const MAX_KEYWORD_LENGTH = 200;
export const MAX_URL_LENGTH = 1000;
export const KEYWORD_CSV_HEADER = ['keyword', 'target_page_url', 'intent'] as const;

export interface KeywordInput { keyword: string; normalized: string; targetPageUrl: string | null; intent: KeywordIntent | null }
export interface ImportIssue { row: number; message: string }
export interface KeywordCsvResult { rows: KeywordInput[]; errors: ImportIssue[]; duplicates: number; dataRows: number }

const INTENT_ALIASES: Record<string, KeywordIntent> = {
  informational: 'informational', info: 'informational', i: 'informational',
  commercial: 'commercial', comm: 'commercial', c: 'commercial',
  transactional: 'transactional', trans: 'transactional', t: 'transactional',
  navigational: 'navigational', nav: 'navigational', n: 'navigational',
};

const HEADER_ALIASES: Record<string, keyof typeof COLUMN> = {
  keyword: 'keyword', keywords: 'keyword', query: 'keyword', 'search term': 'keyword',
  target_page_url: 'target', 'target page url': 'target', 'target url': 'target', target_url: 'target', url: 'target', page: 'target', 'target page': 'target',
  intent: 'intent', 'search intent': 'intent',
};
const COLUMN = { keyword: 0, target: 1, intent: 2 };

/** Undo the apostrophe a formula-safe export puts in front of =, +, -, @. */
function stripFormulaGuard(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

function clean(value: string | undefined): string {
  return stripFormulaGuard((value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim());
}

/** Lowercase and collapse whitespace; Search Console reports queries this way. */
export function normalizeKeyword(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeIntent(value: string): KeywordIntent | null | undefined {
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return INTENT_ALIASES[key];
}

/** Hostname root a site's pages may live on (sc-domain covers subdomains). */
export function siteRootHost(siteUrl: string, gscProperty?: string | null): string | null {
  if (gscProperty?.startsWith('sc-domain:')) return gscProperty.slice('sc-domain:'.length).toLowerCase();
  try { return new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/** null for empty, a normalized URL when valid, or an error message. */
export function validateTargetUrl(value: string, rootHost: string | null): { url: string | null } | { error: string } {
  if (!value) return { url: null };
  if (value.length > MAX_URL_LENGTH) return { error: `Target page URL is longer than ${MAX_URL_LENGTH} characters` };
  let parsed: URL;
  try { parsed = new URL(value); } catch { return { error: 'Target page URL is not a valid URL' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'Target page URL must start with http:// or https://' };
  const host = parsed.hostname.toLowerCase();
  if (rootHost && host !== rootHost && !host.endsWith(`.${rootHost}`)) return { error: `Target page URL is not on ${rootHost}` };
  parsed.hash = '';
  return { url: parsed.toString() };
}

function headerMap(cells: string[]): Record<keyof typeof COLUMN, number> | null {
  const mapped: Partial<Record<keyof typeof COLUMN, number>> = {};
  cells.forEach((cell, index) => {
    const name = HEADER_ALIASES[clean(cell).toLowerCase().replace(/\s+/g, ' ')];
    if (name && mapped[name] === undefined) mapped[name] = index;
  });
  if (mapped.keyword === undefined) return null;
  return { keyword: mapped.keyword, target: mapped.target ?? -1, intent: mapped.intent ?? -1 };
}

/**
 * Validates a keyword CSV. A header row is optional (keyword, target_page_url,
 * intent; common aliases accepted); without one, columns are read in that
 * order. Blank rows are ignored, the first occurrence of a keyword wins, and
 * each problem is reported with its 1-based row number.
 */
export function parseKeywordCsv(text: string, options: { rootHost: string | null }): KeywordCsvResult {
  const table = parseCsv(text);
  const errors: ImportIssue[] = [];
  const rows: KeywordInput[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let dataRows = 0;
  if (!table.length) return { rows, errors: [{ row: 0, message: 'The file is empty' }], duplicates, dataRows };

  const header = headerMap(table[0]);
  const columns = header ?? COLUMN;
  const start = header ? 1 : 0;

  for (let index = start; index < table.length; index += 1) {
    const cells = table[index];
    const rowNumber = index + 1;
    if (cells.every(cell => !clean(cell))) continue;
    dataRows += 1;
    if (dataRows > MAX_IMPORT_ROWS) {
      errors.push({ row: rowNumber, message: `Only the first ${MAX_IMPORT_ROWS} keywords are imported per file` });
      break;
    }
    const keyword = clean(cells[columns.keyword]).replace(/\s+/g, ' ');
    const normalized = normalizeKeyword(keyword);
    if (!normalized) { errors.push({ row: rowNumber, message: 'Keyword is empty' }); continue; }
    if (normalized.length > MAX_KEYWORD_LENGTH) { errors.push({ row: rowNumber, message: `Keyword is longer than ${MAX_KEYWORD_LENGTH} characters` }); continue; }

    const target = validateTargetUrl(columns.target >= 0 ? clean(cells[columns.target]) : '', options.rootHost);
    if ('error' in target) { errors.push({ row: rowNumber, message: target.error }); continue; }

    const intentRaw = columns.intent >= 0 ? clean(cells[columns.intent]) : '';
    const intent = normalizeIntent(intentRaw);
    if (intent === undefined) { errors.push({ row: rowNumber, message: `Intent must be one of ${KEYWORD_INTENTS.join(', ')}` }); continue; }

    if (seen.has(normalized)) { duplicates += 1; continue; }
    seen.add(normalized);
    rows.push({ keyword, normalized, targetPageUrl: target.url, intent });
  }
  return { rows, errors, duplicates, dataRows };
}

export interface KeywordRow { keyword: string; target_page_url: string | null; intent: string | null }

/** Export with the import header, so a downloaded file can be edited and re-imported. Formula-safe. */
export function keywordsToCsv(rows: KeywordRow[]): string {
  return rowsToCsv([[...KEYWORD_CSV_HEADER], ...rows.map(row => [row.keyword, row.target_page_url ?? '', row.intent ?? ''])]);
}
