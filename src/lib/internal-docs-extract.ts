import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

const MAX_EXTRACTED_CHARS = 400_000;
const NO_TEXT = 'No extractable text. Scanned or image-only PDFs are not supported.';

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function capText(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= MAX_EXTRACTED_CHARS) return normalized;
  return `${normalized.slice(0, MAX_EXTRACTED_CHARS)}\n\n[Text truncated for indexing.]`;
}

export function extractPlainText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
  return capText(text);
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text ?? '')];
  const sections = pages.map((page, index) => {
    const body = normalizeWhitespace(String(page ?? ''));
    return body ? `Page ${index + 1}\n${body}` : '';
  }).filter(Boolean);
  return capText(sections.join('\n\n'));
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes);
  const raw = await mammoth.extractRawText({ buffer });
  return capText(raw.value || '');
}

export async function extractInternalDocText(bytes: Uint8Array, ext: string): Promise<string> {
  if (ext === '.txt' || ext === '.md') return extractPlainText(bytes);
  if (ext === '.pdf') return extractPdfText(bytes);
  if (ext === '.docx') return extractDocxText(bytes);
  throw new Error('Unsupported file type. Use PDF, DOCX, MD, or TXT.');
}

export function extractedTextIsUsable(text: string): boolean {
  const body = text.replace(/\[Text truncated for indexing\.\]/g, '').trim();
  return body.length >= 1 && body !== NO_TEXT;
}

export const INTERNAL_DOC_NO_TEXT_ERROR = NO_TEXT;
