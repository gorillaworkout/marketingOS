import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { internalDocImagePath, safeDocumentUrl, sanitizeDocumentHtml } from './internal-docs-reader';

const docxHtmlOptions = {
  ignoreEmptyParagraphs: true,
  externalFileAccess: false,
  convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
};

const MAX_EXTRACTED_CHARS = 400_000;
const MAX_DOCX_IMAGE_BYTES = 2_000_000;
const NO_TEXT = 'No extractable text. Scanned or image-only PDFs are not supported.';
const DOCX_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface DocxImage {
  contentType: string;
  bytes: Uint8Array;
}

async function acceptedDocxImage(image: { contentType: string; read: () => Promise<Buffer> }): Promise<DocxImage | null> {
  try {
    const contentType = (image.contentType || '').toLowerCase();
    if (!DOCX_IMAGE_TYPES.has(contentType)) return null;
    const bytes = await image.read();
    if (!bytes?.byteLength || bytes.byteLength > MAX_DOCX_IMAGE_BYTES) return null;
    return { contentType, bytes: new Uint8Array(bytes) };
  } catch {
    return null;
  }
}

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

function hyperlinkUrls(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    const href = safeDocumentUrl(match[1] || match[2] || '');
    if (href && !found.includes(href)) found.push(href);
  }
  return found;
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes);
  const raw = await mammoth.extractRawText({ buffer });
  let links: string[] = [];
  try {
    const html = await mammoth.convertToHtml({ buffer }, docxHtmlOptions);
    links = hyperlinkUrls(html.value || '').filter(href => !(raw.value || '').includes(href));
  } catch {
    links = [];
  }
  const combined = links.length ? `${raw.value || ''}\n\n${links.join('\n')}` : (raw.value || '');
  return capText(combined);
}

/** Images in the same order the reader and the image route will request them. */
export async function collectDocxImages(bytes: Uint8Array): Promise<DocxImage[]> {
  const images: DocxImage[] = [];
  await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, {
    externalFileAccess: false,
    convertImage: mammoth.images.imgElement(async image => {
      const accepted = await acceptedDocxImage(image);
      if (accepted) images.push(accepted);
      return { src: '' };
    }),
  });
  return images;
}

/** Word HTML for the reader. Hyperlinks stay; images point at the authenticated image route. */
export async function docxPreviewHtml(bytes: Uint8Array, documentId = ''): Promise<string> {
  const canLink = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId);
  let index = 0;
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, {
    ignoreEmptyParagraphs: true,
    externalFileAccess: false,
    convertImage: mammoth.images.imgElement(async image => {
      const accepted = await acceptedDocxImage(image);
      if (!accepted || !canLink) return { src: '' };
      const src = internalDocImagePath(documentId, index);
      index += 1;
      return { src };
    }),
  });
  return sanitizeDocumentHtml(result.value || '');
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
