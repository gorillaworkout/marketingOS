import * as XLSX from 'xlsx';
import type { GapKeyword } from './keyword-gap-bucket';

const HEADERS = ['Keyword', 'Bucket', 'Intent', 'Our position', 'Our clicks', 'Our impressions', 'Competitor position', 'Volume', 'Competitors'];

function blank(value: number | null): number | string {
  return value === null ? '—' : value;
}

function cell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function gapRows(keywords: GapKeyword[]): Array<Array<string | number>> {
  return [
    HEADERS,
    ...keywords.map(keyword => [
      cell(keyword.keyword),
      keyword.bucket,
      keyword.intent ?? '—',
      blank(keyword.ourPosition),
      blank(keyword.ourClicks),
      blank(keyword.ourImpressions),
      blank(keyword.competitorPosition),
      blank(keyword.volume),
      cell(keyword.competitors.join(', ')),
    ]),
  ];
}

export function gapsToCsv(keywords: GapKeyword[]): string {
  return gapRows(keywords).map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
}

export function gapsToXlsx(keywords: GapKeyword[]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(gapRows(keywords)), 'Keywords');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
