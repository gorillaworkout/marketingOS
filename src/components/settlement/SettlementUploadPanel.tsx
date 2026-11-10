'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';
import { Button, DataTableFrame, Panel, SectionHeader, StatusBadge } from '@/components/ui/dashboard';
import { formatInteger } from '@/components/monthly-report/brand';

const ENDPOINT = '/api/settlement-report/uploads';
const MAX_BYTES = 25 * 1024 * 1024;

type Preview = {
  ok: boolean; error?: string; expected?: string[]; detectedKind?: string | null; detectedLabel?: string; fileName?: string;
  errors?: string[]; warnings?: string[]; issueCount?: number; issues?: Array<{ row: number; message: string }>;
  summary?: { rows: number; invalid: number; duplicatesInFile: number; unknownRate: number; byStatus: Record<string, number>; wibRange: { from: string; to: string } | null };
  conflicts?: { new: number; existing: number };
  counts?: { total: number; inserted: number; updated: number; unchanged: number; skipped: number };
};
type Item = { file: File; state: 'previewing' | 'ready' | 'importing' | 'done' | 'failed'; preview?: Preview };

async function post(file: File, query: string): Promise<Preview> {
  const response = await fetch(`${ENDPOINT}?${query}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
  try { return (await response.json()) as Preview; } catch { return { ok: false, error: `Upload failed (${response.status})` }; }
}

export interface SettlementUploadHandle { choose: (files: FileList | File[] | null) => void }

/** Settlement uploads: CRM deposit / withdrawal xlsx, MT5 Deposit & Withdrawal CSV, Dealing FTD list. Detected by content. */
export const SettlementUploadPanel = forwardRef<SettlementUploadHandle, { onImported?: () => void; hideInput?: boolean }>(function SettlementUploadPanel({ onImported, hideInput = false }, ref) {
  const [items, setItems] = useState<Item[]>([]);
  const update = (index: number, patch: Partial<Item>) => setItems(list => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  async function choose(files: FileList | File[] | null) {
    const picked = Array.from(files ?? []).slice(0, 10);
    const start = items.length;
    setItems(list => [...list, ...picked.map(file => ({ file, state: 'previewing' as const }))]);
    await Promise.all(picked.map(async (file, offset) => {
      if (file.size > MAX_BYTES) return update(start + offset, { state: 'failed', preview: { ok: false, error: 'The file is larger than 25 MB' } });
      const preview = await post(file, `mode=preview&fileName=${encodeURIComponent(file.name)}`);
      update(start + offset, { state: preview.ok ? 'ready' : 'failed', preview });
    }));
  }

  async function importItem(index: number) {
    const item = items[index];
    if (!item.preview?.detectedKind) return;
    update(index, { state: 'importing' });
    const result = await post(item.file, `mode=commit&fileName=${encodeURIComponent(item.file.name)}&expect=${item.preview.detectedKind}`);
    update(index, { state: result.ok ? 'done' : 'failed', preview: { ...item.preview, ...result } });
    if (result.ok) onImported?.();
  }

  useImperativeHandle(ref, () => ({ choose }));

  if (hideInput && items.length === 0) return null;
  return (
    <Panel>
      {!hideInput && (
        <SectionHeader
          title="Upload settlement data"
          description="CRM deposit and withdrawal reports (.xlsx), MT5 Deposit and Withdrawal Report (.csv), and the Dealing FTD list (.xlsx). Re-uploading an overlapping export is safe: rows are matched by Reference / Deal / Login."
          action={<input aria-label="Choose settlement files" type="file" multiple accept=".xlsx,.xls,.csv" onChange={event => { void choose(event.target.files); event.target.value = ''; }} />}
        />
      )}
      {items.length > 0 && (
        <DataTableFrame title="Files">
          <table className="w-full text-sm">
            <thead><tr><th className="px-4 py-2 text-left">File</th><th className="px-4 py-2 text-left">Type</th><th className="px-4 py-2 text-right">Rows</th><th className="px-4 py-2 text-right">New / existing</th><th className="px-4 py-2 text-left">Data (WIB)</th><th className="px-4 py-2 text-left">Status</th><th /></tr></thead>
            <tbody>
              {items.map((item, index) => {
                const p = item.preview;
                return (
                  <tr key={`${item.file.name}-${index}`} className="border-t border-[var(--mos-border)] align-top">
                    <td className="max-w-xs truncate px-4 py-2" title={item.file.name}>{item.file.name}</td>
                    <td className="px-4 py-2">{p?.detectedLabel ?? '—'}</td>
                    <td className="px-4 py-2 text-right">{formatInteger(p?.summary?.rows)}</td>
                    <td className="px-4 py-2 text-right">{p?.counts ? `${formatInteger(p.counts.inserted)} new · ${formatInteger(p.counts.updated)} updated` : p?.conflicts ? `${formatInteger(p.conflicts.new)} / ${formatInteger(p.conflicts.existing)}` : '—'}</td>
                    <td className="px-4 py-2">{p?.summary?.wibRange ? `${p.summary.wibRange.from} – ${p.summary.wibRange.to}` : '—'}</td>
                    <td className="px-4 py-2">
                      <StatusBadge tone={item.state === 'done' ? 'success' : item.state === 'failed' ? 'danger' : 'info'}>{item.state}</StatusBadge>
                      {[p?.error, ...(p?.errors ?? []), ...(p?.warnings ?? [])].filter(Boolean).map(message => <p key={message} className="mt-1 text-xs text-[var(--mos-text-muted)]">{message}</p>)}
                      {p?.issueCount ? <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{formatInteger(p.issueCount)} rows skipped (first: row {p.issues?.[0]?.row}: {p.issues?.[0]?.message})</p> : null}
                      {p?.expected && <ul className="mt-1 list-disc pl-4 text-xs text-[var(--mos-text-muted)]">{p.expected.map(text => <li key={text}>{text}</li>)}</ul>}
                    </td>
                    <td className="px-4 py-2">{item.state === 'ready' && <Button size="sm" variant="primary" onClick={() => void importItem(index)}>Import</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTableFrame>
      )}
    </Panel>
  );
});
