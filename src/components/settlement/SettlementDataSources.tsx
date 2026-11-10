'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DataTableFrame, EmptyState, StatusBadge } from '@/components/ui/dashboard';
import { formatDateTimeWib, formatInteger } from '@/components/monthly-report/brand';
import { ingestDealsBytes } from '@/lib/settlement/deals-ingest';
import { MAX_CHUNK_BYTES, MAX_CHUNK_DEALS, type ParsedDeal } from '@/lib/settlement/deals-parse';
import { sourceFreshness } from '@/lib/settlement/summary';
import { routeSettlementFile } from '@/lib/settlement/upload-route';
import { todayWib } from './report/labels';
import { SettlementUploadPanel, type SettlementUploadHandle } from './SettlementUploadPanel';

type Upload = {
  id: string; kind: string; file_name: string; uploaded_by_name: string | null;
  rows_inserted: number; rows_updated: number; rows_skipped: number;
  data_from: string | null; data_to: string | null; created_at: string;
};
type History = {
  uploads: Upload[]; total: number; page: number; pageCount: number;
  coverage: Record<string, string | null>; labels: Record<string, string>; dealsHistoryThrough?: string | null;
};

const CARDS = [
  ['settlement_crm_deposit', 'CRM Deposit'],
  ['settlement_crm_withdrawal', 'CRM Withdrawal'],
  ['settlement_mt5_dw', 'MT5 Deposit & Withdrawal'],
  ['settlement_ftd', 'Dealing FTD list'],
] as const;

