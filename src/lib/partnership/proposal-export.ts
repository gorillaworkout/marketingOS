/** Proposal exports: PDF (slide or document template) and PPTX (slide template). Server only. */
import { createPdfCanvas, createPptxCanvas } from './proposal-canvas';
import { renderDocumentPdf } from './proposal-document';
import { drawSlides } from './proposal-slides';
import { safeFileName, type ProposalDocument, type ProposalTemplate } from './proposal';

export type ExportFormat = 'pdf' | 'pptx';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export interface ExportedProposal { data: Buffer; mime: string; fileName: string; pages: number }

export function exportFileName(partnerName: string, template: ProposalTemplate, format: ExportFormat): string {
  return `Dupoin-x-${safeFileName(partnerName)}-${template === 'slide' ? 'Slides' : 'A4'}.${format}`;
}

export async function exportProposal(doc: ProposalDocument, template: ProposalTemplate, format: ExportFormat): Promise<ExportedProposal> {
  if (format === 'pptx' && template !== 'slide') throw new Error('PPTX export is available for the Slide 16:9 template only.');
  const fileName = exportFileName(doc.partnerName, template, format);
  if (template === 'document') {
    const { data, pages } = await renderDocumentPdf(doc);
    return { data, pages, mime: EXPORT_MIME.pdf, fileName };
  }
  const canvas = format === 'pptx' ? createPptxCanvas() : createPdfCanvas();
  const pages = await drawSlides(canvas, doc);
  return { data: await canvas.finish(), pages, mime: EXPORT_MIME[format], fileName };
}
