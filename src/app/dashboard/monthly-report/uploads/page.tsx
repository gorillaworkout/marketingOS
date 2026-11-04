'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, DataTableFrame, EmptyState, FormField, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextInput } from '@/components/ui/dashboard';
import { formatAmount, formatDateTimeWib, formatInteger } from '@/components/monthly-report/brand';
import { ReportTabs } from '@/components/monthly-report/ReportTabs';

type Kind = 'onboarding' | 'ftd';
type Upload = { id: string; kind: string; file_name: string; source_utc_offset: string | null; uploaded_by_name: string | null; rows_total: number; rows_inserted: number; rows_updated: number; rows_skipped: number; rows_duplicate?: number; data_from: string | null; data_to: string | null; created_at: string };
type Preview = {
  ok: boolean; error?: string; fileName: string; offset: string; offsetFrom: string; fileNameOffset?: string | null; errors: string[]; warnings?: string[];
  issues: Array<{ row: number; message: string }>; issueCount: number; layout?: string; reportMonth?: { year: number; month: number } | null;
  summary: { rows: number; invalid: number; duplicatesInFile: number; conflictingDuplicatesInFile?: number; wibRange: { from: string; to: string } | null; byStepStatus?: Record<string, number>; byStep?: Record<string, number>; amountTotal?: number; byType?: Record<string, number> };
  conflicts?: { new: number; duplicate?: number; duplicateDiffers?: number; newEventForKnownDocument?: number; existing?: number; byStepStatus?: Array<{ stepStatus: string; new: number; duplicate: number }>; statusChanges?: Array<{ from: string; to: string; count: number }> };
  counts?: { total: number; inserted: number; updated?: number; unchanged?: number; skipped?: number; skippedDuplicate?: number; duplicatesInFile?: number; invalid?: number };
};

const CARDS: Record<Kind, { title: string; description: string; accept: string; endpoint: string }> = {
  onboarding: {
    title: 'Onboarding export',
    description: 'CRM export (.xlsx, sheet "Query result") with Date Time, UID, Document ID, is First Account, Trading Account No., Approval Method, Steps, Step Status, Account Status, Remarks. Each row is one event, matched by Document ID + Date Time + Steps: events already stored (or repeated in the file) are skipped, so uploading the same file again adds nothing. A Document ID can have events in several months.',
    accept: '.xlsx,.xls,.csv',
    endpoint: '/api/monthly-report/uploads/onboarding',
  },
  ftd: {
    title: 'FTD report',
    description: 'The monthly FTD report CSV (only the MONTHLY block is read) or a clean table with Account, Type, Join Date, FTD Time, Amount. Rows are matched by Account.',
    accept: '.csv,.xlsx,.xls',
    endpoint: '/api/monthly-report/uploads/ftd',
  },
};

