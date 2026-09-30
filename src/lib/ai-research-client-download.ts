import {
  buildResearchMarkdownExport,
  buildResearchPdf,
  researchExportFilename,
  type ResearchExportInput,
} from './ai-research-export';

function saveBlob(blob: Blob, filename: string, open: boolean) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  if (open) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  } else {
    link.download = filename;
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), open ? 60_000 : 1_000);
}

/** Download or open the research file already shown in the chat. */
export async function deliverResearchFile(
  input: ResearchExportInput,
  extension: 'md' | 'pdf' | 'docx',
  open = false,
): Promise<void> {
  const filename = researchExportFilename(input.title, extension, input.exportedAt);
  if (extension === 'md') {
    saveBlob(new Blob([buildResearchMarkdownExport(input)], { type: 'text/markdown;charset=utf-8' }), filename, false);
    return;
  }
  if (extension === 'pdf') {
    const bytes = buildResearchPdf(input);
    saveBlob(new Blob([bytes.slice()], { type: 'application/pdf' }), filename, open);
    return;
  }
  const { buildResearchDocxBlob } = await import('./ai-research-docx');
  saveBlob(await buildResearchDocxBlob(input), filename, false);
}
