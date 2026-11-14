import * as XLSX from 'xlsx';
import type { CrawledPage } from './audit-types';

const HEADERS = ['URL', 'Status', 'Title', 'Word count', 'Depth', 'Issues'];

function cell(value: string | number): string | number {
  if (typeof value === 'number') return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function pageRows(pages: CrawledPage[]): Array<Array<string | number>> {
  return [
    HEADERS,
    ...pages.map(page => [
      cell(page.url),
      page.status,
      cell(page.title),
      page.wordCount,
      page.depth,
      page.issueCount,
    ]),
  ];
}

export function pagesToCsv(pages: CrawledPage[]): string {
  return pageRows(pages).map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
}

export function pagesToXlsx(pages: CrawledPage[]): Buffer {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(pageRows(pages));
  XLSX.utils.book_append_sheet(book, sheet, 'Pages');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
