'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FormField, LoadingState, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextArea, TextInput,
} from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';
import { TregCostNotice, useTregStatus, type TregStatus } from '@/components/seo/TregCostNotice';
import { RefreshToolbar } from '@/components/partnership/RefreshToolbar';
import { CONTENT_PATTERN_LABELS, type CampaignItem, type RegularContentItem } from '@/lib/partnership/campaigns';
import {
  INTEL_CATEGORIES, INTEL_CATEGORY_LABELS, REGION_LABELS, buildTimeline,
  type ComparisonRow, type IntelItem, type IntelOpportunity, type IntelReportResult, type Region, type SourceRef,
} from '@/lib/partnership/intel';
import { reportMode, reportModeLabel, type ReportMode, type ToolbarTregStatus } from '@/lib/partnership/refresh-plan';

type PartnershipTregStatus = TregStatus & ToolbarTregStatus;
/** Item categories shown under "Other activity"; legacy campaigns/social items are shown as regular content. */
const OTHER_CATEGORIES = INTEL_CATEGORIES.filter(category => category !== 'campaigns' && category !== 'social');

function CampaignCard({ campaign }: { campaign: CampaignItem }) {
  return <li className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3 text-sm" data-testid="campaign-card">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-medium text-[var(--mos-text)]">{campaign.name}</p>
      <span className="text-xs text-[var(--mos-text-faint)]">{[campaign.period, campaign.date].filter(Boolean).join(' · ')}</span>
    </div>
    <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[110px_1fr]">
      <dt className="text-[var(--mos-text-faint)]">Brand comm</dt><dd className="text-[var(--mos-text-secondary)]">{campaign.brandComm ? `“${campaign.brandComm}”` : '—'}</dd>
      <dt className="text-[var(--mos-text-faint)]">Hashtags</dt>
      <dd className="flex flex-wrap gap-1">{campaign.hashtags.length ? campaign.hashtags.map(tag => <span key={tag} className="rounded bg-[var(--mos-accent)]/15 px-1.5 py-0.5 text-[var(--mos-accent-soft)]">{tag}</span>) : <span className="text-[var(--mos-text-secondary)]">—</span>}</dd>
      <dt className="text-[var(--mos-text-faint)]">Format</dt><dd className="text-[var(--mos-text-secondary)]">{campaign.format || '—'}</dd>
      <dt className="text-[var(--mos-text-faint)]">Channels</dt><dd className="text-[var(--mos-text-secondary)]">{campaign.channels.join(', ') || '—'}</dd>
    </dl>
    {campaign.summary && <p className="mt-2 text-[var(--mos-text-secondary)]">{campaign.summary}</p>}
    <div className="mt-2"><SourceLinks sources={campaign.sources} /></div>
  </li>;
}

/** Regular content by pattern, plus promo/social items from reports made before the campaign split. */
type RegularRow = { key: string; label: string; summary: string; examples: string[]; sources: SourceRef[] };
function regularRows(result: IntelReportResult): RegularRow[] {
  const rows: RegularRow[] = (result.regularContent || []).map((item: RegularContentItem) => ({ key: item.pattern, label: CONTENT_PATTERN_LABELS[item.pattern], summary: item.summary, examples: item.examples, sources: item.sources }));
  const legacy = result.items.filter((item: IntelItem) => item.category === 'campaigns' || item.category === 'social');
  for (const item of legacy) rows.push({ key: `${item.category}-${item.title}`, label: INTEL_CATEGORY_LABELS[item.category], summary: item.summary || item.title, examples: [item.title], sources: item.sources });
  return rows;
}

