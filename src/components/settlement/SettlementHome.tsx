'use client';

import { useCallback, useEffect, useState } from 'react';
import { DataTableFrame, EmptyState } from '@/components/ui/dashboard';
import { formatDateTimeWib, formatInteger } from '@/components/monthly-report/brand';
import { SettlementUploadPanel } from './SettlementUploadPanel';

type Upload = {
  id: string;
  kind: string;
  file_name: string;
  uploaded_by_name: string | null;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  data_from: string | null;
  data_to: string | null;
  created_at: string;
};

type History = {
  uploads: Upload[];
  total: number;
  page: number;
  pageCount: number;
  coverage: Record<string, string | null>;
  labels: Record<string, string>;
};

const KINDS = ['settlement_crm_deposit', 'settlement_crm_withdrawal', 'settlement_mt5_dw', 'settlement_ftd'] as const;

export function SettlementHome({ onImported }: { onImported?: () => void }) {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback((nextPage: number) => {
    fetch(`/api/settlement-report/uploads?page=${nextPage}&pageSize=25`).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not load upload history');
        return;
      }
      setError('');
      setHistory(data);
    });
  }, []);

  useEffect(() => { load(page); }, [load, page]);

  const labels = history?.labels ?? {};
  const coverage = history?.coverage ?? {};

  return (
    <>
      <p className="text-xs text-[var(--mos-text-muted)]">
        {KINDS.map((kind, index) => (
          <span key={kind}>
            {index > 0 ? ' · ' : ''}
            {labels[kind] ?? kind} through <span className="font-medium text-[var(--mos-text-secondary)]">{coverage[kind] ?? 'no uploads yet'}</span>
          </span>
        ))}
        <span className="text-[var(--mos-text-faint)]"> (WIB)</span>
      </p>
      <SettlementUploadPanel onImported={() => { load(page); onImported?.(); }} />
      {error && <p className="text-xs text-red-300">{error}</p>}
      <DataTableFrame title="Upload history" description="Newest first. Re-uploading the same export updates changed rows and leaves the rest unchanged.">
        {!history ? <p className="px-5 py-6 text-xs text-[var(--mos-text-muted)]">Loading…</p> : history.uploads.length === 0 ? (
          <EmptyState title="No settlement uploads yet" description="Upload a CRM deposit report, a CRM withdrawal report, an MT5 Deposit and Withdrawal export, or a Dealing FTD list." />
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--mos-text-faint)]">
              <tr>{['File', 'Type', 'Inserted', 'Updated', 'Skipped', 'Data (WIB)', 'Uploader', 'When'].map(heading => <th key={heading} className="px-4 py-2.5 font-medium">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {history.uploads.map(upload => (
                <tr key={upload.id} className="border-t border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]">
                  <td className="max-w-xs truncate px-4 py-2.5" title={upload.file_name}>{upload.file_name}</td>
                  <td className="px-4 py-2.5">{labels[upload.kind] ?? upload.kind}</td>
                  <td className="px-4 py-2.5 text-right">{formatInteger(upload.rows_inserted)}</td>
                  <td className="px-4 py-2.5 text-right">{formatInteger(upload.rows_updated)}</td>
                  <td className="px-4 py-2.5 text-right">{formatInteger(upload.rows_skipped)}</td>
                  <td className="px-4 py-2.5">{upload.data_from && upload.data_to ? `${upload.data_from} – ${upload.data_to}` : '—'}</td>
                  <td className="px-4 py-2.5">{upload.uploaded_by_name ?? '—'}</td>
                  <td className="px-4 py-2.5">{formatDateTimeWib(upload.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {history && history.pageCount > 1 && (
          <div className="flex items-center gap-3 px-4 py-3 text-xs text-[var(--mos-text-muted)]">
            <button type="button" className="underline disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {history.page} of {history.pageCount} ({formatInteger(history.total)} uploads)</span>
            <button type="button" className="underline disabled:opacity-40" disabled={page >= history.pageCount} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </DataTableFrame>
    </>
  );
}
