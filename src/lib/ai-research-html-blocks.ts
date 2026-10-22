import type * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { SAFE_IMAGE_DATA_URL, loadSanitizedHtml, tableRows } from './ai-research-html';

/** Formatted inline text inside a block. */
export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
  href?: string;
}

export type ImageFormat = 'png' | 'jpeg' | 'gif';

export type HtmlBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; runs: InlineRun[] }
  | { type: 'paragraph'; runs: InlineRun[] }
  | { type: 'list-item'; ordered: boolean; depth: number; index: number; listId: number; runs: InlineRun[] }
  | { type: 'quote'; runs: InlineRun[] }
  | { type: 'pre'; text: string }
  | { type: 'table'; rows: string[][]; header: boolean }
  | { type: 'image'; data: Buffer; format: ImageFormat; width: number; height: number; alt: string }
  | { type: 'image-placeholder'; alt: string }
  | { type: 'rule' };

export interface HtmlDocumentModel {
  title: string;
  blocks: HtmlBlock[];
}

export const MAX_EMBEDDED_IMAGES = 30;
export const MAX_EMBEDDED_IMAGE_BYTES = 5 * 1024 * 1024;

const CONTAINER_TAGS = new Set([
  'html', 'body', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside',
  'figure', 'figcaption', 'address', 'center', 'details', 'summary', 'dl', 'dt', 'dd', 'p',
  'fieldset', 'legend', 'hgroup', 'caption',
]);
const SKIP_TAGS = new Set(['head', 'title', 'colgroup', 'col', 'area', 'map', 'track', 'source', 'audio', 'video', 'picture']);

