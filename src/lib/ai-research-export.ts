import { parseMarkdown, type MarkdownInline } from './ai-research-markdown';

export interface ResearchExportSource {
  title: string;
  url: string;
  official?: boolean;
  traceKind?: 'person_fact' | 'other_public_trace' | null;
  originChip?: 'official' | 'indonesia' | 'international' | 'internal';
  snippet?: string;
}

export interface ResearchExportInput {
  title: string;
  answer: string;
  sources?: ResearchExportSource[];
  mode?: 'fast' | 'deep';
  exportedAt?: Date;
}

export const RESEARCH_BRIEF_BRAND = 'Dupoin AI Research';
export const RESEARCH_QUESTION_LABEL = 'Research question';
export const RESEARCH_EXPORT_DISCLAIMER = 'Exported from Dupoin AI Research. Check the facts against the sources.';
export const RESEARCH_EXPORT_OFFICIAL_HEADING = 'Official Dupoin / Bappebti';
export const RESEARCH_EXPORT_OTHER_HEADING = 'Other sources';

const EXPORT_CHROME_LINES = new Set([
  'copy markdown',
  'copied',
  'download .md',
  'download pdf',
  'download word',
  'preparing…',
  'preparing...',
  'opening…',
  'opening...',
  'research pdf',
  'research word',
  'open pdf',
  'follow-up questions',
]);

const TRACE_EXPORT_NOTE: Record<NonNullable<ResearchExportSource['traceKind']>, string> = {
  person_fact: 'Official Dupoin/Bappebti roster',
  other_public_trace: 'Other public trace — not necessarily the same person',
};

const ORIGIN_EXPORT_NOTE: Record<NonNullable<ResearchExportSource['originChip']>, string> = {
  official: 'Official',
  indonesia: 'Indonesia',
  international: 'International',
  internal: 'FAQ & Guides',
};

const PDF_PAGE_WIDTH = 595;
const PDF_PAGE_HEIGHT = 842;
const PDF_MARGIN_X = 54;
const PDF_CONTENT_TOP = 770;
const PDF_CONTENT_BOTTOM = 56;

export function researchExportSources(value: unknown): ResearchExportSource[] {
  if (!Array.isArray(value)) return [];
  const sources: ResearchExportSource[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as {
      title?: unknown;
      url?: unknown;
      official?: unknown;
      traceKind?: unknown;
      originChip?: unknown;
      snippet?: unknown;
    };
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!/^https?:\/\//i.test(url) || url.length > 2_048) continue;
    const key = url.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const title = typeof record.title === 'string' ? record.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    const source: ResearchExportSource = { title: title || url, url };
    if (typeof record.official === 'boolean') source.official = record.official;
    if (record.traceKind === 'person_fact' || record.traceKind === 'other_public_trace') source.traceKind = record.traceKind;
    if (
      record.originChip === 'official'
      || record.originChip === 'indonesia'
      || record.originChip === 'international'
      || record.originChip === 'internal'
    ) {
      source.originChip = record.originChip;
    }
    const snippet = typeof record.snippet === 'string' ? record.snippet.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    if (snippet) source.snippet = snippet;
    sources.push(source);
  }
  return sources;
}

function collapseExportText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Subject line for the brief. Chat prompts and markdown marks stay out of the title. */
export function researchExportQuestion(title: string): string {
  const collapsed = collapseExportText(title || '').replace(/^(?:research question|user query|question)\s*:\s*/i, '').trim();
  const compare = collapsed.match(/^Compare the two items below in a balanced way\. A: (.+?) B: (.+?)(?: Focus: (.+?))?(?: Use only evidence from the sources that were found\. Do not invent prices or facts\.)?$/);
  const subject = compare
    ? `${compare[1].trim()} vs ${compare[2].trim()}${compare[3]?.trim() ? ` — ${compare[3].trim()}` : ''}`
    : collapsed;
  return subject.slice(0, 2_000) || 'Dupoin AI research';
}

export function researchExportTitle(title: string): string {
  return researchExportQuestion(title);
}

export function researchExportModeLabel(mode: ResearchExportInput['mode']): string {
  return mode === 'deep' ? 'Deep' : 'Fast';
}

export function researchExportModePhrase(mode: ResearchExportInput['mode']): string {
  return `${researchExportModeLabel(mode)} research`;
}

export function researchBriefMetaLine(brief: Pick<ResearchBrief, 'modePhrase' | 'dateLabel'>): string {
  return `${brief.modePhrase} · ${brief.dateLabel}`;
}

