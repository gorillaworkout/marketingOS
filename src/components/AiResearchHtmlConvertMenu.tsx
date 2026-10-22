'use client';

import { useEffect, useRef, useState } from 'react';
import type { AiResearchHtmlFileResult } from '@/components/AiResearchHtmlExcelActions';

const FORMATS = [
  { format: 'xlsx', label: 'Excel (.xlsx)' },
  { format: 'pdf', label: 'PDF' },
  { format: 'docx', label: 'Word (.docx)' },
] as const;

type Format = (typeof FORMATS)[number]['format'];

const buttonClass = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-[var(--mos-border)] bg-[var(--mos-bg)] px-1.5 text-[10px] font-medium leading-none text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40';

/** Compact "Convert" menu for an uploaded HTML file: Excel, PDF, or Word. */
export function AiResearchHtmlConvertMenu({
  uploadId,
  conversationId,
  projectId,
  fileName,
  disabled,
  onResult,
  onError,
}: {
  uploadId?: string;
  conversationId: string | null;
  projectId?: string | null;
  fileName?: string;
  disabled?: boolean;
  onResult: (result: AiResearchHtmlFileResult) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const unavailable = !uploadId || disabled;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const convert = async (format: Format) => {
    if (!uploadId || busy) return;
    setOpen(false);
    setBusy(format);
    onError('');
    try {
      const response = await fetch('/api/ai-research/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, format, conversationId, projectId: projectId ?? null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.conversationId || !Array.isArray(data?.messages)) {
        onError(typeof data?.error === 'string' ? data.error : 'Could not convert the file.');
        return;
      }
      onResult({ conversationId: data.conversationId, messages: data.messages, created: Boolean(data.created) });
    } catch {
      onError('Could not convert the file.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={rootRef} className="relative" data-testid="ai-research-html-convert">
      <button
        type="button"
        data-testid="ai-research-html-convert-toggle"
        className={buttonClass}
        disabled={unavailable || busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        title={uploadId ? `Convert ${fileName || 'this HTML file'}` : 'Re-upload this file to convert it'}
        onClick={() => setOpen(value => !value)}
      >
        {busy ? 'Converting…' : 'Convert'}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[8.5rem] overflow-hidden rounded-md border border-[var(--mos-border)] bg-[var(--mos-raised)] py-1 shadow-lg"
        >
          {FORMATS.map(item => (
            <button
              key={item.format}
              type="button"
              role="menuitem"
              data-testid={`ai-research-html-convert-${item.format}`}
              className="block w-full px-2.5 py-1.5 text-left text-[11px] text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
              onClick={() => { void convert(item.format); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
