import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { readSheetRows } from '@/lib/monthly-report/xlsx-read';

const TEXT_MAX = 12_000;

export function quotationExtension(fileName: string, mime: string): string | null {
  const name = fileName.toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime.includes('wordprocessingml') || name.endsWith('.docx')) return 'docx';
  if (mime.includes('spreadsheetml') || name.endsWith('.xlsx')) return 'xlsx';
  if (mime === 'text/csv' || mime === 'application/csv' || name.endsWith('.csv')) return 'csv';
  if (mime === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpg';
  if (mime === 'image/png' || name.endsWith('.png')) return 'png';
  return null;
}

export async function extractQuotationDocumentText(bytes: Buffer, extension: string): Promise<string> {
  if (extension === 'pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const extracted = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(extracted.text) ? extracted.text : [String(extracted.text || '')];
    return clip(pages.join('\n'));
  }
  if (extension === 'docx') {
    const result = await mammoth.extractRawText({ buffer: bytes });
    return clip(result.value || '');
  }
  const sheet = readSheetRows(bytes, undefined, { maxRows: 80 });
  const text = sheet.rows.map(row => row.map(cell => String(cell ?? '')).join('\t')).join('\n');
  return clip(text);
}

function clip(value: string): string {
  return value.replace(/\u0000/g, '').trim().slice(0, TEXT_MAX);
}
