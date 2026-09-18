export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: MarkdownInline[] };

export type MarkdownBlock =
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] }
  | { type: 'codeblock'; value: string; language?: string }
  | { type: 'table'; headers: MarkdownInline[][]; rows: MarkdownInline[][] };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function sanitizeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!SAFE_HREF.test(trimmed)) return null;
  if (/[\s<>"'`\\]/.test(trimmed)) return null;
  return trimmed;
}

function isListLine(line: string, ordered: boolean): RegExpMatchArray | null {
  return ordered
    ? line.match(/^\s*\d+\.\s+(.*)$/)
    : line.match(/^\s*[-*]\s+(.*)$/);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(cell => cell.trim());
}

function isBlockStart(line: string): boolean {
  return /^(#{1,3})\s+\S/.test(line)
    || /^\s*[-*]\s+\S/.test(line)
    || /^\s*\d+\.\s+\S/.test(line)
    || /^```/.test(line)
    || (line.trim().startsWith('|') && line.includes('|', 1));
}

export function parseInline(text: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  const pattern = /(`+)([^`]*?)\1|\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|__(.+?)__|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    if (match[2] != null) {
      nodes.push({ type: 'code', value: match[2] });
    } else if (match[3] != null) {
      const href = sanitizeHref(match[4] || '');
      if (href) nodes.push({ type: 'link', href, children: parseInline(match[3]) });
      else nodes.push({ type: 'text', value: match[0] });
    } else if (match[5] != null) {
      nodes.push({ type: 'strong', children: parseInline(match[5]) });
    } else if (match[6] != null) {
      nodes.push({ type: 'strong', children: parseInline(match[6]) });
    } else if (match[7] != null) {
      nodes.push({ type: 'em', children: parseInline(match[7]) });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push({ type: 'text', value: text.slice(lastIndex) });
  return nodes.length ? nodes : [{ type: 'text', value: '' }];
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const language = line.slice(3).trim() || undefined;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'codeblock', value: body.join('\n'), language });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: parseInline(heading[2].trim()) });
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(line).map(parseInline);
      index += 2;
      const rows: MarkdownInline[][] = [];
      while (index < lines.length && lines[index].includes('|') && !isTableSeparator(lines[index])) {
        rows.push(splitTableRow(lines[index]).map(parseInline));
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const unordered = isListLine(line, false);
    const ordered = isListLine(line, true);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered && !unordered);
      const items: MarkdownInline[][] = [];
      while (index < lines.length) {
        const item = isListLine(lines[index], isOrdered);
        if (!item) break;
        items.push(parseInline(item[1]));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }

  return blocks;
}

export function markdownContainsHtmlNode(blocks: MarkdownBlock[]): boolean {
  return JSON.stringify(blocks).includes('"type":"html"');
}
