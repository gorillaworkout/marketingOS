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
  const [busy, setBusy] = useState<'md' | 'pdf' | 'docx' | null>(null);
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

  const download = async (extension: 'md' | 'pdf' | 'docx') => {
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

  return (
    <div className="mt-2" data-testid="ai-research-export">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => { void copyMarkdown(); }}
          className="rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
        >
          {copied ? 'Copied' : 'Copy Markdown'}
        </button>
        <button
          type="button"
          data-testid="ai-research-download-md"
          onClick={() => { void download('md'); }}
          disabled={busy !== null}
          className="rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40"
        >
          {busy === 'md' ? 'Preparing…' : 'Download .md'}
        </button>
        <button
          type="button"
          data-testid="ai-research-download-pdf"
          onClick={() => { void download('pdf'); }}
          disabled={busy !== null}
          className="rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40"
        >
          {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
        </button>
        <button
          type="button"
          data-testid="ai-research-download-word"
          onClick={() => { void download('docx'); }}
          disabled={busy !== null}
          className="rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40"
        >
          {busy === 'docx' ? 'Preparing…' : 'Download Word'}
        </button>
      </div>
      {exportError && <p className="mt-1 px-1 text-[10px] text-red-300">{exportError}</p>}
    </div>
  );
}
