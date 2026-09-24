'use client';

import { useState } from 'react';
import {
  buildResearchMarkdownExport,
  buildResearchPdf,
  researchExportFilename,
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

  const download = (extension: 'md' | 'pdf') => {
    try {
      const filename = researchExportFilename(title, extension);
      const blob = extension === 'md'
        ? new Blob([markdown()], { type: 'text/markdown;charset=utf-8' })
        : new Blob([buildResearchPdf({ title, answer, sources, mode }).slice()], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportError('');
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not export the answer');
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
          onClick={() => download('md')}
          className="rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
        >
          Download .md
        </button>
        <button
          type="button"
          onClick={() => download('pdf')}
          className="rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
        >
          Download PDF
        </button>
      </div>
      {exportError && <p className="mt-1 px-1 text-[10px] text-red-300">{exportError}</p>}
    </div>
  );
}
