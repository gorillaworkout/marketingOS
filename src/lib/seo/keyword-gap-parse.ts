import { readSheetRows } from '@/lib/monthly-report/xlsx-read';
import { normalizePhrase, type OurKeyword } from './keyword-gap-bucket';

const QUERY_HEADERS = ['query', 'queries', 'top queries', 'search query', 'keyword'];
const CLICK_HEADERS = ['clicks', 'click'];
const IMPRESSION_HEADERS = ['impressions', 'impression'];
const CTR_HEADERS = ['ctr', 'click through rate'];
const POSITION_HEADERS = ['position', 'average position', 'avg position'];

function headerIndex(header: unknown[], names: string[]): number {
  const cells = header.map(cell => String(cell ?? '').trim().toLowerCase());
  return cells.findIndex(cell => names.includes(cell));
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!text || text === '—' || text === '-') return null;
  const parsed = Number(text.replace('%', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function ctrValue(value: unknown): number | null {
  const text = String(value ?? '').trim();
  const parsed = numberValue(value);
  if (parsed === null) return null;
  if (text.includes('%') || parsed > 1) return parsed / 100;
  return parsed;
}

export function parseGscQueryRows(rows: unknown[][]): { keywords: OurKeyword[]; error: string | null } {
  let headerAt = -1;
  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const row = rows[index] ?? [];
    if (headerIndex(row, QUERY_HEADERS) >= 0 && (headerIndex(row, CLICK_HEADERS) >= 0 || headerIndex(row, POSITION_HEADERS) >= 0)) {
      headerAt = index;
      break;
    }
  }
  if (headerAt < 0) return { keywords: [], error: 'The file needs a Queries export with query, clicks, impressions, CTR, and position columns.' };
  const header = rows[headerAt] ?? [];
  const queryAt = headerIndex(header, QUERY_HEADERS);
  const clicksAt = headerIndex(header, CLICK_HEADERS);
  const impressionsAt = headerIndex(header, IMPRESSION_HEADERS);
  const ctrAt = headerIndex(header, CTR_HEADERS);
  const positionAt = headerIndex(header, POSITION_HEADERS);
  const keywords: OurKeyword[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(headerAt + 1)) {
    const query = String(row?.[queryAt] ?? '').replace(/\s+/g, ' ').trim();
    const key = normalizePhrase(query);
    if (!key || key === 'query' || seen.has(key)) continue;
    seen.add(key);
    keywords.push({
      query,
      clicks: Math.max(0, Math.round(numberValue(clicksAt >= 0 ? row?.[clicksAt] : 0) ?? 0)),
      impressions: Math.max(0, Math.round(numberValue(impressionsAt >= 0 ? row?.[impressionsAt] : 0) ?? 0)),
      ctr: ctrAt >= 0 ? ctrValue(row?.[ctrAt]) : null,
      position: positionAt >= 0 ? numberValue(row?.[positionAt]) : null,
    });
    if (keywords.length >= 2000) break;
  }
  if (!keywords.length) return { keywords: [], error: 'The export has headers but no query rows.' };
  return { keywords, error: null };
}

export function parseGscQueryFile(buffer: Buffer): { keywords: OurKeyword[]; error: string | null } {
  const sheet = readSheetRows(buffer);
  return parseGscQueryRows(sheet.rows);
}
