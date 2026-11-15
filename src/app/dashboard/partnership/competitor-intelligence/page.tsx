'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FormField, LoadingState, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextArea, TextInput,
} from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';
import {
  INTEL_CATEGORIES, INTEL_CATEGORY_LABELS, REGION_LABELS, buildTimeline,
  type ComparisonRow, type IntelOpportunity, type IntelReportResult, type Region, type SourceRef,
} from '@/lib/partnership/intel';

type RunInfo = { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; progress: number; message: string; error: string | null; trigger: string };
type CompetitorSummary = {
  id: string; name: string; region: Region; website: string | null; instagramHandle: string | null; notes: string | null;
  lastRefreshedAt: string | null; itemCount: number; overview: string; latestRun: RunInfo | null;
};
type ListResponse = { competitors: CompetitorSummary[]; comparison: ComparisonRow[]; opportunities: Array<IntelOpportunity & { competitorName: string }>; canDelete: boolean };
type Evidence = {
  id: string; kind: string; sourceUrl: string | null; pastedText: string | null; extractedText: string | null; extractionStatus: string;
  hasScreenshot: boolean; observedOn: string | null; createdByName: string | null; createdAt: string; canDelete: boolean;
};
type ReportRow = { id: string; status: string; trigger: string; message: string; error: string | null; createdAt: string; finishedAt: string | null; model: string | null; result: IntelReportResult | null };
type DetailResponse = { competitor: CompetitorSummary; evidence: Evidence[]; report: ReportRow | null; history: ReportRow[] };
type CompetitorForm = { name: string; region: Region; website: string; instagramHandle: string; notes: string };

