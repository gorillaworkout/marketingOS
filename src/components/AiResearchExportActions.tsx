'use client';

import { useState } from 'react';
import { deliverResearchFile } from '@/lib/ai-research-client-download';
import {
  buildResearchMarkdownExport,
  type ResearchExportSource,
} from '@/lib/ai-research-export';

export function AiResearchExportActions({
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
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'md' | 'pdf' | 'docx' | 'html' | 'zip' | null>(null);
  const [exportError, setExportError] = useState('');

  const markdown = () => buildResearchMarkdownExport({ title, answer, sources, mode });

  const copyMarkdown = async () => {
    const text = markdown();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'true');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    setExportError('');
    window.setTimeout(() => setCopied(false), 1600);
  };

  const download = async (extension: 'md' | 'pdf' | 'docx' | 'html' | 'zip') => {
    if (busy) return;
    setBusy(extension);
    setExportError('');
    try {
      await deliverResearchFile({ title, answer, sources, mode }, extension);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not export the answer');
    } finally {
      setBusy(null);
    }
  };

  const actionClass = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-[var(--mos-border)] bg-[var(--mos-bg)] px-1.5 text-[10px] font-medium leading-none text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40';

  return (
    <div className="mt-1 flex flex-nowrap items-center gap-1 overflow-x-auto" data-testid="ai-research-export">
      <button
        type="button"
        onClick={() => { void copyMarkdown(); }}
        aria-label="Copy Markdown"
        className={actionClass}
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        data-testid="ai-research-download-md"
        onClick={() => { void download('md'); }}
        disabled={busy !== null}
        aria-label="Download .md"
        className={actionClass}
      >
        {busy === 'md' ? 'Preparing…' : '.md'}
      </button>
      <button
        type="button"
        data-testid="ai-research-download-pdf"
        onClick={() => { void download('pdf'); }}
        disabled={busy !== null}
        aria-label="Download PDF"
        className={actionClass}
      >
        {busy === 'pdf' ? 'Preparing…' : 'PDF'}
      </button>
      <button
        type="button"
        data-testid="ai-research-download-word"
        onClick={() => { void download('docx'); }}
        disabled={busy !== null}
        aria-label="Download Word"
        className={actionClass}
      >
        {busy === 'docx' ? 'Preparing…' : 'Word'}
      </button>
      <button
        type="button"
        data-testid="ai-research-download-html"
        onClick={() => { void download('html'); }}
        disabled={busy !== null}
        aria-label="Download HTML"
        className={actionClass}
      >
        {busy === 'html' ? 'Preparing…' : 'HTML'}
      </button>
      <button
        type="button"
        data-testid="ai-research-download-zip"
        onClick={() => { void download('zip'); }}
        disabled={busy !== null}
        aria-label="Download ZIP"
        className={actionClass}
      >
        {busy === 'zip' ? 'Preparing…' : 'ZIP'}
      </button>
      {exportError && <p className="shrink-0 px-1 text-[10px] text-red-300">{exportError}</p>}
    </div>
  );
}
