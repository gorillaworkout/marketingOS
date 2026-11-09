'use client';

import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { MAX_MULTI_UPLOAD_FILES, MAX_UPLOAD_BYTES, selectUploadFiles, validItemsForImport } from '@/lib/monthly-report/multi-file-upload';
import { Button, DataTableFrame, EmptyState, FilterGroup, FormField, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextInput, Toolbar } from '@/components/ui/dashboard';
import { formatAmount, formatDateTimeWib, formatInteger } from '@/components/monthly-report/brand';
import { DailyFtdPanel } from '@/components/monthly-report/DailyFtdPanel';
import { DataThrough, MissingDataNotice } from '@/components/monthly-report/DataCoverage';
import { ReportTabs } from '@/components/monthly-report/ReportTabs';
import { formatCoverageDate, type CoverageOverview } from '@/lib/monthly-report/coverage';

type DetectedKind = 'onboarding' | 'onboarding_summary' | 'user_approved' | 'ftd';
type Kind = 'onboarding' | 'ftd';
type Upload = { id: string; kind: string; file_name: string; source_utc_offset: string | null; uploaded_by_name: string | null; rows_total: number; rows_inserted: number; rows_updated: number; rows_skipped: number; rows_duplicate?: number; data_from: string | null; data_to: string | null; created_at: string };
type Preview = {
  ok: boolean; error?: string; hints?: string[]; detectedKind?: DetectedKind | null; detectedLabel?: string;
  fileName: string; offset: string; offsetFrom: string; fileNameOffset?: string | null; errors: string[]; warnings?: string[];
  issues: Array<{ row: number; message: string }>; issueCount: number; layout?: string; reportMonth?: { year: number; month: number } | null;
  summary: { rows: number; invalid: number; duplicatesInFile: number; conflictingDuplicatesInFile?: number; skippedRobot?: number; skippedBlankApprover?: number; wibRange: { from: string; to: string } | null; byStepStatus?: Record<string, number>; byStep?: Record<string, number>; amountTotal?: number; byType?: Record<string, number> };
  conflicts?: { new: number; duplicate?: number; duplicateDiffers?: number; newEventForKnownDocument?: number; existing?: number; byStepStatus?: Array<{ stepStatus: string; new: number; duplicate: number }>; statusChanges?: Array<{ from: string; to: string; count: number }> };
  counts?: { total: number; inserted: number; updated?: number; unchanged?: number; skipped?: number; skippedDuplicate?: number; duplicatesInFile?: number; invalid?: number };
};
type History = { uploads: Upload[]; total: number; page: number; pageSize: number; pageCount: number; months: string[]; coverage: CoverageOverview; permissions?: { canUpload: boolean; isAdmin: boolean } };

const PAGE_SIZE = 25;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const KIND_LABELS: Record<string, string> = {
  onboarding: 'Onboarding (classic)', onboarding_summary: 'Onboarding daily summary', user_approved: 'User approved', ftd: 'FTD', rejection_reasons: 'Rejection reasons (legacy)',
  settlement_crm_deposit: 'Settlement · CRM deposits', settlement_crm_withdrawal: 'Settlement · CRM withdrawals', settlement_mt5_dw: 'Settlement · MT5 Deposit & Withdrawal', settlement_ftd: 'Settlement · Dealing FTD list',
};

type CardConfig = { title: string; description: string; accept: string; endpoint: string };

const AUTO_CARD: CardConfig = {
  title: 'Upload file',
  description: 'Drop or pick up to 10 files at once (25 MB each): daily onboarding summary (obd_kyc), user_approved Metabase export, or classic onboarding event export. Each file is detected independently. FTD is entered per day in Daily FTD below.',
  accept: '.xlsx,.xls,.csv',
  endpoint: '/api/monthly-report/uploads/auto',
};

const CARDS: Record<Kind, CardConfig> = {
  onboarding: {
    title: 'Onboarding export',
    description: 'CRM export (.xlsx, sheet "Query result") with Date Time, UID, Document ID, is First Account, Trading Account No., Approval Method, Steps, Step Status, Account Status, Remarks. Each row is one event, matched by Document ID + Date Time + Steps: events already stored (or repeated in the file) are skipped, so uploading the same file again adds nothing. A Document ID can have events in several months.',
    accept: '.xlsx,.xls,.csv',
    endpoint: '/api/monthly-report/uploads/onboarding',
  },
  ftd: {
    title: 'FTD file (legacy, admin only)',
    description: 'Optional: the monthly FTD report CSV (only the MONTHLY block is read) or a clean table with Account, Type, Join Date, FTD Time, Amount. Rows are matched by Account. Daily FTD is normally entered by hand; an account-level file is only needed for "Activated → FTD (same accounts)". Manual daily values win over the file for their day.',
    accept: '.csv,.xlsx,.xls',
    endpoint: '/api/monthly-report/uploads/ftd',
  },
};