type RunInfo = { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; progress: number; message: string; error: string | null; trigger: string };
type CompetitorSummary = {
  id: string; name: string; region: Region; website: string | null; instagramHandle: string | null; notes: string | null;
  lastRefreshedAt: string | null; lastRefreshMode: ReportMode | null; itemCount: number; overview: string; latestRun: RunInfo | null;
};
type ListResponse = { competitors: CompetitorSummary[]; comparison: ComparisonRow[]; opportunities: Array<IntelOpportunity & { competitorName: string }>; canDelete: boolean };
type Evidence = {
  id: string; kind: string; sourceUrl: string | null; pastedText: string | null; extractedText: string | null; extractionStatus: string;
  hasScreenshot: boolean; observedOn: string | null; createdByName: string | null; createdAt: string; canDelete: boolean;
};
type ReportRow = { id: string; status: string; trigger: string; message: string; error: string | null; createdAt: string; finishedAt: string | null; model: string | null; result: IntelReportResult | null; tregCost?: IntelReportResult['tregCost'] };
type DetailResponse = { competitor: CompetitorSummary; evidence: Evidence[]; report: ReportRow | null; history: ReportRow[] };
type CompetitorForm = { name: string; region: Region; website: string; instagramHandle: string; notes: string };

const EMPTY_FORM: CompetitorForm = { name: '', region: 'local', website: '', instagramHandle: '', notes: '' };
const when = (value: string | null) => (value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const running = (run: RunInfo | null | undefined) => run?.status === 'queued' || run?.status === 'running';

/** "Free" or "treg $0.0009": which source a finished refresh used. */
function ModeBadge({ mode }: { mode: ReportMode | null | undefined }) {
  if (!mode) return null;
  return <StatusBadge tone={mode.kind === 'treg' ? 'warning' : 'neutral'} className="h-5 px-1.5 text-[10px]">{reportModeLabel(mode)}</StatusBadge>;
}

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
    <FormField label="Instagram handle" hint="Used in free web searches. If treg is set up, a confirmed refresh also reads its recent public posts (paid, optional)."><TextInput value={form.instagramHandle} placeholder="@handle" spellCheck={false} onChange={event => setForm({ ...form, instagramHandle: event.target.value })} /></FormField>
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
  const [refreshIds, setRefreshIds] = useState<string[]>([]);
  const [batchActive, setBatchActive] = useState(false);
  const { status: tregRaw, reload: reloadTreg } = useTregStatus('/api/partnership/treg');
  const treg = tregRaw as PartnershipTregStatus | null;

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
    // While a toolbar batch runs, the toolbar polls the list itself.
    if (!anyRunning || batchActive) return;
    const timer = window.setInterval(() => {
      void loadList();
      if (selectedId) void loadDetail(selectedId);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [anyRunning, batchActive, selectedId, loadList, loadDetail]);

  const select = (id: string) => {
    setSelectedId(id);
    setEditForm(null);
    setDetail(null);
  };

  /** Detail view shortcut: pick this competitor in the top toolbar and scroll up to it. */
  const pickForRefresh = (id: string) => {
    setRefreshIds([id]);
    document.querySelector('[data-testid="refresh-toolbar"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      description="What competitor brokers did in the last 3 months, as brand campaigns (named idea + tagline/hashtag + format) apart from regular social content, from their websites, linked help/program pages, news, public Instagram post captions, and evidence the team pastes. Every item links to its source; anything without a source is not shown."
      actions={<Button variant="primary" onClick={() => setAdding(value => !value)}>{adding ? 'Cancel' : 'Add competitor'}</Button>}
    />
    <RefreshToolbar
      competitors={list.competitors}
      treg={treg}
      selectedIds={refreshIds}
      setSelectedIds={setRefreshIds}
      reloadTreg={reloadTreg}
      onList={data => {
        setList(current => (current ? { ...current, ...(data as Partial<ListResponse>) } : current));
        if (selectedId) void loadDetail(selectedId);
      }}
      onBatchChange={setBatchActive}
    />
    {message && <Panel padding="compact"><p className="text-sm text-[var(--mos-text-secondary)]">{message}</p></Panel>}

    {adding && <Panel>
      <SectionHeader title="New competitor" className="mb-4" />
      <CompetitorFields form={newForm} setForm={setNewForm} />
      <div className="mt-4"><Button variant="primary" disabled={busy || !newForm.name.trim()} onClick={saveNew}>Save competitor</Button></div>
    </Panel>}

    <DataTableFrame title="Comparison" description="Cited items per category in each competitor's latest refresh. Weekly refreshes use free sources; use the toolbar above to refresh now.">
      {!list.competitors.length && <EmptyState title="No competitors yet" description="Add a competitor to start." />}
      {list.competitors.length > 0 && <table className="w-full min-w-[1080px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
          <tr>
            <th className="p-3">Competitor</th><th className="p-3">Region</th>
            <th className="p-3 text-right" title="Brand campaigns: named idea + tagline/hashtag + format">Campaigns</th>
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
              <td className="p-3 text-right tabular-nums font-medium text-[var(--mos-text)]">{row?.lastRefreshed ? row.campaignCount : '—'}</td>
              {INTEL_CATEGORIES.map(category => <td key={category} className="p-3 text-right tabular-nums">{row?.lastRefreshed ? row.counts[category] : '—'}</td>)}
              <td className="p-3 text-right tabular-nums">{row?.lastRefreshed ? row.total : '—'}</td>
              <td className="max-w-[240px] truncate p-3 text-xs" title={row?.headline || ''}>{row?.headline || '—'}</td>
              <td className="p-3 text-xs">
                {running(run) ? <span>{run?.message || 'Running'} ({run?.progress}%)</span> : <span className="flex flex-wrap items-center gap-1.5">{when(competitor.lastRefreshedAt)}<ModeBadge mode={competitor.lastRefreshMode} /></span>}
                {run?.status === 'failed' && <span className="block text-red-300" title={run.error || ''}>Last refresh failed</span>}
              </td>
              <td className="p-3 text-right"><span className="flex justify-end gap-2">
                <Button size="sm" onClick={() => select(competitor.id)}>Open</Button>
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={running(selected?.latestRun) || batchActive} onClick={() => pickForRefresh(detail.competitor.id)}>{running(selected?.latestRun) ? 'Refreshing…' : 'Refresh…'}</Button>
            <Button size="sm" onClick={() => setEditForm(editForm ? null : {
              name: detail.competitor.name, region: detail.competitor.region, website: detail.competitor.website || '', instagramHandle: detail.competitor.instagramHandle || '', notes: detail.competitor.notes || '',
            })}>{editForm ? 'Cancel edit' : 'Edit'}</Button>
            {list.canDelete && <Button size="sm" variant="ghost" onClick={remove}>Delete</Button>}
          </div>
        </div>
        {treg?.configured && !detail.competitor.instagramHandle && <p className="mt-3 text-xs text-[var(--mos-text-muted)]">Add the Instagram handle to let treg read recent posts (optional, paid).</p>}
        {running(selected?.latestRun) && <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[var(--mos-accent)]" style={{ width: `${selected?.latestRun?.progress || 0}%` }} /></div>}
        {editForm && <div className="mt-4">
          <CompetitorFields form={editForm} setForm={setEditForm} />
          <div className="mt-4"><Button variant="primary" disabled={busy || !editForm.name.trim()} onClick={saveEdit}>Save changes</Button></div>
        </div>}
      </Panel>

      {!result && <Panel><p className="text-sm text-[var(--mos-text-muted)]">No refresh yet. Use Refresh competitors at the top to build the 3-month summary.</p></Panel>}
      {result && <>
        <Panel>
          <SectionHeader title={`Last 3 months (${result.window.start} to ${result.window.end})`} description={`Refreshed ${when(detail.report?.finishedAt || null)}${detail.report?.model ? ` · ${detail.report.model}` : ''}`} action={<span className="flex items-center gap-1.5 text-xs text-[var(--mos-text-faint)]" data-testid="report-mode">Source <ModeBadge mode={reportMode(result.tregCost)} /></span>} className="mb-3" />
          {result.overview && <p className="text-sm leading-6 text-[var(--mos-text-secondary)]">{result.overview}</p>}
          {result.notes.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[var(--mos-text-muted)]">{result.notes.map(note => <li key={note}>{note}</li>)}</ul>}
          {result.tregCost && treg && <TregCostNotice feature="Competitor Intelligence" status={treg} estimate={{ totalMicro: result.tregCost.estimatedMicro, calls: result.tregCost.calls }}
            result={{ estimatedMicro: result.tregCost.estimatedMicro, actualMicro: result.tregCost.actualMicro, source: result.tregCost.source, balanceAfterMicro: result.tregCost.balanceAfterMicro }} />}
        </Panel>

        <Panel>
          <SectionHeader title={`Brand campaigns (${result.campaigns?.length ?? 0})`} description="Brand-level communication with a named idea or tagline, a hashtag, and a content format. Giveaways, quizzes and educational posts are listed under regular social content instead." className="mb-3" />
          {!result.campaigns && <p className="text-sm text-[var(--mos-text-muted)]">This refresh ran before campaigns were split out. Refresh to rebuild it.</p>}
          {result.campaigns && !result.campaigns.length && <p className="text-sm text-[var(--mos-text-muted)]">No campaign could be cited. If you have seen one on Instagram, paste its post link under evidence below and refresh.</p>}
          <ul className="grid gap-3 lg:grid-cols-2">{(result.campaigns || []).map((campaign, index) => <CampaignCard key={`${campaign.name}-${index}`} campaign={campaign} />)}</ul>
        </Panel>

        <Panel>
          <SectionHeader title="Regular social content" description="Everyday posting, summarized by pattern." className="mb-3" />
          {!regularRows(result).length && <p className="text-sm text-[var(--mos-text-muted)]">Nothing cited in this window.</p>}
          <ul className="space-y-3">{regularRows(result).map(row => <li key={row.key} className="text-sm" data-testid="regular-content">
            <p className="text-[var(--mos-text)]"><span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-xs text-[var(--mos-text-muted)]">{row.label}</span>{row.summary}</p>
            {row.examples.length > 0 && <p className="mt-0.5 text-xs text-[var(--mos-text-faint)]">e.g. {row.examples.join(' · ')}</p>}
            <div className="mt-1"><SourceLinks sources={row.sources} /></div>
          </li>)}</ul>
        </Panel>

        <SectionHeader title="Other activity" />
        <div className="grid gap-4 lg:grid-cols-2">
          {OTHER_CATEGORIES.map(category => {
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
        <SectionHeader title="Instagram and other evidence" description="Paste a public Instagram post link: its caption, date and hashtags are read from the public post page (no login). Or paste caption text, or upload a screenshot (read by a vision model when one is available). A pasted campaign post is the most reliable way to capture a campaign." className="mb-4" />
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
              {!item.hasScreenshot && item.extractedText && <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--mos-text-muted)]">Read from the public post: {item.extractedText}</p>}
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
          <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Started</th><th className="p-3">Trigger</th><th className="p-3">Source</th><th className="p-3">Status</th><th className="p-3">Detail</th></tr></thead>
          <tbody>
            {detail.history.map(run => <tr key={run.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
              <td className="p-3 text-xs">{when(run.createdAt)}</td>
              <td className="p-3 text-xs">{run.trigger}</td>
              <td className="p-3 text-xs">{run.status === 'succeeded' ? <ModeBadge mode={reportMode(run.tregCost)} /> : '—'}</td>
              <td className="p-3 text-xs"><StatusBadge tone={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'danger' : 'info'}>{run.status}</StatusBadge></td>
              <td className="p-3 text-xs">{run.error || run.message}</td>
            </tr>)}
          </tbody>
        </table>
      </DataTableFrame>}
    </>}
  </PageStack>;
}
