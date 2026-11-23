// src/lib/dpm-invitation/export.ts
import ExcelJS from 'exceljs';
import { formatWib } from './rules';
import type { InvitationResponse } from './types';

const HEADERS = ['Full name', 'Email', 'Attending', 'Food allergy', 'Allergy notes', 'Submissions', 'First submitted (WIB)', 'Last updated (WIB)'];
const WIDTHS = [28, 32, 11, 13, 40, 12, 24, 24];

/** Spreadsheet formula-injection guard for text cells. */
function guard(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cells(row: InvitationResponse): Array<string | number> {
  return [
    guard(row.fullName), guard(row.email), row.attending ? 'Yes' : 'No',
    row.hasAllergy === null ? '' : row.hasAllergy ? 'Yes' : 'No',
    guard(row.allergyNotes ?? ''), row.submissionCount, formatWib(row.createdAt), formatWib(row.updatedAt),
  ];
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function responsesCsv(rows: InvitationResponse[]): string {
  return '\uFEFF' + [HEADERS, ...rows.map(cells)].map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export async function responsesXlsx(rows: InvitationResponse[], sheetName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(HEADERS).font = { bold: true };
  for (const row of rows) sheet.addRow(cells(row));
  WIDTHS.forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Date part is the WIB calendar day. */
export function exportFilename(slug: string, format: 'csv' | 'xlsx', now: Date): string {
  const day = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  return `dpm-invitation-${slug}-${day}.${format}`;
}
