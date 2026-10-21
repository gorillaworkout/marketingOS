'use client';

import { useState } from 'react';

type ExcelMessage = {
  role: 'assistant';
  content: string;
  attachments?: Array<{ kind: 'xlsx'; exportId: string; filename: string; source: 'tables' | 'extract'; sheetCount: number; rowCount: number }>;
  fallbackLabel?: string;
};

const actionClass = 'inline-flex h-6 shrink-0 items-center rounded-md border border-[var(--mos-border)] bg-[var(--mos-bg)] px-1.5 text-[10px] font-medium leading-none text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40';

/** Excel actions under an uploaded HTML file: export detected tables, or AI extraction. */
export function AiResearchHtmlExcelActions({
  conversationId,
  messageIndex,
  fileIndex,
  fileName,
  disabled,
  onExported,
}: {
  conversationId: string | null;
  messageIndex: number;
  fileIndex: number;
  fileName?: string;
  disabled?: boolean;
  onExported: (message: ExcelMessage) => void;
}) {
  const [busy, setBusy] = useState<'tables' | 'extract' | null>(null);
  const [error, setError] = useState('');
  const [extractOpen, setExtractOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const unavailable = !conversationId || disabled;

  const run = async (mode: 'tables' | 'extract') => {
    if (busy || unavailable) return;
    setBusy(mode);
    setError('');
    try {
      const response = await fetch('/api/ai-research/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, messageIndex, fileIndex, fileName, mode, instruction: mode === 'extract' ? instruction : undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.message) {
        setError(typeof data?.error === 'string' ? data.error : 'Could not create the Excel file.');
        return;
      }
      onExported(data.message as ExcelMessage);
      if (mode === 'extract') {
        setExtractOpen(false);
        setInstruction('');
      }
    } catch {
      setError('Could not create the Excel file.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-1 flex flex-col items-end gap-1" data-testid="ai-research-html-excel">
      <div className="flex flex-wrap items-center justify-end gap-1">
        <button
          type="button"
          data-testid="ai-research-export-tables-excel"
          className={actionClass}
          disabled={unavailable || busy !== null}
          title={unavailable ? 'Available after the answer is saved' : `Export every table in ${fileName || 'this HTML file'} to Excel`}
          onClick={() => { void run('tables'); }}
        >
          {busy === 'tables' ? 'Exporting…' : 'Export tables to Excel'}
        </button>
        <button
          type="button"
          data-testid="ai-research-extract-excel-toggle"
          className={actionClass}
          disabled={unavailable || busy !== null}
          onClick={() => setExtractOpen(open => !open)}
        >
          Extract to Excel…
        </button>
      </div>
      {extractOpen && (
        <form
          className="flex w-full max-w-sm items-center gap-1"
          onSubmit={event => { event.preventDefault(); void run('extract'); }}
        >
          <input
            data-testid="ai-research-extract-instruction"
            value={instruction}
            onChange={event => setInstruction(event.target.value)}
            maxLength={1000}
            placeholder="e.g. extract product name, price, date"
            aria-label="What to extract"
            className="h-7 min-w-0 flex-1 rounded-md border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2 text-[11px] text-[var(--mos-text)]"
          />
          <button
            type="submit"
            data-testid="ai-research-extract-excel"
            className={actionClass}
            disabled={busy !== null || instruction.trim().length < 3}
          >
            {busy === 'extract' ? 'Extracting…' : 'Extract'}
          </button>
        </form>
      )}
      {error && <p className="text-[10px] text-red-300" role="alert">{error}</p>}
    </div>
  );
}