export function researchExportDateLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function normalizeEcho(value: string): string {
  return value
    .toLowerCase()
    .replace(/[*_`#>]/g, '')
    .replace(/[“”"'‘’]/g, '')
    .replace(/[?!.,:;]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripChromeLines(text: string): string {
  const kept = text.split('\n').filter(line => !EXPORT_CHROME_LINES.has(line.trim().toLowerCase()));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripOneQuestionEcho(body: string, questionNorm: string): string | null {
  if (questionNorm.length < 12) return null;
  const blocks = body.split(/\n\s*\n/);
  const first = blocks[0]?.trim() ?? '';
  if (!first) return null;
  const heading = first.match(/^#{1,6}\s+([\s\S]+)$/);
  const labeled = first.match(/^(?:\*\*)?(?:research question|user query|question|you|user)(?:\*\*)?\s*:\s*([\s\S]+)$/i);
  const boldOnly = first.match(/^\*\*([\s\S]+)\*\*$/);
  const roleOnly = /^(?:you|user|assistant)\s*:?\s*$/i.test(first) || /^assistant\s*:\s*dupoin ai\s*$/i.test(first);
  if (roleOnly) return blocks.slice(1).join('\n\n').trim();
  const candidate = (heading?.[1] || labeled?.[1] || boldOnly?.[1] || first).trim();
  if (normalizeEcho(candidate) === questionNorm) return blocks.slice(1).join('\n\n').trim();
  if (!heading && !labeled && !boldOnly) {
    const sentence = candidate.match(/^([\s\S]+?[.?!])(?:\s+([\s\S]+))?$/);
    if (sentence && normalizeEcho(sentence[1]) === questionNorm && sentence[2]?.trim()) {
      return [sentence[2].trim(), ...blocks.slice(1)].filter(Boolean).join('\n\n').trim();
    }
  }
  return null;
}

/** Answer prose for the brief, without a repeated question or chat-button lines. */
export function researchExportAnswer(answer: string, question: string): string {
  let body = stripChromeLines((answer || '').replace(/\r\n/g, '\n').trim());
  const questionNorm = normalizeEcho(researchExportQuestion(question));
  for (let pass = 0; pass < 4; pass += 1) {
    const next = stripOneQuestionEcho(body, questionNorm);
    if (next == null) break;
    body = next;
  }
  return stripChromeLines(body);
}

export interface ResearchBrief {
  brand: string;
  questionLabel: string;
  question: string;
  modePhrase: string;
  dateLabel: string;
  answer: string;
  sources: ResearchExportSource[];
  disclaimer: string;
}

export function buildResearchBrief(input: ResearchExportInput): ResearchBrief {
  const question = researchExportQuestion(input.title || '');
  const answer = researchExportAnswer(input.answer || '', question);
  return {
    brand: RESEARCH_BRIEF_BRAND,
    questionLabel: RESEARCH_QUESTION_LABEL,
    question,
    modePhrase: researchExportModePhrase(input.mode),
    dateLabel: researchExportDateLabel(input.exportedAt ?? new Date()),
    answer: answer || 'Empty answer.',
    sources: researchExportSources(input.sources),
    disclaimer: RESEARCH_EXPORT_DISCLAIMER,
  };
}

export function researchSourceExportNote(source: ResearchExportSource): string {
  if (source.traceKind) return TRACE_EXPORT_NOTE[source.traceKind];
  if (source.originChip) return ORIGIN_EXPORT_NOTE[source.originChip];
  return '';
}

export function isOfficialExportSource(source: ResearchExportSource): boolean {
  return source.official === true || source.originChip === 'official' || source.traceKind === 'person_fact';
}

export type ResearchExportSourceGroups =
  | { labeled: false; sources: ResearchExportSource[] }
  | { labeled: true; official: ResearchExportSource[]; other: ResearchExportSource[] };

export function partitionResearchExportSources(sources: ResearchExportSource[]): ResearchExportSourceGroups {
  const classified = sources.some(source => typeof source.official === 'boolean' || Boolean(source.originChip) || Boolean(source.traceKind));
  if (!classified) return { labeled: false, sources };
  return {
    labeled: true,
    official: sources.filter(isOfficialExportSource),
    other: sources.filter(source => !isOfficialExportSource(source)),
  };
}

function markdownLinkLabel(title: string, url: string): string {
  const label = (title || url).replace(/[\[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim() || url;
  return label;
}

function markdownSourceItem(source: ResearchExportSource, index: number): string {
  const note = researchSourceExportNote(source);
  const line = `${index + 1}. [${markdownLinkLabel(source.title, source.url)}](${source.url})${note ? ` — ${note}` : ''}`;
  return source.snippet ? `${line}\n   ${source.snippet}` : line;
}

function markdownSourceSection(sources: ResearchExportSource[]): string {
  const groups = partitionResearchExportSources(sources);
  if (!groups.labeled) {
    return groups.sources.length
      ? groups.sources.map((source, index) => markdownSourceItem(source, index)).join('\n')
      : '_No sources were included in this brief._';
  }
  const section = (items: ResearchExportSource[]) => (
    items.length
      ? items.map((source, index) => markdownSourceItem(source, index)).join('\n')
      : '_None in this section._'
  );
  return [
    `### ${RESEARCH_EXPORT_OFFICIAL_HEADING}`,
    '',
    section(groups.official),
    '',
    `### ${RESEARCH_EXPORT_OTHER_HEADING}`,
    '',
    section(groups.other),
  ].join('\n');
}

function nestAnswerMarkdown(markdown: string): string {
  let fence = false;
  return markdown.split('\n').map(line => {
    if (/^```/.test(line)) {
      fence = !fence;
      return line;
    }
    if (fence) return line;
    return line.replace(/^(#{1,6})(?=\s)/, hashes => '#'.repeat(Math.min(hashes.length + 1, 6)));
  }).join('\n');
}

export function buildResearchMarkdownExport(input: ResearchExportInput): string {
  const brief = buildResearchBrief(input);
  const answer = brief.answer === 'Empty answer.' ? '_Empty answer._' : nestAnswerMarkdown(brief.answer);
  return [
    `# ${brief.brand}`,
    '',
    `**${brief.questionLabel}**`,
    '',
    brief.question,
    '',
    researchBriefMetaLine(brief),
    '',
    '## Answer',
    '',
    answer,
    '',
    '## Sources',
    '',
    markdownSourceSection(brief.sources),
    '',
    `_${brief.disclaimer}_`,
    '',
  ].join('\n');
}

export function researchExportFilename(title: string, extension: 'md' | 'pdf' | 'docx', date = new Date()): string {
  const slug = researchExportQuestion(title || 'research')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'research';
  const day = date.toISOString().slice(0, 10);
  return `dupoin-ai-research-${slug}-${day}.${extension}`;
}

export function researchAnswerToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/```[\w-]*\n?/g, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

const WIN_ANSI_EXTRA: Record<string, number> = {
  '\u20ac': 0x80,
  '\u201a': 0x82,
  '\u0192': 0x83,
  '\u201e': 0x84,
  '\u2026': 0x85,
  '\u2020': 0x86,
  '\u2021': 0x87,
  '\u02c6': 0x88,
  '\u2030': 0x89,
  '\u0160': 0x8a,
  '\u2039': 0x8b,
  '\u0152': 0x8c,
  '\u017d': 0x8e,
  '\u2018': 0x91,
  '\u2019': 0x92,
  '\u201c': 0x93,
  '\u201d': 0x94,
  '\u2022': 0x95,
  '\u2013': 0x96,
  '\u2014': 0x97,
  '\u02dc': 0x98,
  '\u2122': 0x99,
  '\u0161': 0x9a,
  '\u203a': 0x9b,
  '\u0153': 0x9c,
  '\u017e': 0x9e,
  '\u0178': 0x9f,
};

function pdfLiteral(text: string): string {
  let out = '(';
  for (const char of text) {
    const mapped = WIN_ANSI_EXTRA[char];
    const code = mapped ?? char.codePointAt(0) ?? 63;
    const byte = code >= 32 && code <= 255 && code !== 127 ? code : 63;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  out += ')';
  return out;
}

type PdfFont = 'F1' | 'F2' | 'F3';
type PdfText = { kind: 'text'; text: string; font: PdfFont; size: number; gapBefore: number; color: string; indent: number };
type PdfRule = { kind: 'rule'; gapBefore: number };
type PdfItem = PdfText | PdfRule;

const PDF_INK = '0.114 0.161 0.224';
const PDF_TITLE = '0.063 0.094 0.157';
const PDF_INDIGO = '0.267 0.298 0.906';
const PDF_MUTED = '0.278 0.333 0.412';
const PDF_RULE = '0.820 0.835 0.863';

function wrapText(text: string, fontSize: number, bold: boolean, maxCharsOverride?: number): string[] {
  const maxWidth = PDF_PAGE_WIDTH - PDF_MARGIN_X * 2;
  const factor = bold ? 0.56 : 0.5;
  const charWidth = Math.max(1, fontSize * factor);
  const maxChars = maxCharsOverride ?? Math.max(16, Math.floor(maxWidth / charWidth));
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(word => word.length > 0);
    if (!words.length) {
      lines.push('');
      continue;
    }
    const pieces = words.flatMap(word => {
      if (word.length <= maxChars) return [word];
      const chunks: string[] = [];
      for (let index = 0; index < word.length; index += maxChars) chunks.push(word.slice(index, index + maxChars));
      return chunks;
    });
    let current = '';
    for (const piece of pieces) {
      const next = current ? `${current} ${piece}` : piece;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = piece;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function inlineExportText(nodes: MarkdownInline[]): string {
  return nodes.map(node => {
    if (node.type === 'text' || node.type === 'code') return node.value.replace(/\n/g, ' ');
    if (node.type === 'link') {
      const label = inlineExportText(node.children).replace(/\s+/g, ' ').trim() || node.href;
      return label === node.href ? node.href : `${label} (${node.href})`;
    }
    return inlineExportText(node.children);
  }).join('');
}

function layoutExportLines(input: ResearchExportInput): PdfItem[] {
  const brief = buildResearchBrief(input);
  const lines: PdfItem[] = [];
  const push = (text: string, font: PdfFont, size: number, gapBefore: number, color: string, indent = 0) => {
    const maxWidth = PDF_PAGE_WIDTH - PDF_MARGIN_X * 2 - indent;
    const factor = font === 'F2' ? 0.56 : 0.5;
    const maxChars = Math.max(16, Math.floor(maxWidth / Math.max(1, size * factor)));
    const wrapped = wrapText(text, size, font === 'F2', maxChars);
    for (const line of wrapped) {
      lines.push({ kind: 'text', text: line, font, size, gapBefore, color, indent });
      gapBefore = 2;
    }
  };
  const pushSources = (sources: ResearchExportSource[], emptyLabel: string) => {
    if (!sources.length) {
      push(emptyLabel, 'F3', 11, 8, PDF_MUTED);
      return;
    }
    sources.forEach((source, index) => {
      const note = researchSourceExportNote(source);
      push(`${index + 1}. ${source.title}${note ? ` — ${note}` : ''}`, 'F1', 11, 8, PDF_INK);
      push(source.url, 'F1', 9, 2, PDF_MUTED, 14);
      if (source.snippet) push(source.snippet, 'F3', 9, 2, PDF_MUTED, 14);
    });
  };
  push(brief.questionLabel, 'F2', 9, 0, PDF_INDIGO);
  push(brief.question, 'F2', 16, 8, PDF_TITLE);
  push(researchBriefMetaLine(brief), 'F1', 9, 10, PDF_MUTED);
  lines.push({ kind: 'rule', gapBefore: 8 });
  push('Answer', 'F2', 13, 14, PDF_TITLE);
  const blocks = parseMarkdown(brief.answer);
  if (!blocks.length) push(brief.answer, 'F1', 11, 8, PDF_INK);
  for (const block of blocks) {
    if (block.type === 'heading') {
      const size = block.level === 1 ? 12 : 11;
      push(inlineExportText(block.children), 'F2', size, block.level === 1 ? 12 : 10, PDF_TITLE);
      continue;
    }
    if (block.type === 'list') {
      block.items.forEach((item, index) => {
        const marker = block.ordered ? `${index + 1}. ` : '• ';
        push(`${marker}${inlineExportText(item)}`, 'F1', 11, 4, PDF_INK, 12);
      });
      continue;
    }
    if (block.type === 'codeblock') {
      const codeLines = block.value.split('\n');
      codeLines.forEach((line, index) => push(line || ' ', 'F1', 9, index === 0 ? 8 : 1, PDF_MUTED, 8));
      continue;
    }
    if (block.type === 'table') {
      push(block.headers.map(cell => inlineExportText(cell)).join(' | '), 'F2', 10, 8, PDF_TITLE);
      for (const row of block.rows) push(row.map(cell => inlineExportText(cell)).join(' | '), 'F1', 10, 3, PDF_INK);
      continue;
    }
    push(inlineExportText(block.children), 'F1', 11, 7, PDF_INK);
  }
  push('Sources', 'F2', 13, 16, PDF_TITLE);
  const groups = partitionResearchExportSources(brief.sources);
  if (!groups.labeled) {
    pushSources(groups.sources, 'No sources were included in this brief.');
  } else {
    push(RESEARCH_EXPORT_OFFICIAL_HEADING, 'F2', 11, 10, PDF_INDIGO);
    pushSources(groups.official, 'None in this section.');
    push(RESEARCH_EXPORT_OTHER_HEADING, 'F2', 11, 12, PDF_INDIGO);
    pushSources(groups.other, 'None in this section.');
  }
  lines.push({ kind: 'rule', gapBefore: 14 });
  push(brief.disclaimer, 'F3', 9, 8, PDF_MUTED);
  return lines;
}

function itemHeight(item: PdfItem): number {
  if (item.kind === 'rule') return item.gapBefore + 6;
  return item.gapBefore + item.size + 3;
}

function paginate(lines: PdfItem[]): PdfItem[][] {
  const pages: PdfItem[][] = [];
  let current: PdfItem[] = [];
  let y = PDF_CONTENT_TOP;
  for (const line of lines) {
    const height = itemHeight(line);
    if (current.length && y - height < PDF_CONTENT_BOTTOM) {
      pages.push(current);
      current = [];
      y = PDF_CONTENT_TOP;
    }
    current.push(line);
    y -= height;
  }
  pages.push(current);
  return pages;
}

function pageStream(lines: PdfItem[], pageNumber: number, pageCount: number): string {
  const commands = [
    '0.6 w',
    `${PDF_INDIGO} rg`,
    'BT',
    '/F2 9 Tf',
    `1 0 0 1 ${PDF_MARGIN_X} 804 Tm`,
    `${pdfLiteral(RESEARCH_BRIEF_BRAND)} Tj`,
    'ET',
    `${PDF_RULE} RG`,
    `${PDF_MARGIN_X} 792 m ${PDF_PAGE_WIDTH - PDF_MARGIN_X} 792 l S`,
  ];
  let y = PDF_CONTENT_TOP;
  for (const item of lines) {
    if (item.kind === 'rule') {
      y -= item.gapBefore;
      commands.push(`${PDF_RULE} RG`);
      commands.push(`${PDF_MARGIN_X} ${y} m ${PDF_PAGE_WIDTH - PDF_MARGIN_X} ${y} l S`);
      y -= 6;
      continue;
    }
    y -= item.gapBefore + item.size;
    commands.push(`${item.color} rg`);
    commands.push('BT');
    commands.push(`/${item.font} ${item.size} Tf`);
    commands.push(`1 0 0 1 ${PDF_MARGIN_X + item.indent} ${y} Tm`);
    commands.push(`${pdfLiteral(item.text)} Tj`);
    commands.push('ET');
    y -= 3;
  }
  commands.push(`${PDF_MUTED} rg`);
  commands.push('BT');
  commands.push('/F1 8 Tf');
  commands.push(`1 0 0 1 ${PDF_MARGIN_X} 34 Tm`);
  commands.push(`${pdfLiteral(`Page ${pageNumber} of ${pageCount}`)} Tj`);
  commands.push('ET');
  return commands.join('\n');
}

function toPdfBytes(source: string): Uint8Array {
  const bytes = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) bytes[index] = source.charCodeAt(index) & 0xff;
  return bytes;
}

export function buildResearchPdf(input: ResearchExportInput): Uint8Array {
  const pages = paginate(layoutExportLines(input));
  const streams = pages.map((lines, index) => pageStream(lines, index + 1, pages.length));
  const objects: string[] = [];
  const pageIds: number[] = [];
  let nextId = 6;
  const pageObjects: Array<{ id: number; contentId: number; stream: string }> = [];
  for (const stream of streams) {
    const id = nextId;
    nextId += 1;
    const contentId = nextId;
    nextId += 1;
    pageIds.push(id);
    pageObjects.push({ id, contentId, stream });
  }
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(`2 0 obj\n<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>\nendobj\n`);
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>\nendobj\n');
  for (const page of pageObjects) {
    objects.push(
      `${page.id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${page.contentId} 0 R >>\nendobj\n`,
    );
    objects.push(`${page.contentId} 0 obj\n<< /Length ${page.stream.length} >>\nstream\n${page.stream}\nendstream\nendobj\n`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return toPdfBytes(pdf);
}
