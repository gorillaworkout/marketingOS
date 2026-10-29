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
    draft.body_markdown.trim(),
    '',
  ].join('\n');
}

/** Standalone HTML document; the body is the rendered, escaped Markdown. */
export function renderHtmlExport(draft: ExportableDraft): string {
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
    markdownToHtml(draft.body_markdown),
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
