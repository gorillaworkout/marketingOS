/**
 * Keyword Trends Excel export (port of exporter.py, in English):
 * last N search months of one snapshot -> Summary, Detail, Column guide.
 * Percent columns are numeric fractions formatted 0.00%.
 */
import ExcelJS from 'exceljs';
import type { KeywordTrendsConfig } from './config';
import type { TrendRow } from './metrics';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Kind = 'text' | 'date' | 'int' | 'pct' | 'money' | 'bool' | 'list';
export interface ExportColumn { header: string; kind: Kind; description: string; value: (row: TrendRow) => unknown; width?: number }

export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Search month', kind: 'date', description: 'Calendar month of the search volume, stored as the first day of the month.', value: row => row.searchMonth },
  { header: 'Keyword', kind: 'text', description: 'Keyword idea returned by Google Keyword Planner.', value: row => row.keyword, width: 36 },
  { header: 'Seed keyword', kind: 'bool', description: 'Yes when the keyword is one of the seed keywords; No for expanded ideas.', value: row => row.isSeedKeyword },
  { header: 'Discovery source', kind: 'list', description: 'Which request returned the keyword: keyword (seed keywords) and/or site (dupoin.com).', value: row => row.discoverySources },
  { header: 'Word count', kind: 'int', description: 'Number of words in the keyword (split on spaces).', value: row => row.keywordWordCount },
  { header: 'Avg monthly searches', kind: 'int', description: 'Average monthly searches over the window Google returns (usually 12 months).', value: row => row.avgMonthlySearches },
  { header: 'Monthly searches', kind: 'int', description: 'Searches for the keyword in this month.', value: row => row.monthlySearches },
  { header: 'Previous month searches', kind: 'int', description: 'Searches for the keyword in the month before. Empty for the first month of the window.', value: row => row.previousMonthlySearches },
  { header: 'MoM change', kind: 'int', description: 'Monthly searches minus previous month searches.', value: row => row.momChangeAbs },
  { header: 'MoM change %', kind: 'pct', description: 'MoM change divided by previous month searches. Empty when the previous month is 0 or missing.', value: row => row.momChangePct },
  { header: 'Trend', kind: 'text', description: 'NEW (previous month 0, now above 0), RISING, FALLING, or STABLE (no change, or first month of the window).', value: row => row.trendDirection },
  { header: 'Trend index %', kind: 'pct', description: 'Monthly searches divided by avg monthly searches.', value: row => row.trendIndexPct },
  { header: 'Peak monthly searches', kind: 'int', description: 'Highest monthly searches for the keyword in the window.', value: row => row.peakMonthlySearches },
  { header: 'Share of peak %', kind: 'pct', description: 'Monthly searches divided by peak monthly searches.', value: row => row.peakSharePct },
  { header: 'Heat rank', kind: 'int', description: 'Rank of avg monthly searches in this result set, highest first (ties share a rank).', value: row => row.heatRank },
  { header: 'Heat percentile %', kind: 'pct', description: 'Share of keywords in the result set whose avg monthly searches are at or below this one (0 when the average is 0).', value: row => row.heatPercentilePct },
  { header: 'Heat level', kind: 'text', description: 'HIGH (percentile 80% and above), MEDIUM (50% and above), or LOW.', value: row => row.heatLevel },
  { header: 'Share of total avg searches %', kind: 'pct', description: 'Avg monthly searches divided by the sum of avg monthly searches of all keywords in the result set.', value: row => row.avgSearchSharePct },
  { header: 'Result set searches (month)', kind: 'int', description: 'Sum of monthly searches of all keywords in the result set for this month.', value: row => row.resultSetMonthlySearches },
  { header: 'Share of month searches %', kind: 'pct', description: 'Monthly searches divided by the result set searches for this month.', value: row => row.monthlySearchSharePct },
  { header: 'Monthly rank', kind: 'int', description: 'Rank of monthly searches among all keywords for this month, highest first (ties share a rank).', value: row => row.monthlyRank },
  { header: 'Monthly heat percentile %', kind: 'pct', description: 'Share of keywords whose searches this month are at or below this one (0 when searches are 0).', value: row => row.monthlyHeatPercentilePct },
  { header: 'Competition', kind: 'text', description: 'Competition level from Google: LOW, MEDIUM, HIGH, or UNSPECIFIED.', value: row => row.competition },
  { header: 'Competition index', kind: 'int', description: 'Competition index from Google, 0 to 100.', value: row => row.competitionIndex },
  { header: 'Top of page bid low (IDR)', kind: 'money', description: 'Low range of the top-of-page bid, converted from micros to the account currency (IDR).', value: row => row.lowTopOfPageBid },
  { header: 'Top of page bid high (IDR)', kind: 'money', description: 'High range of the top-of-page bid, converted from micros to the account currency (IDR).', value: row => row.highTopOfPageBid },
  { header: 'Bid midpoint (IDR)', kind: 'money', description: 'Midpoint of the low and high top-of-page bids.', value: row => row.bidMidpoint },
  { header: 'Bid range (IDR)', kind: 'money', description: 'High top-of-page bid minus low top-of-page bid.', value: row => row.bidRange },
  { header: 'Concepts', kind: 'list', description: 'Keyword Planner concept labels (for example Brands or Non-Brands).', value: row => row.concepts, width: 28 },
];

