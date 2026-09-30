'use client';

import { useState } from 'react';
import { deliverResearchFile } from '@/lib/ai-research-client-download';
import { researchExportFilename, type ResearchExportSource } from '@/lib/ai-research-export';

type FileAction = 'open-pdf' | 'download-pdf' | 'download-docx';

const actionClass = 'rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40';

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

  const deliver = async (action: FileAction) => {
    if (busy) return;
    setBusy(action);
    setError('');
    try {
      if (action === 'open-pdf') await deliverResearchFile(input, 'pdf', true);
      else if (action === 'download-pdf') await deliverResearchFile(input, 'pdf');
      else await deliverResearchFile(input, 'docx');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the research file');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 w-full min-w-[240px] space-y-2" data-testid="ai-research-chat-files">
      <article
        data-testid="ai-research-chat-pdf"
        className="rounded-2xl rounded-tl-md border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 py-2.5"
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-[9px] font-bold tracking-wide text-red-200">
            PDF
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-[var(--mos-text)]">Research PDF</p>
            <p className="truncate text-[10px] text-[var(--mos-text-muted)]" title={pdfName}>{pdfName}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            data-testid="ai-research-open-pdf"
            onClick={() => { void deliver('open-pdf'); }}
            disabled={busy !== null}
            className={actionClass}
          >
            {busy === 'open-pdf' ? 'Opening…' : 'Open PDF'}
          </button>
          <button
            type="button"
            data-testid="ai-research-chat-download-pdf"
            onClick={() => { void deliver('download-pdf'); }}
            disabled={busy !== null}
            className={actionClass}
          >
            {busy === 'download-pdf' ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </article>
      <article
        data-testid="ai-research-chat-word"
        className="rounded-2xl rounded-tl-md border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 py-2.5"
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-[9px] font-bold tracking-wide text-indigo-200">
            DOC
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-[var(--mos-text)]">Research Word</p>
            <p className="truncate text-[10px] text-[var(--mos-text-muted)]" title={wordName}>{wordName}</p>
          </div>
        </div>
        <div className="mt-2">
          <button
            type="button"
            data-testid="ai-research-chat-download-word"
            onClick={() => { void deliver('download-docx'); }}
            disabled={busy !== null}
            className={actionClass}
          >
            {busy === 'download-docx' ? 'Preparing…' : 'Download Word'}
          </button>
        </div>
      </article>
      {error && <p className="px-1 text-[10px] text-red-300">{error}</p>}
    </div>
  );
}