/** Width and height from PNG, JPEG, or GIF headers; null for anything else. */
export function readImageSize(data: Buffer): { format: ImageFormat; width: number; height: number } | null {
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.toString('ascii', 12, 16) === 'IHDR') {
    return { format: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 10 && data.toString('ascii', 0, 3) === 'GIF') {
    return { format: 'gif', width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1];
      const length = data.readUInt16BE(offset + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        return { format: 'jpeg', height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      }
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}

function decodeDataImage(src: string): { data: Buffer; format: ImageFormat; width: number; height: number } | null {
  if (!SAFE_IMAGE_DATA_URL.test(src)) return null;
  const base64 = src.slice(src.indexOf(',') + 1).replace(/\s/g, '');
  if (base64.length * 0.75 > MAX_EMBEDDED_IMAGE_BYTES) return null;
  const data = Buffer.from(base64, 'base64');
  const size = readImageSize(data);
  if (!size || size.width <= 0 || size.height <= 0 || size.width > 20_000 || size.height > 20_000) return null;
  return { data, ...size };
}

function safeHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed.slice(0, 2_000) : undefined;
}

type Marks = Omit<InlineRun, 'text'>;

function hasText(runs: InlineRun[]): boolean {
  return runs.some(run => run.text.trim().length > 0);
}

function tidyRuns(runs: InlineRun[]): InlineRun[] {
  const merged: InlineRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline && last.code === run.code && last.href === run.href) {
      last.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  const collapsed = merged.map(run => ({ ...run, text: run.text.replace(/[ \t\r\f\v]*\n[ \t\r\f\v]*/g, '\n').replace(/[ \t\r\f\v]+/g, ' ') }));
  if (collapsed.length) {
    collapsed[0].text = collapsed[0].text.replace(/^\s+/, '');
    const end = collapsed[collapsed.length - 1];
    end.text = end.text.replace(/\s+$/, '');
  }
  return collapsed.filter(run => run.text.length > 0);
}

/**
 * Turn sanitized HTML into ordered blocks (headings, paragraphs, lists,
 * tables, embedded images) for the PDF and Word converters.
 * Remote images are never fetched; they become an "[Image: alt]" placeholder.
 */
export function htmlToBlocks(input: string | cheerio.CheerioAPI): HtmlDocumentModel {
  const $ = typeof input === 'string' ? loadSanitizedHtml(input) : input;
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  const blocks: HtmlBlock[] = [];
  let runs: InlineRun[] = [];
  let imageCount = 0;
  let listCounter = 0;
  type ListContext = { ordered: boolean; depth: number; index: number; listId: number };
  let currentItem: ListContext | null = null;
  let quote = false;

  const flush = () => {
    const tidy = tidyRuns(runs);
    runs = [];
    if (!hasText(tidy)) return;
    if (currentItem) {
      blocks.push({ type: 'list-item', ordered: currentItem.ordered, depth: currentItem.depth, index: currentItem.index, listId: currentItem.listId, runs: tidy });
    } else if (quote) {
      blocks.push({ type: 'quote', runs: tidy });
    } else {
      blocks.push({ type: 'paragraph', runs: tidy });
    }
  };

  const walk = (node: AnyNode, marks: Marks, listDepth: number) => {
    if (node.type === 'text') {
      const text = (node as unknown as { data: string }).data;
      if (text) runs.push({ ...marks, text });
      return;
    }
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') {
      if ((node as Element).children) (node as Element).children.forEach(child => walk(child, marks, listDepth));
      return;
    }
    const element = node as Element;
    const tag = element.tagName?.toLowerCase() || '';
    if (SKIP_TAGS.has(tag)) return;
    const children = () => element.children.forEach(child => walk(child, marks, listDepth));

    if (/^h[1-6]$/.test(tag)) {
      flush();
      const saved = runs;
      runs = [];
      element.children.forEach(child => walk(child, { ...marks, bold: true }, listDepth));
      const tidy = tidyRuns(runs);
      runs = saved;
      if (hasText(tidy)) blocks.push({ type: 'heading', level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, runs: tidy });
      return;
    }
    if (tag === 'br') {
      runs.push({ ...marks, text: '\n' });
      return;
    }
    if (tag === 'hr') {
      flush();
      blocks.push({ type: 'rule' });
      return;
    }
    if (tag === 'table') {
      flush();
      const rows = tableRows($, element);
      if (rows.length) {
        const firstRow = $(element).find('tr').filter((_, tr) => $(tr).closest('table')[0] === element).first();
        const header = $(element).children('thead').length > 0 || firstRow.children('th').length > 0;
        blocks.push({ type: 'table', rows, header });
      }
      return;
    }
    if (tag === 'img') {
      const alt = ($(element).attr('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const src = $(element).attr('src') || '';
      const image = imageCount < MAX_EMBEDDED_IMAGES ? decodeDataImage(src) : null;
      flush();
      if (image) {
        imageCount += 1;
        blocks.push({ type: 'image', ...image, alt });
      } else if (alt) {
        blocks.push({ type: 'image-placeholder', alt });
      }
      return;
    }
    if (tag === 'pre') {
      flush();
      const text = $(element).text().replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '');
      if (text) blocks.push({ type: 'pre', text: text.slice(0, 20_000) });
      return;
    }
    if (tag === 'ul' || tag === 'ol' || tag === 'menu') {
      flush();
      const savedItem = currentItem;
      listCounter += 1;
      const listId = listCounter;
      let index = Number($(element).attr('start')) || 1;
      element.children.forEach(child => {
        if (child.type === 'tag' && (child as Element).tagName?.toLowerCase() === 'li') {
          currentItem = { ordered: tag === 'ol', depth: listDepth, index, listId };
          (child as Element).children.forEach(grand => walk(grand, marks, listDepth + 1));
          flush();
          currentItem = savedItem;
          index += 1;
        } else {
          walk(child, marks, listDepth);
        }
      });
      currentItem = savedItem;
      return;
    }
    if (tag === 'blockquote') {
      flush();
      const saved = quote;
      quote = true;
      children();
      flush();
      quote = saved;
      return;
    }
    if (CONTAINER_TAGS.has(tag) || tag === 'li') {
      flush();
      children();
      flush();
      return;
    }
    let next = marks;
    if (tag === 'b' || tag === 'strong') next = { ...marks, bold: true };
    else if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn' || tag === 'var') next = { ...marks, italic: true };
    else if (tag === 'u' || tag === 'ins') next = { ...marks, underline: true };
    else if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') next = { ...marks, code: true };
    else if (tag === 'a') {
      const href = safeHref($(element).attr('href'));
      if (href) next = { ...marks, href };
    }
    element.children.forEach(child => walk(child, next, listDepth));
  };

  const root = $('body').length ? $('body')[0] : $.root()[0];
  (root as Element).children?.forEach(child => walk(child, {}, 0));
  flush();
  return { title, blocks };
}

export function runsText(runs: InlineRun[]): string {
  return runs.map(run => run.text).join('');
}
