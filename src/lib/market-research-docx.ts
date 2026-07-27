import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { MarketResearchItem } from './market-research';

function labelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun({ text: value })],
    spacing: { after: 90 },
  });
}

export async function buildMarketResearchDocxBlob(brief: string, researchDate: string, items: MarketResearchItem[]): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({ text: 'Latest Market News Research & Selection', heading: HeadingLevel.TITLE }),
    labelValue('Research Date (WIB)', researchDate),
    labelValue('Brief', brief),
    new Paragraph({ text: 'Verification notice: publisher RSS metadata is used for AI-assisted selection. Open every source link and review the complete article before external use.', spacing: { after: 240 } }),
  ];
  items.forEach((item, index) => {
    children.push(
      new Paragraph({ text: `${index + 1}. ${item.articleTitle}`, heading: HeadingLevel.HEADING_1, pageBreakBefore: index > 0 }),
      labelValue('News Source', item.newsSource),
      labelValue('Publication Date', item.publicationDate),
      labelValue('Publication Time (WIB)', item.publicationTime),
      labelValue('Latest Update Time (WIB)', item.latestUpdateTime || 'Not provided by publisher feed'),
      labelValue('Product Category', item.productCategory),
      labelValue('Main Event', item.mainEvent),
      labelValue('Latest Factual Development', item.latestFactualDevelopment),
      labelValue('Market Relevance', item.marketRelevance),
      new Paragraph({
        children: [new TextRun({ text: 'Article URL: ', bold: true }), new ExternalHyperlink({ children: [new TextRun({ text: item.articleUrl, style: 'Hyperlink' })], link: item.articleUrl })],
        spacing: { after: 120 },
      }),
      labelValue('Evidence Level', 'Publisher metadata — manual full-article review required'),
    );
  });
  const document = new Document({
    creator: 'MarketingOS — Dupoin Futures',
    title: 'Latest Market News Research & Selection',
    description: brief,
    sections: [{ properties: {}, children }],
  });
  const blob = await Packer.toBlob(document);
  return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export function marketResearchDocxFilename(researchDate: string): string {
  return `DUPOIN_Latest_Market_News_MarketResearch_V1_${researchDate.replaceAll('-', '')}.docx`;
}
