'use client';

import { useState } from 'react';

export function AiResearchExcelAttachment({
  exportId,
  filename,
  sheetCount,
  rowCount,
}: {
  exportId: string;
  filename: string;
  sheetCount: number;
  rowCount: number;
}) {
  const [copied, setCopied] = useState(false);
  const href = `/api/ai-research/exports/${encodeURIComponent(exportId)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      data-testid="ai-research-excel-attachment"
      className="mt-2 flex items-center gap-3 rounded-xl border border-[var(--mos-border)] bg-[var(--mos-bg)] px-3 py-2"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-600/20 text-[10px] font-bold text-emerald-300" aria-hidden="true">
        XLSX
      </div>
      <a href={href} download={filename} className="min-w-0 flex-1" title={`Download ${filename}`}>
        <p className="truncate text-xs font-medium text-[var(--mos-text)] hover:underline">{filename}</p>
        <p className="text-[10px] text-[var(--mos-text-muted)]">
          Excel workbook · {sheetCount} {sheetCount === 1 ? 'sheet' : 'sheets'} · {rowCount} {rowCount === 1 ? 'row' : 'rows'}
        </p>
      </a>
      <a
        href={href}
        download={filename}
        data-testid="ai-research-excel-download"
        className="inline-flex h-6 shrink-0 items-center rounded-md border border-[var(--mos-border)] px-1.5 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
      >
        Download
      </a>
      <button
        type="button"
        onClick={() => { void copyLink(); }}
        className="inline-flex h-6 shrink-0 items-center rounded-md border border-[var(--mos-border)] px-1.5 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>
    </div>
  );
}
