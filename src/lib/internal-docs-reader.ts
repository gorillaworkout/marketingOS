/**
 * Turn FAQ & Guides text and Word HTML into a safe reading view.
 * Only http(s) URLs become links. Markup from uploaded files is allowlisted.
 */

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'break' }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'link'; text: string; href: string };

export type DocumentBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'quote'; children: InlineNode[] }
  | { type: 'code'; text: string };

const ALLOWED_TAGS = new Set([
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'a', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'sup', 'sub', 'img',
]);

const INTERNAL_DOC_IMAGE_PATH = /^\/api\/internal-docs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/images\/\d{1,2}$/i;

const TAG_RE = /<\/([a-zA-Z][a-zA-Z0-9]*)\s*>|<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;

const INLINE_RE = /(`[^`\n]+`)|(\*\*([^*]+)\*\*)|(\*([^*\n]+)\*)|\[([^\]\n]+)\]\(([^)\s]+)\)|(<(https?:\/\/[^>\s]+)>)|(https?:\/\/[^\s<>"']+)/g;

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function safeDocumentUrl(raw: string): string | null {
  const decoded = decodeBasicEntities(raw).trim().replace(/[\u0000-\u001f]+/g, '');
  if (!decoded || decoded.length > 2000 || /\s/.test(decoded) || decoded.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.toString();
}

export function trimUrlTail(value: string): string {
  let next = value;
  while (/[.,;:!?]$/.test(next)) next = next.slice(0, -1);
  let opens = 0;
  let closes = 0;
  for (const char of next) {
    if (char === '(') opens += 1;
    else if (char === ')') closes += 1;
  }
  while (closes > opens && next.endsWith(')')) {
    next = next.slice(0, -1);
    closes -= 1;
  }
  return next;
}

function escapeText(value: string): string {
  return value
    .replace(/&(?![a-zA-Z]+;|#\d+;|#x[\da-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readAttr(source: string, name: string): string | null {
  const match = source.match(new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\\`]+))`,
    'i',
  ));
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function anchor(href: string, text: string): string {
  return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeText(text)}</a>`;
}

function appendLinkedText(raw: string, stack: string[], write: (chunk: string) => void) {
  if (stack.includes('a') || stack.includes('code') || stack.includes('pre')) {
    write(escapeText(raw));
    return;
  }
  let last = 0;
  for (const match of raw.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const index = match.index ?? 0;
    write(escapeText(raw.slice(last, index)));
    const trimmed = trimUrlTail(match[0]);
    const href = safeDocumentUrl(trimmed);
    const tail = match[0].slice(trimmed.length);
    if (href) {
      write(anchor(href, trimmed));
      if (tail) write(escapeText(tail));
    } else {
      write(escapeText(match[0]));
    }
    last = index + match[0].length;
  }
  write(escapeText(raw.slice(last)));
}

export function sanitizeDocumentHtml(html: string): string {
  const prepared = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<![^>]*>/g, '')
    .replace(/<\?[^>]*>/g, '');

  let out = '';
  const stack: string[] = [];
  let last = 0;
  const write = (chunk: string) => { out += chunk; };
  for (const match of prepared.matchAll(TAG_RE)) {
    const index = match.index ?? 0;
    appendLinkedText(prepared.slice(last, index), stack, write);
    last = index + match[0].length;
    if (match[1]) {
      const tag = match[1].toLowerCase();
      const at = stack.lastIndexOf(tag);
      if (at === -1) continue;
      while (stack.length > at) {
        const open = stack.pop();
        if (open) out += `</${open}>`;
      }
      continue;
    }
    const tag = (match[2] || '').toLowerCase();
    const attrs = match[3] || '';
    const selfClosing = Boolean(match[4]) || tag === 'br';
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (tag === 'br') {
      out += '<br>';
      continue;
    }
    if (tag === 'a') {
      if (stack.includes('a')) continue;
      const href = safeDocumentUrl(readAttr(attrs, 'href') || '');
      if (!href) continue;
      out += `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">`;
      if (!selfClosing) stack.push('a');
      continue;
    }
    if (tag === 'img') {
      const src = readAttr(attrs, 'src') || '';
      if (!isInternalDocImagePath(src)) continue;
      const alt = (readAttr(attrs, 'alt') || '').slice(0, 200);
      out += `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}">`;
      continue;
    }
    out += `<${tag}>`;
    if (!selfClosing) stack.push(tag);
  }
  appendLinkedText(prepared.slice(last), stack, write);
  while (stack.length) {
    const open = stack.pop();
    if (open) out += `</${open}>`;
  }
  return out.trim();
}

