/**
 * Small Markdown -> HTML renderer for Content Studio exports and preview.
 * Supports headings, paragraphs, bold/italic, inline code, fenced code,
 * links, ordered/unordered lists, blockquotes and rules. Raw HTML is always
 * escaped and links are limited to http(s), mailto, relative paths and
 * anchors, so the output is safe to paste into a CMS or render in the app.
 */
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ESCAPES[char]);
}

function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^(https|http|mailto):/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  if (href.startsWith('//')) return null;
  return href;
}

function inline(text: string): string {
  const codes: string[] = [];
  let html = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  const links: string[] = [];
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const safe = safeHref(href);
    links.push(safe ? `<a href="${escapeHtml(safe)}">${inlineText(label)}</a>` : inlineText(label));
    return `\u0001${links.length - 1}\u0001`;
  });
  html = inlineText(html);
  html = html.replace(/\u0001(\d+)\u0001/g, (_, index: string) => links[Number(index)]);
  return html.replace(/\u0000(\d+)\u0000/g, (_, index: string) => codes[Number(index)]);
}

function inlineText(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_\s][^_]*)_(?=[^\w]|$)/g, '$1<em>$2</em>');
}

const MID_HEADING = /\S\s+(?=#{1,6}\s+\S)/;
const TABLE_SEPARATOR = /\|(?:\s*:?-{3,}:?\s*\|)+/;

/** Splits a flat Markdown table run ("| a | b | | --- | --- | | x | y |") into rows. */
function splitFlatTable(segment: string): string[] | null {
  const separator = segment.match(TABLE_SEPARATOR);
  if (!separator || separator.index === undefined) return null;
  const columns = (separator[0].match(/-{3,}/g) || []).length;
  const pipes: number[] = [];
  for (let index = 0; index < segment.length; index += 1) if (segment[index] === '|') pipes.push(index);
  const sepStart = pipes.indexOf(separator.index);
  const sepEnd = sepStart + columns;
  const headStart = sepStart - columns - 1;
  if (sepStart < 0 || headStart < 0 || sepEnd > pipes.length - 1) return null;
  const before = segment.slice(0, pipes[headStart]).trim();
  const rows = [segment.slice(pipes[headStart], pipes[sepStart - 1] + 1), segment.slice(pipes[sepStart], pipes[sepEnd] + 1)];
  let cursor = sepEnd + 1;
  while (cursor + columns < pipes.length && !segment.slice(pipes[cursor - 1] + 1, pipes[cursor]).trim()) {
    rows.push(segment.slice(pipes[cursor], pipes[cursor + columns] + 1));
    cursor += columns + 1;
  }
  const after = segment.slice(pipes[cursor - 1] + 1).trim();
  return [...(before ? [before, ''] : []), ...rows.map(row => row.trim()), ...(after ? ['', ...repairFlatLine(after)] : [])];
}

const CAPITALIZED = /^[A-Z\u00C0-\u00DE][a-z\u00DF-\u00FF]/;
const LOWER = /^[a-z\u00DF-\u00FF]/;

/** Where a flattened heading ends and its first paragraph begins. */
function splitFlatHeading(segment: string): string[] {
  const marker = segment.match(/^(#{1,6})\s+/);
  if (!marker) return [segment];
  const text = segment.slice(marker[0].length);
  const question = text.search(/[?]\s+\S/);
  if (question >= 0 && question < 140) {
    return [`${marker[1]} ${text.slice(0, question + 1).trim()}`, '', text.slice(question + 1).trim()];
  }
  const words = text.split(/\s+/);
  for (let index = 1; index + 2 < words.length; index += 1) {
    if (/[.!:]$/.test(words[index - 1])) break;
    if (CAPITALIZED.test(words[index]) && LOWER.test(words[index + 1]) && LOWER.test(words[index + 2])) {
      return [`${marker[1]} ${words.slice(0, index).join(' ')}`, '', words.slice(index).join(' ')];
    }
  }
  return [segment];
}

function splitFlatList(segment: string): string[] {
  const bullets = segment.match(/(?:^|\s)[-*+]\s+(?=\S)/g) || [];
  const ordered = segment.match(/(?:^|\s)\d{1,2}[.)]\s+(?=\S)/g) || [];
  const pattern = bullets.length >= 2 ? /\s+(?=[-*+]\s+\S)/ : ordered.length >= 2 ? /\s+(?=\d{1,2}[.)]\s+\S)/ : null;
  if (!pattern) return [segment];
  const [lead, ...items] = segment.split(pattern);
  const isItem = /^(?:[-*+]|\d{1,2}[.)])\s+/.test(lead);
  return isItem ? [lead, ...items] : [...splitFlatHeading(lead), '', ...items];
}