export default function MonthlyReportUploadsPage() {
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [filter, setFilter] = useState<{ kind: string; month: string; page: number }>({ kind: '', month: '', page: 1 });

  const [reloadKey, setReloadKey] = useState(0);
  const loadHistory = useCallback(() => setReloadKey(key => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(filter.page), pageSize: String(PAGE_SIZE) });
    if (filter.kind) params.set('kind', filter.kind);
    if (filter.month) params.set('month', filter.month);
    fetch(`/api/monthly-report/uploads?${params}`).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (cancelled) return;
      if (response.ok) { setHistory(data); setHistoryError(''); }
      else setHistoryError(data.error || 'Could not load the upload history');
    }).catch(() => { if (!cancelled) setHistoryError('Could not load the upload history'); });
    return () => { cancelled = true; };
  }, [filter, reloadKey]);

  const coverage = history?.coverage ?? null;
  const uploads = history?.uploads ?? null;

  return (
    <PageStack>
      <PageHeader eyebrow="Reports" title="Onboarding Reports" description="Upload the source files. Every upload is previewed first, validated, and kept in the history below." />
      <ReportTabs />
      {coverage && (
        <Panel padding="compact">
          <div className="space-y-3">
            <DataThrough coverage={coverage} />
            <MissingDataNotice
              coverage={coverage}
              scope={filter.month ? monthLabel(filter.month) : coverage.range ? `${formatCoverageDate(coverage.range.from)} – ${formatCoverageDate(coverage.range.to)}` : 'the uploaded range'}
            />
          </div>
        </Panel>
      )}
      <MultiFileUploadCard card={AUTO_CARD} onDone={loadHistory} />
      <DailyFtdPanel onSaved={loadHistory} />
      <details className="group rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)]">
        <summary className="cursor-pointer select-none px-5 py-3.5 text-xs font-medium text-[var(--mos-text-secondary)]">
          Choose type manually
          <span className="ml-2 font-normal text-[var(--mos-text-faint)]">Use when the detected type is wrong or you want a specific parser.</span>
        </summary>
        <div className={`grid gap-6 border-t border-[var(--mos-border-subtle)] p-5 ${history?.permissions?.isAdmin ? 'xl:grid-cols-2' : ''}`}>
          <UploadCard card={CARDS.onboarding} kind="onboarding" onDone={loadHistory} />
          {history?.permissions?.isAdmin && <UploadCard card={CARDS.ftd} kind="ftd" onDone={loadHistory} />}
        </div>
      </details>
      <Panel padding="compact">
        <p className="text-xs text-[var(--mos-text-muted)]">
          KYC rejection reasons come from the <span className="text-[var(--mos-text-secondary)]">Remark</span> column on the user_approved upload. Staff is Manual + manual_kyc with a human Remark. Robot is an approver of robot/system, Approval Method Auto, Steps auto_*, or a machine Remark. No separate rejection file is needed.
        </p>
      </Panel>
      <DataTableFrame
        title="Upload history"
        description="Newest first. Web uploads and CLI imports. Times and data dates in WIB."
        action={history ? <span className="text-xs text-[var(--mos-text-muted)]">{formatInteger(history.total)} uploads</span> : undefined}
      >
        <Toolbar className="rounded-none border-x-0 border-t-0">
          <FilterGroup>
            <div className="w-44 shrink-0">
              <Select aria-label="Filter by type" value={filter.kind} onChange={e => setFilter(f => ({ ...f, kind: e.target.value, page: 1 }))}>
                <option value="">All types</option>
                <option value="onboarding_summary">Onboarding daily summary</option>
                <option value="user_approved">User approved</option>
                <option value="onboarding">Onboarding (classic)</option>
                <option value="ftd">FTD</option>
              </Select>
            </div>
            <div className="w-48 shrink-0">
              <Select aria-label="Filter by data month" value={filter.month} onChange={e => setFilter(f => ({ ...f, month: e.target.value, page: 1 }))}>
                <option value="">All data months</option>
                {(history?.months ?? []).map(month => <option key={month} value={month}>{monthLabel(month)}</option>)}
              </Select>
            </div>
          </FilterGroup>
          {history && history.pageCount > 1 && (
            <div className="flex items-center gap-2 text-xs text-[var(--mos-text-muted)]">
              <Button size="sm" variant="ghost" disabled={history.page <= 1} onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))}>← Prev</Button>
              <span>Page {history.page} of {history.pageCount}</span>
              <Button size="sm" variant="ghost" disabled={history.page >= history.pageCount} onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))}>Next →</Button>
            </div>
          )}
        </Toolbar>
        {historyError ? <p className="px-5 py-6 text-xs text-red-300">{historyError}</p> : !uploads ? <p className="px-5 py-6 text-xs text-[var(--mos-text-muted)]">Loading…</p> : uploads.length === 0 ? (
          <EmptyState
            title={filter.kind || filter.month ? 'No uploads match these filters' : 'No uploads yet'}
            description={filter.kind || filter.month ? 'Change the type or month filter.' : 'Uploads will be listed here with who uploaded them and what changed.'}
          />
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--mos-text-faint)]"><tr>{['When', 'Type', 'File', 'Data (WIB)', 'Source offset', 'Rows', 'Inserted', 'Updated', 'Duplicate', 'Invalid', 'By'].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {uploads.map(u => (
                <tr key={u.id} className="border-t border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]">
                  <td className="whitespace-nowrap px-4 py-2">{formatDateTimeWib(u.created_at)}</td>
                  <td className="px-4 py-2">{KIND_LABELS[u.kind] ?? u.kind}</td>
                  <td className="max-w-xs truncate px-4 py-2" title={u.file_name}>{u.file_name}</td>
                  <td className="whitespace-nowrap px-4 py-2">{u.data_from ? (u.data_from === u.data_to ? formatCoverageDate(u.data_from) : `${formatCoverageDate(u.data_from)} – ${formatCoverageDate(u.data_to ?? u.data_from)}`) : '—'}</td>
                  <td className="px-4 py-2">{u.source_utc_offset ?? '—'}</td>
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


