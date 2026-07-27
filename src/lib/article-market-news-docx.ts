import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

export function safeArticleFilePart(value: string): string {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'MarketNews';
}

export function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  return markdown.split('\n').map(rawLine => {
    const line = rawLine.trim();
    if (!line) return new Paragraph({ text: '' });
    if (line.startsWith('### ')) return new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3, spacing: { before: 180, after: 80 } });
    if (line.startsWith('## ')) return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 } });
    if (line.startsWith('# ')) return new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1, spacing: { after: 180 } });
    if (/^[-*] /.test(line)) return new Paragraph({ text: line.slice(2), bullet: { level: 0 } });
    return new Paragraph({ children: [new TextRun({ text: line, size: 22 })], spacing: { after: 140 }, alignment: 'both' });
  });
}

export async function buildArticleDocxBlob(title: string, metaDescription: string, articleMarkdown: string): Promise<Blob> {
  const document = new Document({
    creator: 'MarketingOS — Dupoin Futures',
    title,
    description: metaDescription,
    sections: [{ properties: {}, children: markdownToDocxParagraphs(articleMarkdown) }],
  });
  const blob = await Packer.toBlob(document);
  return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export function articleDocxFilename(keyword: string, researchDate: string): string {
  return `DUPOIN_${safeArticleFilePart(keyword)}_ArticleMarketNews_V1_${researchDate.replaceAll('-', '')}.docx`;
}