function inlineHasContent(nodes: InlineNode[]): boolean {
  return nodes.some(node => {
    if (node.type === 'text') return node.text.trim().length > 0;
    if (node.type === 'break') return false;
    if (node.type === 'code') return node.text.length > 0;
    if (node.type === 'link') return true;
    return inlineHasContent(node.children);
  });
}

export function parseInlines(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: 'text', text: source.slice(last, index) });
    if (match[1]) {
      nodes.push({ type: 'code', text: match[1].slice(1, -1) });
    } else if (match[2]) {
      nodes.push({ type: 'strong', children: parseInlines(match[3] || '') });
    } else if (match[4]) {
      nodes.push({ type: 'em', children: parseInlines(match[5] || '') });
    } else if (match[6] && match[7]) {
      const href = safeDocumentUrl(match[7]);
      nodes.push(href ? { type: 'link', text: match[6], href } : { type: 'text', text: match[0] });
    } else if (match[9]) {
      const href = safeDocumentUrl(match[9]);
      nodes.push(href ? { type: 'link', text: match[9], href } : { type: 'text', text: match[0] });
    } else if (match[10]) {
      const trimmed = trimUrlTail(match[10]);
      const href = safeDocumentUrl(trimmed);
      if (href) {
        nodes.push({ type: 'link', text: trimmed, href });
        const tail = match[10].slice(trimmed.length);
        if (tail) nodes.push({ type: 'text', text: tail });
      } else {
        nodes.push({ type: 'text', text: match[0] });
      }
    } else {
      nodes.push({ type: 'text', text: match[0] });
    }
    last = index + match[0].length;
  }
  if (last < source.length) nodes.push({ type: 'text', text: source.slice(last) });
  return nodes;
}

function isBlockStart(line: string): boolean {
  return /^(#{1,6}\s+|```|>\s?|[-*]\s+|\d+\.\s+)/.test(line);
}

export function parseMarkdownDocument(source: string): DocumentBlock[] {
  const lines = source.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').split('\n');
  const blocks: DocumentBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      const children = parseInlines(heading[2]);
      if (inlineHasContent(children)) blocks.push({ type: 'heading', level, children });
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      const children = parseInlines(quote.join(' '));
      if (inlineHasContent(children)) blocks.push({ type: 'quote', children });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(parseInlines(lines[index].replace(/^[-*]\s+/, '')));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(parseInlines(lines[index].replace(/^\d+\.\s+/, '')));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    const children = parseInlines(paragraph.join(' '));
    if (inlineHasContent(children)) blocks.push({ type: 'paragraph', children });
  }
  return blocks;
}

export function parsePlainDocument(source: string): DocumentBlock[] {
  const parts = source.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').split(/\n{2,}/);
  const blocks: DocumentBlock[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split('\n');
    const children: InlineNode[] = [];
    lines.forEach((line, lineIndex) => {
      children.push(...parseInlines(line));
      if (lineIndex < lines.length - 1) children.push({ type: 'break' });
    });
    if (inlineHasContent(children)) blocks.push({ type: 'paragraph', children });
  }
  return blocks;
}

export function internalDocFilePath(id: string, inline: boolean): string {
  const base = `/api/internal-docs/${encodeURIComponent(id)}/file`;
  return inline ? `${base}?inline=1` : base;
}

export function isInternalDocImagePath(value: string): boolean {
  return INTERNAL_DOC_IMAGE_PATH.test(value);
}

export function internalDocImagePath(documentId: string, index: number): string {
  return `/api/internal-docs/${documentId}/images/${index}`;
}

export function guideHighlightNeedle(excerpt: string): string {
  return excerpt.replace(/\s+/g, ' ').trim().slice(0, 160);
}
