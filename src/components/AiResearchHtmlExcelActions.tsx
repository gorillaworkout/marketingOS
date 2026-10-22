'use client';

import { useState } from 'react';
import type { AiResearchChatMessage } from '@/lib/ai-research';
import { AiResearchHtmlConvertMenu } from '@/components/AiResearchHtmlConvertMenu';

/** What the convert/export endpoints return: messages to append, and the thread they went to. */
export interface AiResearchHtmlFileResult {
  conversationId: string;
  messages: AiResearchChatMessage[];
  created: boolean;
}

const actionClass = 'inline-flex h-6 shrink-0 items-center rounded-md border border-[var(--mos-border)] bg-[var(--mos-bg)] px-1.5 text-[10px] font-medium leading-none text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40';

/**
 * Actions on an uploaded HTML file: Convert (Excel/PDF/Word), export detected
 * tables, or AI extraction. With an uploadId they work right after upload,
 * before any question is sent.
 */
export function AiResearchHtmlExcelActions({
  uploadId,
  conversationId,
  projectId,
  messageIndex,
  fileIndex,
  fileName,
  disabled,
  uploading,
  uploadError,
  showName,
  tableNames,
  onRetryUpload,
  onResult,
}: {
  uploadId?: string;
  conversationId: string | null;
  projectId?: string | null;
  messageIndex?: number;
  fileIndex?: number;
  fileName?: string;
  disabled?: boolean;
  uploading?: boolean;
  uploadError?: string;
  showName?: boolean;
  /** Detected table names, for choosing one table when converting to CSV. */
  tableNames?: string[];
  /** Shown after a failed upload. */
  onRetryUpload?: () => void;
  onResult: (result: AiResearchHtmlFileResult) => void;
}) {
  const [busy, setBusy] = useState<'tables' | 'extract' | null>(null);
  const [error, setError] = useState('');
  const [extractOpen, setExtractOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [extractOutput, setExtractOutput] = useState<'xlsx' | 'csv'>('xlsx');
  const unavailable = Boolean(disabled || uploading || (!uploadId && !conversationId));

  const run = async (mode: 'tables' | 'extract') => {
    if (busy || unavailable) return;
    setBusy(mode);
    setError('');
    try {
      const response = await fetch('/api/ai-research/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          conversationId,
          projectId: projectId ?? null,
          messageIndex: messageIndex ?? -1,
          fileIndex: fileIndex ?? 0,
          fileName,
          mode,
          instruction: mode === 'extract' ? instruction : undefined,
          output: mode === 'extract' ? extractOutput : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.conversationId || !Array.isArray(data?.messages)) {
        setError(typeof data?.error === 'string' ? data.error : 'Could not create the Excel file.');
        return;
      }
      onResult({ conversationId: data.conversationId, messages: data.messages, created: Boolean(data.created) });
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
        {showName && fileName && (
          <span className="max-w-[12rem] truncate text-[10px] text-[var(--mos-text-muted)]" title={fileName}>{fileName}</span>
        )}
        {uploading && <span className="text-[10px] text-[var(--mos-text-muted)]">Preparing…</span>}
        {onRetryUpload && (
          <button type="button" data-testid="ai-research-html-upload-retry" className={actionClass} onClick={onRetryUpload}>
            Retry
          </button>
        )}
        <AiResearchHtmlConvertMenu
          uploadId={uploading ? undefined : uploadId}
          conversationId={conversationId}
          projectId={projectId}
          fileName={fileName}
          tableNames={tableNames}
          disabled={disabled || uploading || busy !== null}
          onResult={onResult}
          onError={setError}
        />
        <button
          type="button"
          data-testid="ai-research-export-tables-excel"
          className={actionClass}
          disabled={unavailable || busy !== null}
          title={uploading ? 'Preparing the file…' : `Export every table in ${fileName || 'this HTML file'} to Excel`}
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
          Extract to Excel/CSV…
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
          <select
            data-testid="ai-research-extract-output"
            value={extractOutput}
            onChange={event => setExtractOutput(event.target.value === 'csv' ? 'csv' : 'xlsx')}
            aria-label="Output format"
            className="h-7 rounded-md border border-[var(--mos-border)] bg-[var(--mos-bg)] px-1 text-[11px] text-[var(--mos-text)]"
          >
            <option value="xlsx">Excel</option>
            <option value="csv">CSV</option>
          </select>
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
      {(error || uploadError) && <p className="text-[10px] text-red-300" role="alert">{error || uploadError}</p>}
    </div>
  );
}
