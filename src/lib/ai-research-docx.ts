import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type INumberingOptions,
  type ParagraphChild,
} from 'docx';
import {
  RESEARCH_BRIEF_BRAND,
  RESEARCH_EXPORT_OFFICIAL_HEADING,
  RESEARCH_EXPORT_OTHER_HEADING,
  buildResearchBrief,
  partitionResearchExportSources,
  researchBriefMetaLine,
  researchSourceExportNote,
  type ResearchBrief,
  type ResearchExportInput,
  type ResearchExportSource,
} from './ai-research-export';
import { parseMarkdown, type MarkdownInline } from './ai-research-markdown';

export const RESEARCH_DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const BODY = 22;
const META = 20;
const SMALL = 18;
const CONTENT_WIDTH = 10080;
const INK = '1D2939';
const TITLE = '101828';
const INDIGO = '444CE7';
const MUTED = '667085';

const hairline = { style: BorderStyle.SINGLE, size: 4, color: 'E0E7FF' };
const noneBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

function inlineChildren(nodes: MarkdownInline[], marks: { bold?: boolean; italics?: boolean } = {}, size = BODY): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const parts = node.value.split('\n');
      parts.forEach((part, index) => {
        if (index > 0) children.push(new TextRun({ break: 1 }));
        if (part) children.push(new TextRun({ text: part, bold: marks.bold, italics: marks.italics, size, color: INK }));
      });
      continue;
    }
    if (node.type === 'code') {
      children.push(new TextRun({ text: node.value, font: 'Consolas', bold: marks.bold, italics: marks.italics, size: SMALL }));
      continue;
    }
    if (node.type === 'strong') {
      children.push(...inlineChildren(node.children, { ...marks, bold: true }));
      continue;
    }
    if (node.type === 'em') {
      children.push(...inlineChildren(node.children, { ...marks, italics: true }));
      continue;
    }
    const label = inlinePlain(node.children).trim() || node.href;
    children.push(new ExternalHyperlink({
      link: node.href,
      children: [new TextRun({ text: label, style: 'Hyperlink', bold: marks.bold, italics: marks.italics, size })],
    }));
  }
  return children;
}

function inlinePlain(nodes: MarkdownInline[]): string {
  return nodes.map(node => {
    if (node.type === 'text' || node.type === 'code') return node.value;
    return inlinePlain(node.children);
  }).join('');
}

function paragraphFromInlines(nodes: MarkdownInline[], spacingAfter = 160): Paragraph {
  const children = inlineChildren(nodes);
  return new Paragraph({
    spacing: { after: spacingAfter, line: 276, lineRule: LineRuleType.AUTO },
    children: children.length ? children : [new TextRun({ text: '', size: BODY, color: INK })],
  });
}

function answerBlocks(markdown: string, numbering: INumberingOptions['config'][number][]): FileChild[] {
  const blocks = parseMarkdown(markdown.trim() || 'Empty answer.');
  if (!blocks.length) {
    return [new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: 'Empty answer.', size: BODY })] })];
  }
  const children: FileChild[] = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      const level = block.level === 1 ? HeadingLevel.HEADING_2 : block.level === 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4;
      const headingSize = block.level === 1 ? 24 : 22;
      children.push(new Paragraph({
        heading: level,
        spacing: { before: block.level === 1 ? 240 : 180, after: 80 },
        children: inlineChildren(block.children, { bold: true }, headingSize),
      }));
      continue;
    }
    if (block.type === 'list') {
      numbering.push({
        reference: `ai-research-list-${numbering.length + 1}`,
        levels: [{
          level: 0,
          format: block.ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
          text: block.ordered ? '%1.' : '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      });
      const reference = `ai-research-list-${numbering.length}`;
      for (const item of block.items) {
        const itemChildren = inlineChildren(item);
        children.push(new Paragraph({
          numbering: { reference, level: 0 },
          spacing: { after: 60 },
          children: itemChildren.length ? itemChildren : [new TextRun({ text: '', size: BODY })],
        }));
      }
      continue;
    }
    if (block.type === 'codeblock') {
      const lines = block.value.split('\n');
      for (const line of lines.length ? lines : ['']) {
        children.push(new Paragraph({
          shading: { type: ShadingType.CLEAR, fill: 'F4F4F5' },
          spacing: { after: 0 },
          children: [new TextRun({ text: line || ' ', font: 'Consolas', size: SMALL })],
        }));
      }
      children.push(new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text: '', size: BODY })] }));
      continue;
    }
    if (block.type === 'table') {
      children.push(tableFromBlock(block.headers, block.rows));
      children.push(new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text: '', size: BODY })] }));
      continue;
    }
    children.push(paragraphFromInlines(block.children));
  }
  return children;
}

