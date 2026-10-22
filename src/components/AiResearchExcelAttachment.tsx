'use client';

import { useState } from 'react';

const KIND_STYLE = {
  xlsx: { badge: 'XLSX', badgeClass: 'bg-emerald-600/20 text-emerald-300' },
  pdf: { badge: 'PDF', badgeClass: 'bg-red-600/20 text-red-300' },
  docx: { badge: 'DOCX', badgeClass: 'bg-sky-600/20 text-sky-300' },
  csv: { badge: 'CSV', badgeClass: 'bg-teal-600/20 text-teal-300' },
  zip: { badge: 'ZIP', badgeClass: 'bg-amber-600/20 text-amber-300' },
} as const;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Generated file card (Excel, PDF, or Word) with Download and Copy link. */
export function AiResearchExcelAttachment({
  exportId,
  filename,
  sheetCount,
  rowCount,
  kind = 'xlsx',
  byteSize,
}: {
  exportId: string;
  filename: string;
  sheetCount: number;
  rowCount: number;
  kind?: 'xlsx' | 'pdf' | 'docx' | 'csv' | 'zip';
  byteSize?: number;
}) {
  const style = KIND_STYLE[kind] ?? KIND_STYLE.xlsx;
  const size = byteSize ? ` · ${formatBytes(byteSize)}` : '';
  const detail = kind === 'pdf'
    ? `PDF document${size}`
    : kind === 'docx'
      ? `Word document${size}`
      : kind === 'csv'
        ? `CSV file · ${rowCount} ${rowCount === 1 ? 'row' : 'rows'}${size}`
        : kind === 'zip'
          ? `ZIP of CSV files · ${sheetCount} ${sheetCount === 1 ? 'table' : 'tables'} · ${rowCount} ${rowCount === 1 ? 'row' : 'rows'}${size}`
          : `Excel workbook · ${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'} · ${rowCount} ${rowCount === 1 ? 'row' : 'rows'}${size}`;
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
      data-kind={kind}
      className="mt-2 flex items-center gap-3 rounded-xl border border-[var(--mos-border)] bg-[var(--mos-bg)] px-3 py-2"
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${style.badgeClass}`} aria-hidden="true">
        {style.badge}
      </div>
      <a href={href} download={filename} className="min-w-0 flex-1" title={`Download ${filename}`}>
        <p className="truncate text-xs font-medium text-[var(--mos-text)] hover:underline">{filename}</p>
        <p className="text-[10px] text-[var(--mos-text-muted)]">{detail}</p>
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