const FORMATS: Partial<Record<Kind, string>> = { date: 'yyyy-mm-dd', int: '#,##0', pct: '0.00%', money: '#,##0.00' };

/** Spreadsheet formula injection guard for text cells. */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Value written to the cell: percentages become fractions (12.5 -> 0.125), dates become UTC dates. */
export function cellValue(kind: Kind, value: unknown): string | number | Date | null {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'pct': return Math.round(Number(value) * 1e6) / 1e8;
    case 'int': case 'money': return Number(value);
    case 'date': return new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    case 'bool': return value ? 'Yes' : 'No';
    case 'list': return safeCell((value as unknown[]).join(', '));
    default: return safeCell(String(value));
  }
}

/** The last `months` search months present in the rows, oldest first. */
export function selectRecentMonths(rows: TrendRow[], months = 3): { rows: TrendRow[]; months: string[] } {
  if (months < 1) throw new Error('months must be at least 1');
  const selected = [...new Set(rows.map(row => row.searchMonth))].sort().slice(-months);
  const keep = new Set(selected);
  const filtered = rows.filter(row => keep.has(row.searchMonth))
    .sort((a, b) => a.searchMonth.localeCompare(b.searchMonth) || a.keyword.toLocaleLowerCase().localeCompare(b.keyword.toLocaleLowerCase()));
  return { rows: filtered, months: selected };
}

export interface ExportMeta {
  reportDate: string;
  fetchedAt: string | null;
  accountName: string;
  currencyCode: string;
  config: Pick<KeywordTrendsConfig, 'seedKeywords' | 'pageUrl' | 'marketName' | 'geoIds' | 'languageName' | 'languageId' | 'network' | 'maxIdeas'>;
}

const wib = (value: string | null) => (value ? `${new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })} WIB` : '');

export async function buildKeywordTrendsWorkbook(allRows: TrendRow[], meta: ExportMeta, months = 3): Promise<{ buffer: Buffer; months: string[]; rows: number }> {
  const { rows, months: selected } = selectRecentMonths(allRows, months);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MarketingOS';
  workbook.created = new Date();
  const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  const headerFont: Partial<ExcelJS.Font> = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  const styleHeader = (sheet: ExcelJS.Worksheet) => {
    sheet.getRow(1).eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
    sheet.getRow(1).height = 30;
    sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  };

  const summary = workbook.addWorksheet('Summary');
  summary.columns = [{ header: 'Item', key: 'item', width: 28 }, { header: 'Value', key: 'value', width: 80 }];
  const keywords = new Set(rows.map(row => row.keyword)).size;
  for (const [item, value] of [
    ['Report', 'Google Ads Keyword Planner monthly trends (MarketingOS Keyword Trends)'],
    ['Snapshot date', meta.reportDate],
    ['Fetched at', wib(meta.fetchedAt)],
    ['Google Ads account', meta.accountName],
    ['Currency', meta.currencyCode],
    ['Market', `${meta.config.marketName} (geo ${meta.config.geoIds.join(', ')})`],
    ['Language', `${meta.config.languageName} (language ${meta.config.languageId})`],
    ['Network', meta.config.network],
    ['Seed keywords', meta.config.seedKeywords.join(', ')],
    ['Page URL', meta.config.pageUrl],
    ['Max ideas', meta.config.maxIdeas],
    ['Months exported', selected.join(', ')],
    ['Number of months', selected.length],
    ['Keywords', keywords],
    ['Detail rows', rows.length],
    ['Row grain', 'One row per keyword and search month'],
  ] as Array<[string, string | number]>) summary.addRow({ item, value: typeof value === 'string' ? safeCell(value) : value });
  styleHeader(summary);

  const detail = workbook.addWorksheet('Detail');
  detail.columns = EXPORT_COLUMNS.map((column, index) => ({ header: column.header, key: `c${index}`, width: column.width ?? Math.min(Math.max(column.header.length + 2, 12), 24) }));
  for (const row of rows) detail.addRow(EXPORT_COLUMNS.map(column => cellValue(column.kind, column.value(row))));
  EXPORT_COLUMNS.forEach((column, index) => {
    const format = FORMATS[column.kind];
    if (format) detail.getColumn(index + 1).numFmt = format;
  });
  styleHeader(detail);
  detail.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(rows.length + 1, 1), column: EXPORT_COLUMNS.length } };

  const guide = workbook.addWorksheet('Column guide');
  guide.columns = [{ header: 'Column', key: 'column', width: 32 }, { header: 'Format', key: 'format', width: 14 }, { header: 'Definition', key: 'definition', width: 100 }];
  const kindLabel: Record<Kind, string> = { text: 'Text', date: 'Date', int: 'Number', pct: 'Percent', money: 'IDR', bool: 'Yes / No', list: 'List' };
  for (const column of EXPORT_COLUMNS) guide.addRow({ column: column.header, format: kindLabel[column.kind], definition: column.description });
  guide.getColumn(3).alignment = { wrapText: true, vertical: 'top' };
  styleHeader(guide);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, months: selected, rows: rows.length };
}