function tableFromBlock(headers: MarkdownInline[][], rows: MarkdownInline[][][]): Table {
  const columnCount = Math.max(headers.length, ...rows.map(row => row.length), 1);
  const width = Math.floor(9360 / columnCount);
  const cell = (inlines: MarkdownInline[] | undefined, header: boolean) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: header ? { type: ShadingType.CLEAR, fill: 'EEF2FF' } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [paragraphFromInlines(inlines?.length ? inlines : [{ type: 'text', value: '' }], 0)],
  });
  return new Table({
    width: { size: width * columnCount, type: WidthType.DXA },
    columnWidths: Array.from({ length: columnCount }, () => width),
    rows: [
      new TableRow({
        tableHeader: true,
        children: Array.from({ length: columnCount }, (_, index) => cell(headers[index], true)),
      }),
      ...rows.map(row => new TableRow({
        children: Array.from({ length: columnCount }, (_, index) => cell(row[index], false)),
      })),
    ],
  });
}

function sourceBlocks(sources: ResearchExportSource[], emptyLabel: string): Paragraph[] {
  if (!sources.length) {
    return [new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: emptyLabel, italics: true, size: BODY, color: MUTED })],
    })];
  }
  return sources.flatMap((source, index) => {
    const note = researchSourceExportNote(source);
    const title: ParagraphChild[] = [
      new TextRun({ text: `${index + 1}. `, size: BODY }),
      new ExternalHyperlink({
        link: source.url,
        children: [new TextRun({ text: source.title, style: 'Hyperlink', size: BODY })],
      }),
    ];
    if (note) title.push(new TextRun({ text: ` — ${note}`, italics: true, size: META, color: MUTED }));
    const blocks = [
      new Paragraph({ spacing: { before: 120, after: 20 }, children: title }),
      new Paragraph({
        spacing: { after: source.snippet ? 20 : 80 },
        children: [new TextRun({ text: source.url, size: SMALL, color: '475467' })],
      }),
    ];
    if (source.snippet) {
      blocks.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: source.snippet, italics: true, size: META, color: MUTED })],
      }));
    }
    return blocks;
  });
}

function sourceSection(sources: ResearchExportSource[]): FileChild[] {
  const groups = partitionResearchExportSources(sources);
  if (!groups.labeled) return sourceBlocks(groups.sources, 'No sources were included in this brief.');
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 160, after: 80 },
      children: [new TextRun({ text: RESEARCH_EXPORT_OFFICIAL_HEADING, bold: true, size: 24, color: '2D3282' })],
    }),
    ...sourceBlocks(groups.official, 'None in this section.'),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: RESEARCH_EXPORT_OTHER_HEADING, bold: true, size: 24, color: '2D3282' })],
    }),
    ...sourceBlocks(groups.other, 'None in this section.'),
  ];
}

