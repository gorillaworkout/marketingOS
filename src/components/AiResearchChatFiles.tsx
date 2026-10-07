'use client';

import { useState } from 'react';
import { deliverResearchFile } from '@/lib/ai-research-client-download';
import { researchExportFilename, type ResearchExportSource } from '@/lib/ai-research-export';

type FileAction = 'open-pdf' | 'download-pdf' | 'download-docx' | 'open-html' | 'download-html' | 'download-zip';

const actionClass = 'inline-flex h-6 shrink-0 items-center rounded-md border border-[var(--mos-border)] bg-[var(--mos-bg)] px-1.5 text-[10px] font-medium leading-none text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40';

export function AiResearchChatFiles({
  title,
  answer,
  sources,
  mode,
}: {
  title: string;
  answer: string;
  sources: ResearchExportSource[];
  mode?: 'fast' | 'deep';
}) {
  const [busy, setBusy] = useState<FileAction | null>(null);
  const [error, setError] = useState('');
  const input = { title, answer, sources, mode };
  const pdfName = researchExportFilename(title, 'pdf');
  const wordName = researchExportFilename(title, 'docx');
  const htmlName = researchExportFilename(title, 'html');
  const zipName = researchExportFilename(title, 'zip');

  const deliver = async (action: FileAction) => {
    if (busy) return;
    setBusy(action);
    setError('');
    try {
      if (action === 'open-pdf') await deliverResearchFile(input, 'pdf', true);
      else if (action === 'download-pdf') await deliverResearchFile(input, 'pdf');
      else if (action === 'download-docx') await deliverResearchFile(input, 'docx');
      else if (action === 'open-html') await deliverResearchFile(input, 'html', true);
      else if (action === 'download-html') await deliverResearchFile(input, 'html');
      else await deliverResearchFile(input, 'zip');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the research file');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-1 flex flex-nowrap items-center gap-1 overflow-x-auto" data-testid="ai-research-chat-files">
      <button
        type="button"
        data-testid="ai-research-open-pdf"
        onClick={() => { void deliver('open-pdf'); }}
        disabled={busy !== null}
        aria-label="Open PDF"
        title={`Research PDF: ${pdfName}`}
        className={actionClass}
      >
        {busy === 'open-pdf' ? 'Opening…' : 'Open PDF'}
      </button>
      <button
        type="button"
        data-testid="ai-research-chat-download-pdf"
        data-file="ai-research-chat-pdf"
        onClick={() => { void deliver('download-pdf'); }}
        disabled={busy !== null}
        aria-label="Download PDF"
        title={`Research PDF: ${pdfName}`}
        className={actionClass}
      >
        {busy === 'download-pdf' ? 'Preparing…' : 'Download PDF'}
      </button>
      <button
        type="button"
        data-testid="ai-research-chat-download-word"
        data-file="ai-research-chat-word"
        onClick={() => { void deliver('download-docx'); }}
        disabled={busy !== null}
        aria-label="Download Word"
        title={`Research Word: ${wordName}`}
        className={actionClass}
      >
        {busy === 'download-docx' ? 'Preparing…' : 'Download Word'}
      </button>
      <button
        type="button"
        data-testid="ai-research-open-html"
        onClick={() => { void deliver('open-html'); }}
        disabled={busy !== null}
        aria-label="Open HTML"
        title={`Research HTML: ${htmlName}`}
        className={actionClass}
      >
        {busy === 'open-html' ? 'Opening…' : 'Open HTML'}
      </button>
      <button
        type="button"
        data-testid="ai-research-chat-download-html"
        data-file="ai-research-chat-html"
        onClick={() => { void deliver('download-html'); }}
        disabled={busy !== null}
        aria-label="Download HTML"
        title={`Research HTML: ${htmlName}`}
        className={actionClass}
      >
        {busy === 'download-html' ? 'Preparing…' : 'Download HTML'}
      </button>
      <button
        type="button"
        data-testid="ai-research-chat-download-zip"
        data-file="ai-research-chat-zip"
        onClick={() => { void deliver('download-zip'); }}
        disabled={busy !== null}
        aria-label="Download ZIP"
        title={`Research ZIP: ${zipName}`}
        className={actionClass}
      >
        {busy === 'download-zip' ? 'Preparing…' : 'Download ZIP'}
      </button>
      {error && <p className="shrink-0 px-1 text-[10px] text-red-300">{error}</p>}
    </div>
  );
}
