'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, DataTableFrame, Panel, SectionHeader, Select, StatusBadge } from '@/components/ui/dashboard';
import type { UploadPreview } from '@/lib/cs-report/service';
import type { CommitResult, UploadHistoryRow } from '@/lib/cs-report/store';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB';

function defaultChoice(target: UploadPreview['names'][number]['target']): string {
  if (target.kind === 'agent') return `agent:${target.agentId}`;
  if (target.kind === 'user') return `user:${target.userId}`;
  return 'name';
}

export function CsBulkUploadTab() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'preview' | 'commit'>('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<CommitResult | null>(null);
  const [history, setHistory] = useState<UploadHistoryRow[]>([]);

  const loadHistory = useCallback(async () => {
    const response = await fetch('/api/cs-report/uploads', { cache: 'no-store' });
    if (response.ok) setHistory(((await response.json()) as { uploads: UploadHistoryRow[] }).uploads);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/cs-report/uploads', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then((b: { uploads: UploadHistoryRow[] } | null) => { if (!cancelled && b) setHistory(b.uploads); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const send = async (mode: 'preview' | 'commit') => {
    if (!file) return;
    setBusy(mode); setError('');
    const params = new URLSearchParams({ mode, fileName: file.name });
    if (mode === 'commit') params.set('mapping', JSON.stringify(mapping));
    const response = await fetch(`/api/cs-report/upload?${params}`, { method: 'POST', body: file });
    const body = await response.json().catch(() => ({})) as { error?: string; preview?: UploadPreview; result?: CommitResult };
    setBusy('');
    if (!response.ok) { setError(body.error || `Upload failed (${response.status}).`); return; }
    if (mode === 'preview' && body.preview) {
      setPreview(body.preview); setResult(null);
      setMapping(Object.fromEntries(body.preview.names.map(n => [n.excelName, defaultChoice(n.target)])));
    }
    if (mode === 'commit' && body.result) { setResult(body.result); setPreview(null); setFile(null); await loadHistory(); }
  };

  return <div className="flex flex-col gap-6">
    <Panel>
      <SectionHeader title="Upload the CS workbook" description="The current Excel format: one sheet per month with weekly Weekly Work List blocks, Notes, and Report Complaint. Total rows and summary rows are ignored and recomputed. Rows already stored (same agent and date, same complaint, same week and channel) are skipped, so uploading the same file twice adds nothing." />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="CS workbook"
          onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); setError(''); }}
          className="text-sm text-[var(--mos-text-secondary)] file:mr-3 file:rounded-[var(--mos-radius-control)] file:border file:border-[var(--mos-border)] file:bg-[var(--mos-raised)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--mos-text-secondary)]" />
        <Button variant="primary" onClick={() => send('preview')} disabled={!file || busy !== ''}>{busy === 'preview' ? 'Reading…' : 'Preview'}</Button>
      </div>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {result && <p className="mt-3 text-sm text-emerald-300">
        Imported: {result.entries.inserted} agent-days ({result.entries.skipped} already stored), {result.complaints.inserted} complaints ({result.complaints.skipped} already stored), {result.notes.inserted} weekly notes ({result.notes.skipped} already stored).
      </p>}
    </Panel>

    {preview && <>
      <DataTableFrame title={`Preview: ${preview.fileName}`} description={`${preview.dateFrom ?? '—'} to ${preview.dateTo ?? '—'}. New = not stored yet; for names that are not linked to an agent yet every row counts as new.`}>
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-[var(--mos-border)] text-left text-xs text-[var(--mos-text-faint)]">
            <tr><th className="p-3">Sheet</th><th className="p-3 text-right">Weeks</th><th className="p-3 text-right">Agent-days</th><th className="p-3 text-right">Present</th><th className="p-3 text-right">Sick</th><th className="p-3 text-right">Annual leave</th><th className="p-3 text-right">Complaints</th><th className="p-3 text-right">Notes</th><th className="p-3">Dates</th></tr>
          </thead>
          <tbody>
            {preview.sheets.map(s => <tr key={s.sheet} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
              <td className="p-3 text-[var(--mos-text)]">{s.sheet}</td><td className="p-3 text-right tabular-nums">{s.weeks}</td><td className="p-3 text-right tabular-nums">{s.agentDays}</td>
              <td className="p-3 text-right tabular-nums">{s.presentDays}</td><td className="p-3 text-right tabular-nums">{s.sickDays}</td><td className="p-3 text-right tabular-nums">{s.annualLeaveDays}</td>
              <td className="p-3 text-right tabular-nums">{s.complaints}</td><td className="p-3 text-right tabular-nums">{s.notes}</td>
              <td className="whitespace-nowrap p-3 text-xs">{s.dateFrom ?? '—'} to {s.dateTo ?? '—'}</td>
            </tr>)}
            <tr className="bg-white/[0.03] font-medium text-[var(--mos-text)]">
              <td className="p-3">Total</td><td className="p-3" /><td className="p-3 text-right tabular-nums">{preview.totals.entries}<span className="ml-1 text-xs font-normal text-[var(--mos-text-faint)]">({preview.totals.entriesNew} new)</span></td>
              <td className="p-3" /><td className="p-3 text-right tabular-nums">{preview.totals.sickDays}</td><td className="p-3 text-right tabular-nums">{preview.totals.annualLeaveDays}</td>
              <td className="p-3 text-right tabular-nums">{preview.totals.complaints}<span className="ml-1 text-xs font-normal text-[var(--mos-text-faint)]">({preview.totals.complaintsNew} new)</span></td>
              <td className="p-3 text-right tabular-nums">{preview.totals.notes}<span className="ml-1 text-xs font-normal text-[var(--mos-text-faint)]">({preview.totals.notesNew} new)</span></td><td className="p-3" />
            </tr>
          </tbody>
        </table>
      </DataTableFrame>

      {preview.warnings.length > 0 && <Panel padding="compact">
        <SectionHeader title={`Warnings (${preview.warnings.length})`} description="The import still runs; check these rows in the workbook." />
        <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-amber-200">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </Panel>}

      <Panel>
        <SectionHeader title="Match Excel names to agents" description="Pick the CS account for each name. “Keep as name only” stores the rows under that name; map the same name to an account in a later upload to link them." />
        <div className="mt-4 space-y-3">
          {preview.names.map(n => <div key={n.excelName} className="grid grid-cols-1 items-center gap-3 md:grid-cols-[260px_320px_auto]">
            <span className="text-sm text-[var(--mos-text)]">{n.excelName}</span>
            <Select aria-label={`Agent for ${n.excelName}`} value={mapping[n.excelName] ?? 'name'} onChange={e => setMapping(m => ({ ...m, [n.excelName]: e.target.value }))}>
              <option value="name">Keep as name only</option>
              {preview.agents.map(a => <option key={a.id} value={`agent:${a.id}`}>Agent: {a.displayName}{a.linked ? '' : ' (name only)'}</option>)}
              {preview.users.map(u => <option key={u.id} value={`user:${u.id}`}>User: {u.name} ({u.username})</option>)}
            </Select>
            <span>{n.reason === 'none' ? <StatusBadge tone="warning">No match</StatusBadge> : <StatusBadge tone="success">{n.reason === 'alias' ? 'Known agent' : n.reason === 'exact' ? 'Name match' : 'First-name match'}</StatusBadge>}</span>
          </div>)}
          {!preview.names.length && <p className="text-xs text-[var(--mos-text-faint)]">No agent names found.</p>}
          {!preview.users.length && <p className="text-xs text-[var(--mos-text-faint)]">No users have CS Report through their department yet. Assign the CS agents to the Customer Service department in Accounts first, or keep the names and link them later.</p>}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button variant="primary" onClick={() => send('commit')} disabled={busy !== ''}>{busy === 'commit' ? 'Importing…' : 'Import'}</Button>
          <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
        </div>
      </Panel>
    </>}

    <DataTableFrame title="Upload history" description="Newest first.">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs text-[var(--mos-text-faint)]">
          <tr><th className="p-3">When</th><th className="p-3">File</th><th className="p-3">By</th><th className="p-3">Data</th><th className="p-3 text-right">Agent-days</th><th className="p-3 text-right">Complaints</th><th className="p-3 text-right">Notes</th><th className="p-3 text-right">Warnings</th></tr>
        </thead>
        <tbody>
          {history.map(h => <tr key={h.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
            <td className="whitespace-nowrap p-3">{when(h.createdAt)}</td><td className="max-w-[260px] truncate p-3" title={h.fileName}>{h.fileName}</td><td className="p-3">{h.uploadedByName ?? '—'}</td>
            <td className="whitespace-nowrap p-3 text-xs">{h.dataFrom ?? '—'} to {h.dataTo ?? '—'}</td>
            <td className="p-3 text-right tabular-nums">{h.entriesInserted} <span className="text-xs text-[var(--mos-text-faint)]">+{h.entriesSkipped} skipped</span></td>
            <td className="p-3 text-right tabular-nums">{h.complaintsInserted} <span className="text-xs text-[var(--mos-text-faint)]">+{h.complaintsSkipped} skipped</span></td>
            <td className="p-3 text-right tabular-nums">{h.notesInserted} <span className="text-xs text-[var(--mos-text-faint)]">+{h.notesSkipped} skipped</span></td>
            <td className="p-3 text-right tabular-nums" title={(h.warnings ?? []).join('\n')}>{(h.warnings ?? []).length}</td>
          </tr>)}
          {!history.length && <tr><td colSpan={8} className="p-6 text-center text-xs text-[var(--mos-text-faint)]">No uploads yet.</td></tr>}
        </tbody>
      </table>
    </DataTableFrame>
  </div>;
}