function subjectCard(brief: ResearchBrief): Table {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    layout: TableLayoutType.FIXED,
    borders: {
      top: noneBorder,
      bottom: noneBorder,
      left: noneBorder,
      right: noneBorder,
      insideHorizontal: noneBorder,
      insideVertical: noneBorder,
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: 'F5F7FF' },
            margins: { top: 120, bottom: 140, left: 200, right: 200 },
            borders: {
              top: hairline,
              bottom: hairline,
              left: { style: BorderStyle.SINGLE, size: 18, color: INDIGO },
              right: hairline,
            },
            children: [
              new Paragraph({
                spacing: { after: 40 },
                children: [new TextRun({ text: brief.questionLabel, bold: true, size: 16, color: INDIGO })],
              }),
              new Paragraph({
                spacing: { after: 0, line: 276, lineRule: LineRuleType.AUTO },
                children: [new TextRun({ text: brief.question, bold: true, size: 32, color: TITLE })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildResearchDocument(input: ResearchExportInput): Document {
  const brief = buildResearchBrief(input);
  const numbering: INumberingOptions['config'][number][] = [];
  const children: FileChild[] = [
    subjectCard(brief),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: 'E4E7EC', space: 1 } },
      spacing: { before: 160, after: 80 },
      children: [new TextRun({ text: researchBriefMetaLine(brief), size: META, color: '475467' })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 280, after: 120 },
      children: [new TextRun({ text: 'Answer', bold: true, size: 28, color: TITLE })],
    }),
    ...answerBlocks(brief.answer, numbering),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 320, after: 120 },
      children: [new TextRun({ text: 'Sources', bold: true, size: 28, color: TITLE })],
    }),
    ...sourceSection(brief.sources),
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'E4E7EC', space: 1 } },
      spacing: { before: 280 },
      children: [new TextRun({ text: brief.disclaimer, italics: true, size: SMALL, color: MUTED })],
    }),
  ];
  return new Document({
    creator: 'MarketingOS — Dupoin Futures',
    lastModifiedBy: 'MarketingOS — Dupoin Futures',
    title: brief.question.slice(0, 200),
    description: `${brief.brand} brief (${brief.modePhrase})`,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: BODY, color: INK },
          paragraph: { spacing: { after: 120, line: 276, lineRule: LineRuleType.AUTO } },
        },
        heading1: {
          run: { font: 'Calibri', size: 28, bold: true, color: TITLE },
          paragraph: { spacing: { before: 280, after: 120 } },
        },
        heading2: {
          run: { font: 'Calibri', size: 24, bold: true, color: '2D3282' },
          paragraph: { spacing: { before: 220, after: 80 } },
        },
        heading3: {
          run: { font: 'Calibri', size: 22, bold: true, color: TITLE },
          paragraph: { spacing: { before: 180, after: 60 } },
        },
        heading4: {
          run: { font: 'Calibri', size: 22, bold: true, color: '344054' },
          paragraph: { spacing: { before: 140, after: 60 } },
        },
        hyperlink: {
          run: { color: '3538CD' },
        },
      },
    },
    numbering: numbering.length ? { config: numbering } : undefined,
    sections: [{
      properties: {
        page: {
          margin: { top: 1008, bottom: 1008, left: 1080, right: 1080, header: 576, footer: 640 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: 'E4E7EC', space: 1 } },
            children: [new TextRun({ text: RESEARCH_BRIEF_BRAND, bold: true, size: SMALL, color: INDIGO })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'E4E7EC', space: 6 } },
            children: [new TextRun({
              size: SMALL,
              color: MUTED,
              children: [RESEARCH_BRIEF_BRAND, '  ·  Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
            })],
          })],
        }),
      },
      children,
    }],
  });
}

export async function buildResearchDocx(input: ResearchExportInput): Promise<Uint8Array> {
  const buffer = await Packer.toBuffer(buildResearchDocument(input));
  return new Uint8Array(buffer);
}

export async function buildResearchDocxBlob(input: ResearchExportInput): Promise<Blob> {
  const blob = await Packer.toBlob(buildResearchDocument(input));
  return new Blob([blob], { type: RESEARCH_DOCX_MIME });
}