export default function MonthlyReportUploadsPage() {
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  const loadHistory = useCallback(async () => {
    const response = await fetch('/api/monthly-report/uploads');
    const data = await response.json().catch(() => ({}));
    setUploads(response.ok ? data.uploads : []);
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  return (
    <PageStack>
      <PageHeader eyebrow="Reports" title="Onboarding Reports" description="Upload the source files. Every upload is previewed first, validated, and kept in the history below." />
      <ReportTabs />
      <div className="grid gap-6 xl:grid-cols-2">
        <UploadCard kind="onboarding" onDone={loadHistory} />
        <UploadCard kind="ftd" onDone={loadHistory} />
      </div>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader title="Rejection reasons" description="Per Document ID or UID: date and reason." />
          <StatusBadge>Coming soon</StatusBadge>
        </div>
        <p className="mt-3 text-xs text-[var(--mos-text-muted)]">Upload is not available yet. The format will be agreed with the CRM team.</p>
      </Panel>
      <DataTableFrame title="Upload history" description="Newest first. Times in WIB.">
        {!uploads ? <p className="px-5 py-6 text-xs text-[var(--mos-text-muted)]">Loading…</p> : uploads.length === 0 ? (
          <EmptyState title="No uploads yet" description="Uploads will be listed here with who uploaded them and what changed." />
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--mos-text-faint)]"><tr>{['When', 'Type', 'File', 'Source offset', 'Data (WIB)', 'Rows', 'New', 'Updated', 'Duplicate', 'Invalid', 'By'].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {uploads.map(u => (
                <tr key={u.id} className="border-t border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]">
                  <td className="whitespace-nowrap px-4 py-2">{formatDateTimeWib(u.created_at)}</td>
                  <td className="px-4 py-2">{u.kind === 'ftd' ? 'FTD' : u.kind === 'onboarding' ? 'Onboarding' : u.kind}</td>
                  <td className="px-4 py-2">{u.file_name}</td>
                  <td className="px-4 py-2">{u.source_utc_offset ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2">{u.data_from ? `${u.data_from} → ${u.data_to}` : '—'}</td>
                  <td className="px-4 py-2">{formatInteger(u.rows_total)}</td>
                  <td className="px-4 py-2">{formatInteger(u.rows_inserted)}</td>
                  <td className="px-4 py-2">{formatInteger(u.rows_updated)}</td>
                  <td className="px-4 py-2">{formatInteger(u.rows_duplicate ?? 0)}</td>
                  <td className="px-4 py-2">{formatInteger(u.rows_skipped)}</td>
                  <td className="px-4 py-2">{u.uploaded_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableFrame>
    </PageStack>
  );
}

function UploadCard({ kind, onDone }: { kind: Kind; onDone: () => void }) {
  const card = CARDS[kind];
  const [file, setFile] = useState<File | null>(null);
  const [offsetChoice, setOffsetChoice] = useState('auto');
  const [customOffset, setCustomOffset] = useState('');
  const [busy, setBusy] = useState<'' | 'preview' | 'commit'>('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState('');

  const send = async (mode: 'preview' | 'commit') => {
    if (!file) return;
    setBusy(mode);
    setError('');
    const params = new URLSearchParams({ mode, fileName: file.name });
    const offset = offsetChoice === 'custom' ? customOffset : offsetChoice === 'auto' ? '' : offsetChoice;
    if (offset) params.set('offset', offset);
    try {
      const response = await fetch(`${card.endpoint}?${params}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
      const data = await response.json().catch(() => ({ error: 'Unexpected response' }));
      if (data.error) setError(data.error);
      else if (mode === 'preview') { setPreview(data); setResult(null); }
      else if (!response.ok || !data.ok) setError((data.errors || []).join(' ') || 'Upload failed');
      else { setResult(data); setPreview(null); onDone(); }
    } catch {
      setError('Upload failed. Check the connection and try again.');
    } finally {
      setBusy('');
    }
  };

  return (
    <Panel>
      <SectionHeader title={card.title} description={card.description} />
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <FormField label="File">
          <input
            type="file"
            accept={card.accept}
            onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); setError(''); }}
            className="block w-full text-xs text-[var(--mos-text-muted)] file:mr-3 file:h-8 file:rounded-[var(--mos-radius-control)] file:border file:border-[var(--mos-border)] file:bg-[var(--mos-raised)] file:px-3 file:text-xs file:text-[var(--mos-text-secondary)]"
          />
        </FormField>
        <FormField label="Time zone of the export" hint="WIB = +07:00">
          <Select value={offsetChoice} onChange={e => setOffsetChoice(e.target.value)} className="w-56">
            <option value="auto">Default: UTC+7 (WIB)</option>
            <option value="+08:00">UTC+8</option>
            <option value="custom">Other…</option>
          </Select>
        </FormField>
      </div>
      {offsetChoice === 'custom' && <TextInput className="mt-2 w-40" placeholder="+05:30" value={customOffset} onChange={e => setCustomOffset(e.target.value)} />}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" disabled={!file || busy !== ''} onClick={() => send('preview')}>{busy === 'preview' ? 'Checking…' : 'Preview'}</Button>
        {preview?.ok && <Button variant="primary" disabled={busy !== ''} onClick={() => send('commit')}>{busy === 'commit' ? 'Saving…' : `Save ${formatInteger(preview.summary.rows)} rows`}</Button>}
      </div>
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
      {preview && <PreviewDetails kind={kind} preview={preview} />}
      {result?.counts && (
        <p className="mt-4 rounded-[var(--mos-radius-control)] border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
          {kind === 'onboarding'
            ? <>Saved: {formatInteger(result.counts.inserted)} new, {formatInteger(result.counts.skippedDuplicate)} skipped as duplicate{result.counts.duplicatesInFile ? ` (${formatInteger(result.counts.duplicatesInFile)} repeated within the file)` : ''}, {formatInteger(result.counts.invalid)} invalid (offset {result.offset}).</>
            : <>Saved: {formatInteger(result.counts.inserted)} new, {formatInteger(result.counts.updated)} updated, {formatInteger(result.counts.unchanged)} unchanged, {formatInteger(result.counts.skipped)} skipped (offset {result.offset}).</>}
        </p>
      )}
    </Panel>
  );
}

function PreviewDetails({ kind, preview }: { kind: Kind; preview: Preview }) {
  const { summary, conflicts } = preview;
  return (
    <div className="mt-4 space-y-3 text-xs">
      {preview.errors.length > 0 && (
        <div className="rounded-[var(--mos-radius-control)] border border-red-400/20 bg-red-400/10 px-3 py-2 text-red-200">
          {preview.errors.map(e => <p key={e}>{e}</p>)}
        </div>
      )}
      {(preview.warnings ?? []).map(w => <p key={w} className="rounded-[var(--mos-radius-control)] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-amber-200">{w}</p>)}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[var(--mos-text-muted)] sm:grid-cols-3">
        <div><dt>Valid rows</dt><dd className="font-semibold text-[var(--mos-text)]">{formatInteger(summary.rows)}</dd></div>
        <div><dt>Invalid rows</dt><dd className="font-semibold text-[var(--mos-text)]">{formatInteger(summary.invalid)}</dd></div>
        <div><dt>Duplicates in file</dt><dd className="font-semibold text-[var(--mos-text)]">{formatInteger(summary.duplicatesInFile)}</dd></div>
        {kind === 'onboarding' && conflicts && <div><dt>Already stored (skipped)</dt><dd className="font-semibold text-[var(--mos-text)]">{formatInteger(conflicts.duplicate)}</dd></div>}
        <div><dt>Dates (WIB)</dt><dd className="font-semibold text-[var(--mos-text)]">{summary.wibRange ? `${summary.wibRange.from} → ${summary.wibRange.to}` : '—'}</dd></div>
        <div><dt>Time zone</dt><dd className="font-semibold text-[var(--mos-text)]">{preview.offset} <span className="font-normal">({preview.offsetFrom}{preview.fileNameOffset && preview.fileNameOffset !== preview.offset ? `; file name says ${preview.fileNameOffset}, ignored` : ''})</span></dd></div>
        {kind === 'ftd' && <div><dt>Amount total</dt><dd className="font-semibold text-[var(--mos-text)]">{formatAmount(summary.amountTotal)}</dd></div>}
      </dl>
      {kind === 'onboarding' && conflicts?.byStepStatus && (
        <table className="w-full text-left">
          <thead className="text-[var(--mos-text-faint)]"><tr><th className="py-1.5 font-medium">Step Status</th><th className="py-1.5 text-right font-medium">New</th><th className="py-1.5 text-right font-medium">Duplicate (skipped)</th></tr></thead>
          <tbody>
            {conflicts.byStepStatus.map(g => (
              <tr key={g.stepStatus} className="border-t border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]">
                <td className="py-1.5">{g.stepStatus}</td><td className="py-1.5 text-right">{formatInteger(g.new)}</td><td className="py-1.5 text-right">{formatInteger(g.duplicate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {kind === 'onboarding' && (conflicts?.newEventForKnownDocument ?? 0) > 0 && (
        <p className="text-[var(--mos-text-muted)]">{formatInteger(conflicts!.newEventForKnownDocument)} new events belong to Document IDs that already have other events stored (e.g. from another month); they are added as separate events.</p>
      )}
      {kind === 'onboarding' && (conflicts?.duplicateDiffers ?? 0) > 0 && (
        <p className="text-amber-200">{formatInteger(conflicts!.duplicateDiffers)} already-stored events differ in other columns; the stored values are kept.{(conflicts?.statusChanges?.length ?? 0) > 0 ? ` Step Status stored → file: ${conflicts!.statusChanges!.map(c => `${c.from} → ${c.to}: ${formatInteger(c.count)}`).join(' · ')}` : ''}</p>
      )}
      {kind === 'ftd' && conflicts && (
        <p className="text-[var(--mos-text-muted)]">{formatInteger(conflicts.new)} new accounts · {formatInteger(conflicts.existing)} already stored (they will be updated if anything changed). Micro {formatInteger(summary.byType?.micro)} · Standard {formatInteger(summary.byType?.standard)}</p>
      )}
      {preview.issueCount > 0 && (
        <details className="text-[var(--mos-text-muted)]">
          <summary className="cursor-pointer">{formatInteger(preview.issueCount)} rows will be skipped</summary>
          <ul className="mt-2 space-y-1">{preview.issues.map(i => <li key={`${i.row}-${i.message}`}>Row {i.row}: {i.message}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