const EMPTY_FORM: CompetitorForm = { name: '', region: 'local', website: '', instagramHandle: '', notes: '' };
const when = (value: string | null) => (value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const running = (run: RunInfo | null | undefined) => run?.status === 'queued' || run?.status === 'running';

function SourceLinks({ sources }: { sources: SourceRef[] }) {
  return <span className="flex flex-wrap gap-x-2 gap-y-1">
    {sources.map(source => source.url
      ? <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer nofollow" title={source.title} className="text-xs text-[var(--mos-accent-soft)] hover:underline">[{source.id}] {source.kind === 'evidence' ? 'Team evidence' : source.title.slice(0, 60)}</a>
      : <a key={source.id} href={`#evidence-${source.evidenceId}`} className="text-xs text-[var(--mos-accent-soft)] hover:underline">[{source.id}] Team evidence</a>)}
  </span>;
}

function CompetitorFields({ form, setForm }: { form: CompetitorForm; setForm: (next: CompetitorForm) => void }) {
  return <div className="grid gap-3 md:grid-cols-2">
    <FormField label="Name" required><TextInput value={form.name} maxLength={80} onChange={event => setForm({ ...form, name: event.target.value })} /></FormField>
    <FormField label="Region">
      <Select value={form.region} onChange={event => setForm({ ...form, region: event.target.value as Region })}>
        <option value="local">Local</option>
        <option value="international">International</option>
      </Select>
    </FormField>
    <FormField label="Website" hint="Official site only. Leave blank if unknown."><TextInput value={form.website} placeholder="https://" spellCheck={false} onChange={event => setForm({ ...form, website: event.target.value })} /></FormField>
    <FormField label="Instagram handle" hint="Stored as a link; never scraped."><TextInput value={form.instagramHandle} placeholder="@handle" spellCheck={false} onChange={event => setForm({ ...form, instagramHandle: event.target.value })} /></FormField>
    <FormField label="Notes" className="md:col-span-2"><TextArea rows={2} maxLength={1000} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></FormField>
  </div>;
}

export default function CompetitorIntelligencePage() {
  const [list, setList] = useState<ListResponse | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [message, setMessage] = useState('');
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState<CompetitorForm>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<CompetitorForm | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [evidenceDate, setEvidenceDate] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const { ok, data } = await fetchJson<ListResponse>('/api/partnership/competitors');
    if (!ok) { setMessage(data.error || 'Could not load competitors.'); return; }
    setList(data);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const { ok, data } = await fetchJson<DetailResponse>(`/api/partnership/competitors/${encodeURIComponent(id)}`);
    if (!ok) { setMessage(data.error || 'Could not load the competitor.'); return; }
    setDetail(data);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadList(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => { void loadDetail(selectedId); }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedId, loadDetail]);

  const anyRunning = Boolean(list?.competitors.some(item => running(item.latestRun)));
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => {
      void loadList();
      if (selectedId) void loadDetail(selectedId);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [anyRunning, selectedId, loadList, loadDetail]);

  const select = (id: string) => {
    setSelectedId(id);
    setEditForm(null);
    setDetail(null);
  };

  const refresh = async (id: string) => {
    setMessage('');
    const { ok, data } = await fetchJson<{ id: string }>(`/api/partnership/competitors/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
    setMessage(ok ? 'Refresh started. It reads the website, news, and team evidence, then summarizes.' : data.error || 'Could not start the refresh.');
    await loadList();
  };

  const saveNew = async () => {
    setBusy(true); setMessage('');
    try {
      const { ok, data } = await fetchJson<{ id: string }>('/api/partnership/competitors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(newForm) });
      if (!ok) { setMessage(data.error || 'Could not add the competitor.'); return; }
      setNewForm(EMPTY_FORM); setAdding(false);
      await loadList();
      select(data.id);
    } finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (!editForm || !selectedId) return;
    setBusy(true); setMessage('');
    try {
      const { ok, data } = await fetchJson(`/api/partnership/competitors/${encodeURIComponent(selectedId)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(editForm) });
      if (!ok) { setMessage(data.error || 'Could not save.'); return; }
      setEditForm(null);
      await Promise.all([loadList(), loadDetail(selectedId)]);
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!detail || !window.confirm(`Delete ${detail.competitor.name}, its evidence, and its reports?`)) return;
    const { ok, data } = await fetchJson(`/api/partnership/competitors/${encodeURIComponent(detail.competitor.id)}`, { method: 'DELETE' });
    if (!ok) { setMessage(data.error || 'Could not delete.'); return; }
    setSelectedId(''); setDetail(null);
    await loadList();
  };

  const addEvidence = async () => {
    if (!selectedId) return;
    setBusy(true); setMessage('');
    try {
      const form = new FormData();
      form.set('sourceUrl', evidenceUrl);
      form.set('pastedText', evidenceText);
      form.set('observedOn', evidenceDate);
      if (evidenceFile) form.set('file', evidenceFile);
      const { ok, data } = await fetchJson(`/api/partnership/competitors/${encodeURIComponent(selectedId)}/evidence`, { method: 'POST', body: form });
      if (!ok) { setMessage(data.error || 'Could not save the evidence.'); return; }
      setEvidenceUrl(''); setEvidenceText(''); setEvidenceDate(''); setEvidenceFile(null); setFileInputKey(key => key + 1);
      setMessage(evidenceFile ? 'Evidence saved. The screenshot text is read in the background; refresh the competitor to include it.' : 'Evidence saved. Refresh the competitor to include it.');
      await loadDetail(selectedId);
    } finally { setBusy(false); }
  };

  const removeEvidence = async (evidenceId: string) => {
    if (!selectedId) return;
    const { ok, data } = await fetchJson(`/api/partnership/competitors/${encodeURIComponent(selectedId)}/evidence?evidenceId=${encodeURIComponent(evidenceId)}`, { method: 'DELETE' });
    if (!ok) { setMessage(data.error || 'Could not delete the evidence.'); return; }
    await loadDetail(selectedId);
  };

  if (!list) return message ? <Panel><p className="text-sm text-red-300">{message}</p></Panel> : <LoadingState label="Loading Competitor Intelligence" />;

  const selected = list.competitors.find(item => item.id === selectedId) || null;
  const result = detail?.report?.result || null;
  const timeline = result ? buildTimeline(result.items) : [];

  return <PageStack>
    <PageHeader
      eyebrow="Partnership / Competitor Intelligence"
      title="Competitor Intelligence"
      description="What competitor brokers did in the last 3 months, from their websites, news, and Instagram evidence the team pastes. Every item links to its source; anything without a source is not shown."
      actions={<Button variant="primary" onClick={() => setAdding(value => !value)}>{adding ? 'Cancel' : 'Add competitor'}</Button>}
    />
    {message && <Panel padding="compact"><p className="text-sm text-[var(--mos-text-secondary)]">{message}</p></Panel>}

    {adding && <Panel>
      <SectionHeader title="New competitor" className="mb-4" />
      <CompetitorFields form={newForm} setForm={setNewForm} />
      <div className="mt-4"><Button variant="primary" disabled={busy || !newForm.name.trim()} onClick={saveNew}>Save competitor</Button></div>
    </Panel>}

    <DataTableFrame title="Comparison" description="Cited items per category in each competitor's latest refresh. Refreshes run weekly; Refresh runs one now.">
      {!list.competitors.length && <EmptyState title="No competitors yet" description="Add a competitor to start." />}
      {list.competitors.length > 0 && <table className="w-full min-w-[1080px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
          <tr>
            <th className="p-3">Competitor</th><th className="p-3">Region</th>
            {INTEL_CATEGORIES.map(category => <th key={category} className="p-3 text-right" title={INTEL_CATEGORY_LABELS[category]}>{INTEL_CATEGORY_LABELS[category].split(' /')[0]}</th>)}
            <th className="p-3 text-right">Total</th><th className="p-3">Latest headline</th><th className="p-3">Last refresh</th><th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {list.competitors.map(competitor => {
            const row = list.comparison.find(item => item.competitorId === competitor.id);
            const run = competitor.latestRun;
            return <tr key={competitor.id} className={`border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)] ${competitor.id === selectedId ? 'bg-white/[0.04]' : ''}`}>
              <td className="p-3"><button type="button" className="font-medium text-[var(--mos-text)] hover:underline" onClick={() => select(competitor.id)}>{competitor.name}</button>{!competitor.website && <span className="ml-2 text-[11px] text-amber-200">No website</span>}</td>
              <td className="p-3"><StatusBadge tone={competitor.region === 'local' ? 'info' : 'neutral'}>{REGION_LABELS[competitor.region]}</StatusBadge></td>
              {INTEL_CATEGORIES.map(category => <td key={category} className="p-3 text-right tabular-nums">{row?.lastRefreshed ? row.counts[category] : '—'}</td>)}
              <td className="p-3 text-right tabular-nums">{row?.lastRefreshed ? row.total : '—'}</td>
              <td className="max-w-[240px] truncate p-3 text-xs" title={row?.headline || ''}>{row?.headline || '—'}</td>
              <td className="p-3 text-xs">
                {running(run) ? <span>{run?.message || 'Running'} ({run?.progress}%)</span> : when(competitor.lastRefreshedAt)}
                {run?.status === 'failed' && <span className="block text-red-300" title={run.error || ''}>Last refresh failed</span>}
              </td>
              <td className="p-3 text-right"><span className="flex justify-end gap-2">
                <Button size="sm" onClick={() => select(competitor.id)}>Open</Button>
                <Button size="sm" disabled={running(run)} onClick={() => refresh(competitor.id)}>{running(run) ? 'Refreshing…' : 'Refresh'}</Button>
              </span></td>
            </tr>;
          })}
        </tbody>
      </table>}
    </DataTableFrame>

    <Panel>
      <SectionHeader title="Opportunities for Dupoin" description="Ideas from the latest refresh of every competitor. Each one cites the sources it is based on." className="mb-3" />
      {!list.opportunities.length && <p className="text-sm text-[var(--mos-text-muted)]">No opportunities yet. Refresh a competitor to generate them.</p>}
      <ul className="space-y-3">
        {list.opportunities.map((item, index) => <li key={`${item.competitorName}-${index}`} className="text-sm">
          <p className="text-[var(--mos-text)]"><span className="mr-2 text-xs text-[var(--mos-text-faint)]">{item.competitorName}</span>{item.title}</p>
          {item.detail && <p className="mt-1 text-[var(--mos-text-secondary)]">{item.detail}</p>}
          <div className="mt-1"><SourceLinks sources={item.sources} /></div>
        </li>)}
      </ul>
    </Panel>

    {selected && !detail && <LoadingState label={`Loading ${selected.name}`} />}
    {detail && <>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-[var(--mos-text)]">{detail.competitor.name}</h2>
            <p className="mt-1 text-xs text-[var(--mos-text-muted)]">
              {REGION_LABELS[detail.competitor.region]}
              {detail.competitor.website && <> · <a className="text-[var(--mos-accent-soft)] hover:underline" href={detail.competitor.website} target="_blank" rel="noopener noreferrer nofollow">{detail.competitor.website}</a></>}
              {detail.competitor.instagramHandle && <> · <a className="text-[var(--mos-accent-soft)] hover:underline" href={`https://www.instagram.com/${detail.competitor.instagramHandle}/`} target="_blank" rel="noopener noreferrer nofollow">@{detail.competitor.instagramHandle}</a></>}
            </p>
            {detail.competitor.notes && <p className="mt-2 text-sm text-[var(--mos-text-secondary)]">{detail.competitor.notes}</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={running(selected?.latestRun)} onClick={() => refresh(detail.competitor.id)}>{running(selected?.latestRun) ? 'Refreshing…' : 'Refresh'}</Button>
            <Button size="sm" onClick={() => setEditForm(editForm ? null : {
              name: detail.competitor.name, region: detail.competitor.region, website: detail.competitor.website || '', instagramHandle: detail.competitor.instagramHandle || '', notes: detail.competitor.notes || '',
            })}>{editForm ? 'Cancel edit' : 'Edit'}</Button>
            {list.canDelete && <Button size="sm" variant="ghost" onClick={remove}>Delete</Button>}
          </div>
        </div>
        {running(selected?.latestRun) && <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[var(--mos-accent)]" style={{ width: `${selected?.latestRun?.progress || 0}%` }} /></div>}
        {editForm && <div className="mt-4">
          <CompetitorFields form={editForm} setForm={setEditForm} />
          <div className="mt-4"><Button variant="primary" disabled={busy || !editForm.name.trim()} onClick={saveEdit}>Save changes</Button></div>
        </div>}
      </Panel>

      {!result && <Panel><p className="text-sm text-[var(--mos-text-muted)]">No refresh yet. Click Refresh to build the 3-month summary.</p></Panel>}
      {result && <>
        <Panel>
          <SectionHeader title={`Last 3 months (${result.window.start} to ${result.window.end})`} description={`Refreshed ${when(detail.report?.finishedAt || null)}${detail.report?.model ? ` · ${detail.report.model}` : ''}`} className="mb-3" />
          {result.overview && <p className="text-sm leading-6 text-[var(--mos-text-secondary)]">{result.overview}</p>}
          {result.notes.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[var(--mos-text-muted)]">{result.notes.map(note => <li key={note}>{note}</li>)}</ul>}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          {INTEL_CATEGORIES.map(category => {
            const items = result.items.filter(item => item.category === category);
            return <Panel key={category} padding="compact">
              <SectionHeader title={`${INTEL_CATEGORY_LABELS[category]} (${items.length})`} className="mb-2" />
              {!items.length && <p className="text-xs text-[var(--mos-text-faint)]">Nothing cited in this window.</p>}
              <ul className="space-y-3">
                {items.map((item, index) => <li key={`${item.title}-${index}`} className="text-sm">
                  <p className="text-[var(--mos-text)]">{item.title}{item.date && <span className="ml-2 text-xs text-[var(--mos-text-faint)]">{item.date}</span>}</p>
                  {item.summary && <p className="mt-0.5 text-[var(--mos-text-secondary)]">{item.summary}</p>}
                  <div className="mt-1"><SourceLinks sources={item.sources} /></div>
                </li>)}
              </ul>
            </Panel>;
          })}
        </div>

        <Panel>
          <SectionHeader title="Monthly timeline" className="mb-3" />
          {!timeline.length && <p className="text-sm text-[var(--mos-text-muted)]">No cited activity.</p>}
          <ol className="space-y-4">
            {timeline.map(group => <li key={group.month}>
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--mos-text-faint)]">{group.label}</p>
              <ul className="mt-1 space-y-1 border-l border-[var(--mos-border)] pl-3">
                {group.items.map((item, index) => <li key={`${item.title}-${index}`} className="text-sm text-[var(--mos-text-secondary)]">
                  <span className="mr-2 text-xs text-[var(--mos-text-faint)]">{INTEL_CATEGORY_LABELS[item.category]}</span>{item.title} <SourceLinks sources={item.sources} />
                </li>)}
              </ul>
            </li>)}
          </ol>
        </Panel>

        <Panel>
          <SectionHeader title={`Opportunities for Dupoin from ${detail.competitor.name}`} className="mb-3" />
          {!result.opportunities.length && <p className="text-sm text-[var(--mos-text-muted)]">None cited in this refresh.</p>}
          <ul className="space-y-3">
            {result.opportunities.map((item, index) => <li key={`${item.title}-${index}`} className="text-sm">
              <p className="text-[var(--mos-text)]">{item.title}</p>
              {item.detail && <p className="mt-0.5 text-[var(--mos-text-secondary)]">{item.detail}</p>}
              <div className="mt-1"><SourceLinks sources={item.sources} /></div>
            </li>)}
          </ul>
        </Panel>
      </>}

      <Panel>
        <SectionHeader title="Instagram and other evidence" description="Paste a post link with its caption, or upload a screenshot. Links are stored, never scraped. Screenshots are read by a vision model when one is available." className="mb-4" />
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Post link" hint="Instagram, TikTok, or any URL"><TextInput value={evidenceUrl} placeholder="https://www.instagram.com/p/…" spellCheck={false} onChange={event => setEvidenceUrl(event.target.value)} /></FormField>
          <FormField label="Posted on" hint="Optional"><TextInput type="date" value={evidenceDate} onChange={event => setEvidenceDate(event.target.value)} /></FormField>
          <FormField label="Caption or notes" className="md:col-span-2"><TextArea rows={3} maxLength={4000} value={evidenceText} onChange={event => setEvidenceText(event.target.value)} placeholder="Paste the caption text" /></FormField>
          <FormField label="Screenshot" hint="PNG, JPG, or WebP up to 5 MB">
            <input key={fileInputKey} aria-label="Screenshot" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setEvidenceFile(event.target.files?.[0] ?? null)} />
          </FormField>
        </div>
        <div className="mt-4"><Button variant="primary" disabled={busy || (!evidenceUrl.trim() && !evidenceText.trim() && !evidenceFile)} onClick={addEvidence}>Add evidence</Button></div>
        <ul className="mt-5 space-y-3">
          {detail.evidence.map(item => <li key={item.id} id={`evidence-${item.id}`} className="flex gap-3 rounded-[6px] border border-[var(--mos-border)] p-3 text-sm">
            {item.hasScreenshot && <a href={`/api/partnership/evidence/${item.id}/screenshot`} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/partnership/evidence/${item.id}/screenshot`} alt="Evidence screenshot" className="h-20 w-20 rounded object-cover" />
            </a>}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[var(--mos-text-faint)]">{item.createdByName || 'Team'} · {when(item.createdAt)}{item.observedOn && ` · posted ${item.observedOn}`}</p>
              {item.sourceUrl && <a className="block truncate text-xs text-[var(--mos-accent-soft)] hover:underline" href={item.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{item.sourceUrl}</a>}
              {item.pastedText && <p className="mt-1 whitespace-pre-wrap text-[var(--mos-text-secondary)]">{item.pastedText}</p>}
              {item.hasScreenshot && item.extractionStatus === 'done' && <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--mos-text-muted)]">Screenshot text: {item.extractedText}</p>}
              {item.hasScreenshot && item.extractionStatus === 'failed' && <p className="mt-1 text-xs text-amber-200">No vision model read this screenshot. It is stored; add the caption text so the refresh can use it.</p>}
              {item.hasScreenshot && item.extractionStatus === 'none' && <p className="mt-1 text-xs text-[var(--mos-text-faint)]">Reading screenshot…</p>}
            </div>
            {item.canDelete && <Button size="sm" variant="ghost" onClick={() => removeEvidence(item.id)}>Delete</Button>}
          </li>)}
        </ul>
        {!detail.evidence.length && <p className="mt-4 text-sm text-[var(--mos-text-muted)]">No evidence yet.</p>}
      </Panel>

      {detail.history.length > 0 && <DataTableFrame title="Refresh history">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Started</th><th className="p-3">Trigger</th><th className="p-3">Status</th><th className="p-3">Detail</th></tr></thead>
          <tbody>
            {detail.history.map(run => <tr key={run.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
              <td className="p-3 text-xs">{when(run.createdAt)}</td>
              <td className="p-3 text-xs">{run.trigger}</td>
              <td className="p-3 text-xs"><StatusBadge tone={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'danger' : 'info'}>{run.status}</StatusBadge></td>
              <td className="p-3 text-xs">{run.error || run.message}</td>
            </tr>)}
          </tbody>
        </table>
      </DataTableFrame>}
    </>}
  </PageStack>;
}