type QueueItem = {
  id: string;
  file: File;
  status: 'queued' | 'previewing' | 'ready' | 'error' | 'importing' | 'done';
  preview: Preview | null;
  result: Preview | null;
  error: { message: string; hints?: string[] } | null;
};

/**
 * Multi-file auto-detect upload. Replaces the old single-file dropzone that only
 * kept files[0], which made a summary + user_approved pair look like one detection.
 */
function MultiFileUploadCard({ card, onDone }: { card: CardConfig; onDone: () => void }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [offsetChoice, setOffsetChoice] = useState('auto');
  const [customOffset, setCustomOffset] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const [rejectNotes, setRejectNotes] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId();
  const seq = useRef(0);

  const offsetParam = offsetChoice === 'custom' ? customOffset : offsetChoice === 'auto' ? '' : offsetChoice;

  const patchItem = (id: string, patch: Partial<QueueItem>) => {
    setItems(prev => prev.map(item => (item.id === id ? { ...item, ...patch } : item)));
  };

  const previewOne = async (item: QueueItem) => {
    patchItem(item.id, { status: 'previewing', error: null, preview: null, result: null });
    const params = new URLSearchParams({ mode: 'preview', fileName: item.file.name });
    if (offsetParam) params.set('offset', offsetParam);
    try {
      const response = await fetch(`${card.endpoint}?${params}`, {
        method: 'POST',
        body: item.file,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      const data = await response.json().catch(() => ({ error: 'Unexpected response' }));
      if (data.error) {
        patchItem(item.id, { status: 'error', error: { message: data.error, hints: data.hints }, preview: null });
      } else if (!data.ok) {
        patchItem(item.id, {
          status: 'error',
          preview: data,
          error: { message: (data.errors || []).join(' ') || 'Preview failed' },
        });
      } else {
        patchItem(item.id, { status: 'ready', preview: data, error: null });
      }
    } catch {
      patchItem(item.id, { status: 'error', error: { message: 'Upload failed. Check the connection and try again.' } });
    }
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    // Compute against the current queue outside the updater so Strict Mode
    // double-invokes cannot duplicate ids or kick off two preview loops.
    const result = selectUploadFiles(
      items.map(i => i.file),
      incoming,
      { maxFiles: MAX_MULTI_UPLOAD_FILES, maxBytes: MAX_UPLOAD_BYTES },
    );
    const notes = result.rejected.map(r => `${r.name}: ${r.reason}`);
    if (result.hitFileCap) notes.unshift(`Only ${MAX_MULTI_UPLOAD_FILES} files can be queued at once.`);
    setRejectNotes(notes);
    const existingKeys = new Set(items.map(i => `${i.file.name}::${i.file.size}`));
    const fresh: QueueItem[] = [];
    for (const file of result.accepted) {
      if (existingKeys.has(`${file.name}::${file.size}`)) continue;
      seq.current += 1;
      fresh.push({
        id: `${idPrefix}-${seq.current}`,
        file,
        status: 'queued',
        preview: null,
        result: null,
        error: null,
      });
    }
    if (!fresh.length) return;
    setItems(prev => {
      const keys = new Set(prev.map(i => `${i.file.name}::${i.file.size}`));
      const unique = fresh.filter(item => !keys.has(`${item.file.name}::${item.file.size}`));
      return unique.length ? [...prev, ...unique] : prev;
    });
    // Defer until after React commits the queue, then preview sequentially.
    window.setTimeout(() => {
      void (async () => {
        for (const item of fresh) {
          await previewOne(item);
        }
      })();
    }, 0);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const removeItem = (id: string) => setItems(prev => prev.filter(item => item.id !== id));

  const commitOne = async (item: QueueItem): Promise<boolean> => {
    if (!item.preview?.ok || !item.preview.detectedKind) return false;
    patchItem(item.id, { status: 'importing', error: null });
    const params = new URLSearchParams({ mode: 'commit', fileName: item.file.name, expect: item.preview.detectedKind });
    if (offsetParam) params.set('offset', offsetParam);
    try {
      const response = await fetch(`${card.endpoint}?${params}`, {
        method: 'POST',
        body: item.file,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      const data = await response.json().catch(() => ({ error: 'Unexpected response' }));
      if (data.error || !response.ok || !data.ok) {
        patchItem(item.id, {
          status: 'error',
          error: { message: data.error || (data.errors || []).join(' ') || 'Import failed', hints: data.hints },
          preview: item.preview,
        });
        return false;
      }
      patchItem(item.id, { status: 'done', result: data, preview: null, error: null });
      return true;
    } catch {
      patchItem(item.id, { status: 'error', error: { message: 'Import failed. Check the connection and try again.' }, preview: item.preview });
      return false;
    }
  };

  const importAllValid = async () => {
    const candidates = items
      .filter(i => i.status === 'ready' && i.preview)
      .map(i => ({ item: i, ok: Boolean(i.preview?.ok), error: i.error?.message ?? null }));
    const ready = validItemsForImport(candidates).map(c => c.item);
    if (!ready.length) return;
    setBatchBusy(true);
    let anyOk = false;
    // Sequential commits: one bad file must not block the rest.
    for (const item of ready) {
      const ok = await commitOne(item);
      if (ok) anyOk = true;
    }
    setBatchBusy(false);
    if (anyOk) onDone();
  };

  const importOne = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item || item.status !== 'ready') return;
    setBatchBusy(true);
    const ok = await commitOne(item);
    setBatchBusy(false);
    if (ok) onDone();
  };

  const validCount = items.filter(i => i.status === 'ready' && i.preview?.ok).length;
  const busy = batchBusy || items.some(i => i.status === 'previewing' || i.status === 'importing');

  return (
    <Panel className="border-[rgba(46,181,196,0.35)]">
      <SectionHeader title={card.title} description={card.description} />
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <FormField label="Files">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-[var(--mos-radius-control)] border border-dashed px-4 py-5 text-center text-xs transition-colors ${dragging ? 'border-[rgba(46,181,196,0.7)] bg-[rgba(46,181,196,0.08)]' : 'border-[var(--mos-border)] bg-[var(--mos-raised)]'}`}
          >
            <span className="font-medium text-[var(--mos-text-secondary)]">
              {items.length ? `${items.length} file${items.length === 1 ? '' : 's'} queued — drop or click to add more` : 'Drop files here or click to choose'}
            </span>
            <span className="mt-1 text-[var(--mos-text-faint)]">.xlsx or .csv · up to {MAX_MULTI_UPLOAD_FILES} files · {formatInteger(MAX_UPLOAD_BYTES / (1024 * 1024))} MB each</span>
            <input
              ref={inputRef}
              type="file"
              accept={card.accept}
              multiple
              className="sr-only"
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>
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
      {rejectNotes.length > 0 && (
        <div className="mt-3 space-y-1 text-xs text-amber-200">
          {rejectNotes.map(note => <p key={note}>{note}</p>)}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={validCount === 0 || busy} onClick={() => void importAllValid()}>
          {batchBusy ? 'Importing…' : `Import all valid (${formatInteger(validCount)})`}
        </Button>
        {items.length > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => { setItems([]); setRejectNotes([]); }}>Clear queue</Button>
        )}
      </div>
      {items.length > 0 && (
        <div className="mt-4 space-y-3">
          {items.map(item => {
            const kind = (item.preview?.detectedKind ?? item.result?.detectedKind ?? null) as DetectedKind | null;
            const preview = item.preview ?? item.result;
            return (
              <div key={item.id} className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[var(--mos-text)]" title={item.file.name}>{item.file.name}</p>
                    <p className="text-[var(--mos-text-faint)] text-[11px]">{formatInteger(Math.ceil(item.file.size / 1024))} KB
                      {item.status === 'previewing' ? ' · Checking…' : ''}
                      {item.status === 'importing' ? ' · Saving…' : ''}
                      {item.status === 'done' ? ' · Imported' : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.preview?.detectedLabel && <StatusBadge tone="info" dot>Detected: {item.preview.detectedLabel}</StatusBadge>}
                    {item.result?.detectedLabel && <StatusBadge tone="success" dot>{item.result.detectedLabel}</StatusBadge>}
                    {item.status === 'ready' && (
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => void importOne(item.id)}>Import</Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy && item.status === 'importing'} onClick={() => removeItem(item.id)}>Remove</Button>
                  </div>
                </div>
                {item.error && (
                  <div className="mt-2 space-y-1 text-xs text-red-300">
                    <p>{item.error.message}</p>
                    {(item.error.hints ?? []).map(hint => <p key={hint} className="text-red-200/80">{hint}</p>)}
                  </div>
                )}
                {preview && kind && item.status !== 'done' && <PreviewDetails kind={kind} preview={preview} />}
                {item.result?.counts && kind && (
                  <p className="mt-3 rounded-[var(--mos-radius-control)] border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
                    {item.result.detectedLabel ? `${item.result.detectedLabel}. ` : ''}
                    {kind === 'onboarding' || kind === 'onboarding_summary' || kind === 'user_approved'
                      ? <>Saved: {formatInteger(item.result.counts.inserted)} new, {formatInteger(item.result.counts.skippedDuplicate)} skipped as duplicate{item.result.counts.duplicatesInFile ? ` (${formatInteger(item.result.counts.duplicatesInFile)} repeated within the file)` : ''}, {formatInteger(item.result.counts.invalid)} invalid (offset {item.result.offset}).</>
                      : <>Saved: {formatInteger(item.result.counts.inserted)} new, {formatInteger(item.result.counts.updated)} updated, {formatInteger(item.result.counts.unchanged)} unchanged, {formatInteger(item.result.counts.skipped)} skipped (offset {item.result.offset}).</>}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/**
 * One upload panel. `kind` set = manual type (that parser's endpoint);
 * no `kind` = auto-detect: the preview shows the detected type and the commit
 * sends it back as `expect`, so only the previewed type can be saved.
 */
function UploadCard({ card, kind: fixedKind, onDone, primary }: { card: CardConfig; kind?: Kind; onDone: () => void; primary?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [offsetChoice, setOffsetChoice] = useState('auto');
  const [customOffset, setCustomOffset] = useState('');
  const [busy, setBusy] = useState<'' | 'preview' | 'commit'>('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState<{ message: string; hints?: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const kind: DetectedKind | null = fixedKind ?? preview?.detectedKind ?? result?.detectedKind ?? null;

  const pick = (next: File | null) => { setFile(next); setPreview(null); setResult(null); setError(null); };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) pick(dropped);
  };

  const send = async (mode: 'preview' | 'commit') => {
    if (!file) return;
    setBusy(mode);
    setError(null);
    const params = new URLSearchParams({ mode, fileName: file.name });
    const offset = offsetChoice === 'custom' ? customOffset : offsetChoice === 'auto' ? '' : offsetChoice;
    if (offset) params.set('offset', offset);
    if (mode === 'commit' && !fixedKind && preview?.detectedKind) params.set('expect', preview.detectedKind);
    try {
      const response = await fetch(`${card.endpoint}?${params}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
      const data = await response.json().catch(() => ({ error: 'Unexpected response' }));
      if (data.error) { setError({ message: data.error, hints: data.hints }); if (mode === 'preview') setPreview(null); }
      else if (mode === 'preview') { setPreview(data); setResult(null); }
      else if (!response.ok || !data.ok) setError({ message: (data.errors || []).join(' ') || 'Upload failed' });
      else { setResult(data); setPreview(null); onDone(); }
    } catch {
      setError({ message: 'Upload failed. Check the connection and try again.' });
    } finally {
      setBusy('');
    }
  };

  return (
    <Panel className={primary ? 'border-[rgba(46,181,196,0.35)]' : undefined}>
      <SectionHeader title={card.title} description={card.description} />
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <FormField label="File">
          {primary ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-[var(--mos-radius-control)] border border-dashed px-4 py-5 text-center text-xs transition-colors ${dragging ? 'border-[rgba(46,181,196,0.7)] bg-[rgba(46,181,196,0.08)]' : 'border-[var(--mos-border)] bg-[var(--mos-raised)]'}`}
            >
              <span className="font-medium text-[var(--mos-text-secondary)]">{file ? file.name : 'Drop a file here or click to choose'}</span>
              <span className="mt-1 text-[var(--mos-text-faint)]">{file ? `${formatInteger(Math.ceil(file.size / 1024))} KB · click to change` : '.xlsx or .csv, up to 25 MB'}</span>
              <input ref={inputRef} type="file" accept={card.accept} className="sr-only" onChange={e => pick(e.target.files?.[0] ?? null)} />
            </div>
          ) : (
            <input
              type="file"
              accept={card.accept}
              onChange={e => pick(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-[var(--mos-text-muted)] file:mr-3 file:h-8 file:rounded-[var(--mos-radius-control)] file:border file:border-[var(--mos-border)] file:bg-[var(--mos-raised)] file:px-3 file:text-xs file:text-[var(--mos-text-secondary)]"
            />
          )}
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
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!file || busy !== ''} onClick={() => send('preview')}>{busy === 'preview' ? 'Checking…' : 'Preview'}</Button>
        {preview?.ok && <Button variant="primary" disabled={busy !== ''} onClick={() => send('commit')}>{busy === 'commit' ? 'Saving…' : `Save ${formatInteger(preview.summary.rows)} rows`}</Button>}
        {!fixedKind && preview?.detectedLabel && <StatusBadge tone="info" dot>Detected: {preview.detectedLabel}</StatusBadge>}
      </div>
      {error && (
        <div className="mt-3 space-y-1 text-xs text-red-300">
          <p>{error.message}</p>
          {(error.hints ?? []).map(hint => <p key={hint} className="text-red-200/80">{hint}</p>)}
        </div>
      )}
      {preview && kind && <PreviewDetails kind={kind} preview={preview} />}
      {result?.counts && kind && (
        <p className="mt-4 rounded-[var(--mos-radius-control)] border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
          {!fixedKind && result.detectedLabel ? `${result.detectedLabel}. ` : ''}
          {kind === 'onboarding' || kind === 'onboarding_summary' || kind === 'user_approved'
            ? <>Saved: {formatInteger(result.counts.inserted)} new, {formatInteger(result.counts.skippedDuplicate)} skipped as duplicate{result.counts.duplicatesInFile ? ` (${formatInteger(result.counts.duplicatesInFile)} repeated within the file)` : ''}, {formatInteger(result.counts.invalid)} invalid (offset {result.offset}).</>
            : <>Saved: {formatInteger(result.counts.inserted)} new, {formatInteger(result.counts.updated)} updated, {formatInteger(result.counts.unchanged)} unchanged, {formatInteger(result.counts.skipped)} skipped (offset {result.offset}).</>}
        </p>
      )}
    </Panel>
  );
}

function PreviewDetails({ kind, preview }: { kind: DetectedKind; preview: Preview }) {
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
        {kind === 'user_approved' && (summary.skippedBlankApprover ?? 0) > 0 && (
          <div><dt>Skipped (empty Approver)</dt><dd className="font-semibold text-[var(--mos-text)]">{formatInteger(summary.skippedBlankApprover ?? 0)}</dd></div>
        )}
        {kind === 'user_approved' && (summary.skippedRobot ?? 0) > 0 && (
          <div><dt>Skipped ranking (Deposit Robot)</dt><dd className="font-semibold text-[var(--mos-text)]">{formatInteger(summary.skippedRobot ?? 0)}</dd></div>
        )}
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
