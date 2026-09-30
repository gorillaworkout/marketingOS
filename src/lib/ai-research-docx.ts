import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type INumberingOptions,
  type ParagraphChild,
} from 'docx';
import { AI_RESEARCH_ASSISTANT_NAME } from './ai-research';
import {
  RESEARCH_EXPORT_DISCLAIMER,
  RESEARCH_EXPORT_OFFICIAL_HEADING,
  RESEARCH_EXPORT_OTHER_HEADING,
  partitionResearchExportSources,
  researchExportModeLabel,
  researchExportSources,
  researchExportTitle,
  researchSourceExportNote,
  type ResearchExportInput,
  type ResearchExportSource,
} from './ai-research-export';
import { parseMarkdown, type MarkdownInline } from './ai-research-markdown';

export const RESEARCH_DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const BODY = 22;
const META = 20;
const SMALL = 18;

function inlineChildren(nodes: MarkdownInline[], marks: { bold?: boolean; italics?: boolean } = {}): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const parts = node.value.split('\n');
      parts.forEach((part, index) => {
        if (index > 0) children.push(new TextRun({ break: 1 }));
        if (part) children.push(new TextRun({ text: part, bold: marks.bold, italics: marks.italics, size: BODY }));
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
      children: [new TextRun({ text: label, style: 'Hyperlink', bold: marks.bold, italics: marks.italics, size: BODY })],
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

function paragraphFromInlines(nodes: MarkdownInline[], spacingAfter = 140): Paragraph {
  const children = inlineChildren(nodes);
  return new Paragraph({
    spacing: { after: spacingAfter },
    children: children.length ? children : [new TextRun({ text: '', size: BODY })],
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
      children.push(new Paragraph({
        heading: level,
        spacing: { before: 200, after: 80 },
        children: inlineChildren(block.children),
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
      children: [new TextRun({ text: emptyLabel, italics: true, size: BODY, color: '667085' })],
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
    if (note) title.push(new TextRun({ text: ` — ${note}`, italics: true, size: META, color: '667085' }));
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
        children: [new TextRun({ text: source.snippet, italics: true, size: META, color: '475467' })],
      }));
    }
    return blocks;
  });
}

function sourceSection(sources: ResearchExportSource[]): FileChild[] {
  const groups = partitionResearchExportSources(sources);
  if (!groups.labeled) return sourceBlocks(groups.sources, 'No sources were saved on this message.');
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 160, after: 80 },
      children: [new TextRun(RESEARCH_EXPORT_OFFICIAL_HEADING)],
    }),
    ...sourceBlocks(groups.official, 'None in this section.'),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 80 },
      children: [new TextRun(RESEARCH_EXPORT_OTHER_HEADING)],
    }),
    ...sourceBlocks(groups.other, 'None in this section.'),
  ];
}

function buildResearchDocument(input: ResearchExportInput): Document {
  const title = researchExportTitle(input.title || 'Dupoin AI research');
  const when = (input.exportedAt ?? new Date()).toISOString().slice(0, 10);
  const modeLabel = researchExportModeLabel(input.mode);
  const numbering: INumberingOptions['config'][number][] = [];
  const children: FileChild[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 160 },
      children: [new TextRun(title)],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: 'Assistant: ', bold: true, size: META, color: '475467' }),
        new TextRun({ text: AI_RESEARCH_ASSISTANT_NAME, size: META, color: '475467' }),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: 'Mode: ', bold: true, size: META, color: '475467' }),
        new TextRun({ text: modeLabel, size: META, color: '475467' }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: 'Exported: ', bold: true, size: META, color: '475467' }),
        new TextRun({ text: when, size: META, color: '475467' }),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 120, after: 120 },
      children: [new TextRun('Answer')],
    }),
    ...answerBlocks(input.answer, numbering),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 280, after: 120 },
      children: [new TextRun('Sources')],
    }),
    ...sourceSection(researchExportSources(input.sources)),
    new Paragraph({
      spacing: { before: 280 },
      children: [new TextRun({ text: RESEARCH_EXPORT_DISCLAIMER, italics: true, size: SMALL, color: '667085' })],
    }),
  ];
  return new Document({
    creator: 'MarketingOS — Dupoin Futures',
    title,
    description: `Dupoin AI Research export (${modeLabel})`,
    numbering: numbering.length ? { config: numbering } : undefined,
    sections: [{
      properties: {
        page: {
          margin: { top: 1008, bottom: 1008, left: 1080, right: 1080, header: 576, footer: 576 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: 'Dupoin AI Research', bold: true, size: SMALL, color: '444CE7' })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [new TextRun({
              size: SMALL,
              color: '667085',
              children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
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