async function postDeals(payload: unknown) {
  const body = JSON.stringify(payload);
  if (body.length > MAX_CHUNK_BYTES) throw new Error('The chunk is larger than 25 MB');
  const response = await fetch('/api/settlement-report/deals-history', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
  return data as { sessionId?: string };
}

export function SettlementDataSources({ initial = null }: { initial?: History | null } = {}) {
  const uploadRef = useRef<SettlementUploadHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<History | null>(initial);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const today = todayWib();

  const load = useCallback((nextPage: number) => {
    fetch(`/api/settlement-report/uploads?page=${nextPage}&pageSize=25`).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error || 'Could not load upload history'); return; }
      setError('');
      setHistory(data);
    });
  }, []);
  useEffect(() => { if (!initial) load(page); }, [load, page, initial]);

  async function uploadDeals(file: File) {
    setBusy(true);
    setStatus(`Reading ${file.name}…`);
    const reader = file.stream().getReader();
    let seq = 1;
    let sessionId = '';
    try {
      await ingestDealsBytes((async function* () {
        for (;;) {
          const step = await reader.read();
          if (step.done) return;
          yield step.value;
        }
      })(), {
        open: async title => {
          const opened = await postDeals({ action: 'open', fileName: file.name, title, footerCommission: 0, footerSwap: 0 });
          sessionId = opened.sessionId ?? '';
        },
        chunk: async (deals: ParsedDeal[]) => {
          if (deals.length > MAX_CHUNK_DEALS) throw new Error(`A chunk can contain at most ${MAX_CHUNK_DEALS} deals`);
          const hash = `${seq}:${deals[0]?.deal}:${deals.at(-1)?.deal}:${deals.length}:${deals.reduce((sum, deal) => sum + deal.commission, 0)}`;
          await postDeals({ action: 'chunk', sessionId, seq, hash, deals });
          seq += 1;
          setStatus(`${file.name}: chunk ${seq - 1}`);
        },
        commit: async (footer, confirmation) => {
          await postDeals({ action: 'commit', sessionId, footerCommission: footer.commission, footerSwap: footer.swap, dealCount: confirmation.deals, eofConfirmed: true });
        },
      });
      setStatus(`Imported ${file.name}. Re-uploading the same deals does not double-count.`);
      load(page);
    } catch (reason) {
      if (sessionId) await postDeals({ action: 'abort', sessionId }).catch(() => undefined);
      setStatus(reason instanceof Error ? reason.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function take(files: FileList | null) {
    const picked = Array.from(files ?? []).slice(0, 10);
    const standard: File[] = [];
    for (const file of picked) {
      const bytes = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
      if (routeSettlementFile(bytes, file.name) === 'deals_history') await uploadDeals(file);
      else standard.push(file);
    }
    if (standard.length) uploadRef.current?.choose(standard);
  }

  const coverage = history?.coverage ?? {};
  const chip = (through: string | null) => {
    const freshness = sourceFreshness(through, today);
    if (freshness.status === 'none') return <StatusBadge tone="neutral">No uploads yet</StatusBadge>;
    if (freshness.status === 'current') return <StatusBadge tone="success" dot>Current</StatusBadge>;
    return <StatusBadge tone="warning" dot>{freshness.days} days behind</StatusBadge>;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {CARDS.map(([kind, label]) => (
          <article key={kind} className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-4">
            <h2 className="text-sm font-[560]">{label}</h2>
            <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Through {coverage[kind] ?? '—'}</p>
            <div className="mt-3">{chip(coverage[kind] ?? null)}</div>
          </article>
        ))}
        <article className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-4">
          <h2 className="text-sm font-[560]">MT5 Deals History</h2>
          <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Through {history?.dealsHistoryThrough ?? '—'}</p>
          <div className="mt-3">{chip(history?.dealsHistoryThrough ?? null)}</div>
        </article>
      </div>

      <section className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5">
        <h2 className="text-sm font-[560]">Upload files</h2>
        <p className="mt-1 text-xs text-[var(--mos-text-muted)]">CRM deposit / withdrawal (.xlsx), MT5 Deposit & Withdrawal (.csv), Dealing FTD (.xlsx), MT5 Deals History (UTF-16 .csv). The type is detected from the content.</p>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void take(event.dataTransfer.files); }} className="mt-4 w-full cursor-pointer rounded-[var(--mos-radius-panel)] border border-dashed border-[var(--mos-border-strong)] bg-[var(--mos-surface)] px-6 py-8 text-sm text-[var(--mos-text-muted)] transition duration-150 hover:border-[#2EB5C4]/70 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)] active:bg-white/[0.05] disabled:cursor-not-allowed">
          Drop files here or <span className="text-[#2EB5C4]">browse</span>
          <span className="mt-1 block text-xs">Up to 10 files. Deals History uploads in parts automatically. Re-uploading the same export is safe.</span>
        </button>
        <input ref={inputRef} aria-label="Choose settlement files" className="sr-only" type="file" multiple onChange={event => { void take(event.target.files); event.target.value = ''; }} />
        {status && <p className="mt-3 text-xs text-[var(--mos-text-muted)]">{status}</p>}
      </section>

      <SettlementUploadPanel ref={uploadRef} hideInput onImported={() => load(page)} />

      {error && <p className="text-xs text-red-300">{error}</p>}
      <DataTableFrame title="Upload history" description="Newest first.">
        {!history ? <p className="px-5 py-6 text-xs text-[var(--mos-text-muted)]">Loading…</p> : history.uploads.length === 0 ? (
          <EmptyState title="No settlement uploads yet" description="Drop a CRM, MT5, FTD, or Deals History export above." />
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--mos-text-faint)]"><tr>{['File', 'Type', 'Inserted', 'Updated', 'Skipped', 'Data (WIB)', 'Uploader', 'When'].map(heading => <th key={heading} className={`px-4 py-2.5 font-medium ${['Inserted', 'Updated', 'Skipped'].includes(heading) ? 'text-right' : 'text-left'}`}>{heading}</th>)}</tr></thead>
            <tbody>
              {history.uploads.map(upload => (
                <tr key={upload.id} className="border-t border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]">
                  <td className="max-w-xs truncate px-4 py-2.5">{upload.file_name}</td>
                  <td className="px-4 py-2.5">{history.labels[upload.kind] ?? upload.kind}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatInteger(upload.rows_inserted)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatInteger(upload.rows_updated)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatInteger(upload.rows_skipped)}</td>
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
            <span>Page {history.page} of {history.pageCount}</span>
            <button type="button" className="underline disabled:opacity-40" disabled={page >= history.pageCount} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </DataTableFrame>
    </div>
  );
}
