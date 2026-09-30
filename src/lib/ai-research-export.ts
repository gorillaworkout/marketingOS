import { AI_RESEARCH_ASSISTANT_NAME } from './ai-research';

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

export const RESEARCH_EXPORT_DISCLAIMER = 'Exported from Dupoin AI Research. Check the facts against the sources.';
export const RESEARCH_EXPORT_OFFICIAL_HEADING = 'Official Dupoin / Bappebti';
export const RESEARCH_EXPORT_OTHER_HEADING = 'Other sources';

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

export function researchExportTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim() || 'Dupoin AI research';
}

export function researchExportModeLabel(mode: ResearchExportInput['mode']): string {
  return mode === 'deep' ? 'Deep' : 'Fast';
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
      : '_No sources were saved on this message._';
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

export function buildResearchMarkdownExport(input: ResearchExportInput): string {
  const title = researchExportTitle(input.title || 'Dupoin AI research');
  const when = (input.exportedAt ?? new Date()).toISOString().slice(0, 10);
  const modeLabel = researchExportModeLabel(input.mode);
  const answer = input.answer.trim() || '_Empty answer._';
  return [
    `# ${title}`,
    '',
    `- Assistant: ${AI_RESEARCH_ASSISTANT_NAME}`,
    `- Mode: ${modeLabel}`,
    `- Exported: ${when}`,
    '',
    '## Answer',
    '',
    answer,
    '',
    '## Sources',
    '',
    markdownSourceSection(researchExportSources(input.sources)),
    '',
  ].join('\n');
}

export function researchExportFilename(title: string, extension: 'md' | 'pdf' | 'docx', date = new Date()): string {
  const slug = (title || 'research')
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

type PdfLine = { text: string; font: 'F1' | 'F2'; size: number; gapBefore: number };

function wrapText(text: string, fontSize: number, bold: boolean): string[] {
  const maxWidth = PDF_PAGE_WIDTH - PDF_MARGIN_X * 2;
  const factor = bold ? 0.56 : 0.5;
  const charWidth = Math.max(1, fontSize * factor);
  const maxChars = Math.max(16, Math.floor(maxWidth / charWidth));
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

function layoutExportLines(input: ResearchExportInput): PdfLine[] {
  const title = researchExportTitle(input.title || 'Dupoin AI research');
  const when = (input.exportedAt ?? new Date()).toISOString().slice(0, 10);
  const modeLabel = researchExportModeLabel(input.mode);
  const lines: PdfLine[] = [];
  const push = (text: string, font: 'F1' | 'F2', size: number, gapBefore: number) => {
    for (const line of wrapText(text, size, font === 'F2')) {
      lines.push({ text: line, font, size, gapBefore });
      gapBefore = 2;
    }
  };
  const pushSources = (sources: ResearchExportSource[], emptyLabel: string) => {
    if (!sources.length) {
      push(emptyLabel, 'F1', 11, 8);
      return;
    }
    sources.forEach((source, index) => {
      const note = researchSourceExportNote(source);
      push(`${index + 1}. ${source.title}${note ? ` — ${note}` : ''}`, 'F1', 11, 8);
      push(source.url, 'F1', 9, 2);
      if (source.snippet) push(source.snippet, 'F1', 9, 2);
    });
  };
  push(title, 'F2', 16, 0);
  push(`${AI_RESEARCH_ASSISTANT_NAME} · Mode ${modeLabel} · ${when}`, 'F1', 9, 8);
  push('Answer', 'F2', 12, 16);
  push(researchAnswerToPlainText(input.answer.trim() || 'Empty answer.'), 'F1', 11, 8);
  push('Sources', 'F2', 12, 16);
  const groups = partitionResearchExportSources(researchExportSources(input.sources));
  if (!groups.labeled) {
    pushSources(groups.sources, 'No sources were saved on this message.');
  } else {
    push(RESEARCH_EXPORT_OFFICIAL_HEADING, 'F2', 11, 10);
    pushSources(groups.official, 'None in this section.');
    push(RESEARCH_EXPORT_OTHER_HEADING, 'F2', 11, 12);
    pushSources(groups.other, 'None in this section.');
  }
  push(RESEARCH_EXPORT_DISCLAIMER, 'F1', 9, 18);
  return lines;
}

function paginate(lines: PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let y = PDF_CONTENT_TOP;
  for (const line of lines) {
    const height = line.gapBefore + line.size + 3;
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

function pageStream(lines: PdfLine[], pageNumber: number, pageCount: number): string {
  const commands = [
    'BT',
    '/F1 9 Tf',
    `1 0 0 1 ${PDF_MARGIN_X} 804 Tm`,
    `${pdfLiteral('Dupoin AI Research')} Tj`,
    'ET',
  ];
  let y = PDF_CONTENT_TOP;
  for (const line of lines) {
    y -= line.gapBefore + line.size;
    commands.push('BT');
    commands.push(`/${line.font} ${line.size} Tf`);
    commands.push(`1 0 0 1 ${PDF_MARGIN_X} ${y} Tm`);
    commands.push(`${pdfLiteral(line.text)} Tj`);
    commands.push('ET');
    y -= 3;
  }
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
  let nextId = 5;
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
  for (const page of pageObjects) {
    objects.push(
      `${page.id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${page.contentId} 0 R >>\nendobj\n`,
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