function repairFlatLine(line: string): string[] {
  const out: string[] = [];
  const segments = line.trim().split(/\s+(?=#{1,6}\s+\S)/);
  for (const segment of segments) {
    if (out.length) out.push('');
    const table = TABLE_SEPARATOR.test(segment) ? splitFlatTable(segment) : null;
    if (table) {
      const [first, ...rest] = table;
      out.push(...(first.startsWith('|') ? [first] : repairFlatLine(first)), ...rest);
      continue;
    }
    const listed = splitFlatList(segment);
    if (listed.length > 1) { out.push(...listed); continue; }
    out.push(...splitFlatHeading(segment));
  }
  return out;
}

function needsRepair(line: string): boolean {
  if (MID_HEADING.test(line)) return true;
  if (/^#{1,6}\s+/.test(line) && line.length > 140) return true;
  return /\|\s+\|\s*:?-{3,}/.test(line);
}

/**
 * Deterministic layout repair for Markdown whose newlines were lost (a model
 * or a normalization step flattened it): puts headings, paragraphs, list items
 * and table rows back on their own lines. Well-formed Markdown is returned as is.
 */
export function repairMarkdownLayout(markdown: string): string {
  let text = markdown.replace(/\r\n/g, '\n');
  if (!text.includes('\n') && text.includes('\\n')) text = text.replace(/\\n/g, '\n');
  const lines = text.split('\n');
  let fenced = false;
  let changed = text !== markdown;
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('```')) fenced = !fenced;
    if (fenced || line.trim().startsWith('```') || !needsRepair(line)) { out.push(line); continue; }
    changed = true;
    if (out.length && out[out.length - 1].trim()) out.push('');
    out.push(...repairFlatLine(line), '');
  }
  if (!changed) return markdown;
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flush();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) { code.push(lines[index]); index += 1; }
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!trimmed) { flush(); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flush(); out.push('<hr>'); continue; }

    if (trimmed.startsWith('>')) {
      flush();
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index].trim().replace(/^>\s*/, ''));
        index += 1;
      }
      index -= 1;
      out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    const bullet = /^[-*+]\s+/;
    const ordered = /^\d+[.)]\s+/;
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flush();
      const table: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('|') && lines[index].trim().endsWith('|')) {
        table.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      const rows = table
        .filter(row => {
          const cells = row.slice(1, -1).split('|').map(cell => cell.trim());
          return !(cells.length && cells.every(cell => /^:?-{3,}:?$/.test(cell)));
        })
        .map(row => row.slice(1, -1).split('|').map(cell => cell.trim()));
      if (rows.length) {
        const [header, ...body] = rows;
        const head = `<thead><tr>${header.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`;
        const renderedBody = body.length
          ? `<tbody>${body.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
          : '';
        out.push(`<table>${head}${renderedBody}</table>`);
      }
      continue;
    }

    if (bullet.test(trimmed) || ordered.test(trimmed)) {
      flush();
      const pattern = bullet.test(trimmed) ? bullet : ordered;
      const tag = pattern === bullet ? 'ul' : 'ol';
      const items: string[] = [];
      while (index < lines.length && pattern.test(lines[index].trim())) {
        items.push(`<li>${inline(lines[index].trim().replace(pattern, ''))}</li>`);
        index += 1;
      }
      index -= 1;
      out.push(`<${tag}>\n${items.join('\n')}\n</${tag}>`);
      continue;
    }

    paragraph.push(trimmed);
  }
  flush();
  return out.join('\n');
}

export interface ExportableDraft {
  title: string;
  slug: string;
  meta_description: string;
  body_markdown: string;
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

/** Markdown with YAML front matter (title, slug, description). */
export function renderMarkdownExport(draft: ExportableDraft): string {
  return [
    '---',
    `title: ${yamlString(draft.title)}`,
    `slug: ${yamlString(draft.slug)}`,
    `description: ${yamlString(draft.meta_description)}`,
    '---',
    '',
    repairMarkdownLayout(draft.body_markdown).trim(),
    '',
  ].join('\n');
}

/** Standalone HTML document; the body is the rendered, escaped Markdown. */
export function renderHtmlExport(draft: ExportableDraft): string {
  const body = repairMarkdownLayout(draft.body_markdown);
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(draft.title)}</title>`,
    `<meta name="description" content="${escapeHtml(draft.meta_description)}">`,
    '</head>',
    '<body>',
    '<article>',
    markdownToHtml(body.match(/^#\s+/m) ? body : `# ${draft.title}\n\n${body}`),
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
