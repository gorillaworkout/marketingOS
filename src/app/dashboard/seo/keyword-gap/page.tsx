'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FormField, LoadingState, PageHeader, PageStack, Panel, Select, StatusBadge, TextArea, TextInput,
} from '@/components/ui/dashboard';
import { fetchJson, useSeoSites } from '@/components/seo/useSeoSites';
import { defaultAuditUrl } from '@/lib/seo/audit-url';
import { FREE_METHODOLOGY, GAP_BUCKETS, type GapBucket, type GapKeyword } from '@/lib/seo/keyword-gap-bucket';
import { gscSourceMessage } from '@/lib/seo/keyword-gap-input';

type GapSummary = {
  id: string; our_domain: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; progress: number; message: string;
  keyword_count: number | null; summary: string | null; summary_error: string | null; error: string | null; provider: string;
  created_at: string; result: { keywords: GapKeyword[]; counts: Record<string, number>; methodology: string; source: string; storedQueries: number; ranked: boolean; notes: string[] } | null;
};
type Source = { domain: string; storedRows: number; using: 'stored' | 'upload'; gscProperty: string | null; active: boolean };
type GscSite = { name: string; siteUrl: string; gscProperty: string | null; storedRows: number };
type SortKey = 'keyword' | 'bucket' | 'ourPosition' | 'ourImpressions' | 'ourClicks';

const LABELS: Record<GapBucket, string> = { missing: 'Missing', weak: 'Weak', almost: 'Almost', shared: 'Shared', strength: 'Strength' };

function showNumber(value: number | null): string {
  return value === null ? '—' : String(Math.round(value * 10) / 10);
}

export default function KeywordGapPage() {
  const { data, error: sitesError, loading } = useSeoSites();
  const [domain, setDomain] = useState<string | null>(null);
  const [competitors, setCompetitors] = useState('');
  const [language, setLanguage] = useState('id');
  const [market, setMarket] = useState('Indonesia');
  const [provider, setProvider] = useState('free');
  const [file, setFile] = useState<File | null>(null);
  const [providers, setProviders] = useState({ semrush: false, dataforseo: false });
  const [source, setSource] = useState<Source | null>(null);
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [gaps, setGaps] = useState<GapSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [gap, setGap] = useState<GapSummary | null>(null);
  const [bucket, setBucket] = useState<'all' | GapBucket>('all');
  const [sortKey, setSortKey] = useState<SortKey>('keyword');
  const [sortAsc, setSortAsc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const shownDomain = domain ?? (data ? defaultAuditUrl(data.sites) : '');

  const loadList = async (nextDomain: string) => {
    const { ok, data: body } = await fetchJson<{ gaps: GapSummary[]; providers: { semrush: boolean; dataforseo: boolean }; source: Source | null; gscSites?: GscSite[] }>(`/api/seo/keyword-gap?domain=${encodeURIComponent(nextDomain)}`);
    if (!ok) return;
    setGaps(body.gaps);
    setProviders(body.providers);
    setSource(body.source);
    setGscSites(body.gscSites ?? []);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { if (shownDomain) void loadList(shownDomain); }, 0);
    return () => window.clearTimeout(timer);
  }, [shownDomain]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    let timer = 0;
    const pull = async () => {
      const { ok, data: body } = await fetchJson<{ gap: GapSummary }>(`/api/seo/keyword-gap/${encodeURIComponent(selectedId)}`);
      if (cancelled || !ok) return;
      setGap(body.gap);
      if (body.gap.status === 'queued' || body.gap.status === 'running') timer = window.setTimeout(() => { void pull(); }, 2000);
    };
    timer = window.setTimeout(() => { void pull(); }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [selectedId]);

  const start = async () => {
    setBusy(true); setMessage('');
    try {
      const form = new FormData();
      form.set('ourDomain', shownDomain);
      form.set('competitors', competitors);
      form.set('language', language);
      form.set('market', market);
      form.set('provider', provider);
      if (file) form.set('queries', file);
      const { ok, data: body } = await fetchJson<{ id: string }>('/api/seo/keyword-gap', { method: 'POST', body: form });
      if (!ok) { setMessage(body.error || 'Could not start the keyword gap.'); return; }
      setSelectedId(body.id);
      setMessage('Keyword gap started.');
      await loadList(shownDomain);
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => {
    const keywords = gap?.result?.keywords ?? [];
    const filtered = bucket === 'all' ? keywords : keywords.filter(keyword => keyword.bucket === bucket);
    const direction = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = sortKey === 'keyword' || sortKey === 'bucket' ? a[sortKey] : a[sortKey] ?? -1;
      const right = sortKey === 'keyword' || sortKey === 'bucket' ? b[sortKey] : b[sortKey] ?? -1;
      return left < right ? -direction : left > right ? direction : 0;
    });
  }, [gap, bucket, sortKey, sortAsc]);

  if (loading) return <LoadingState label="Loading Keyword Gap" />;
  const counts = gap?.result?.counts ?? {};
  const running = gap?.status === 'queued' || gap?.status === 'running';
  const providerBlocked = (provider === 'semrush' && !providers.semrush) || (provider === 'dataforseo' && !providers.dataforseo);
  const sourceMessage = gscSourceMessage({
    domain: shownDomain || 'dupoin.co.id',
    gscProperty: source?.gscProperty ?? null,
    storedRows: source?.storedRows ?? 0,
    connectedSites: gscSites,
  });

  const sort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(value => !value);
    else { setSortKey(key); setSortAsc(true); }
  };

  return <PageStack>
    <PageHeader eyebrow="SEO OS / Keyword Gap" title="Keyword Gap" description="Beta. Compare our Search Console queries with competitor topics, or use a ranking provider when a key is saved." actions={<StatusBadge tone="warning">Beta</StatusBadge>} />
    {(sitesError || message) && <Panel><p className="text-sm text-[var(--mos-text-secondary)]">{sitesError || message}</p></Panel>}

    <Panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-[var(--mos-text)]">Free mode methodology</h2>
        <span title={FREE_METHODOLOGY} className="cursor-help text-xs text-[var(--mos-accent-soft)]">Methodology</span>
      </div>
      <p className="text-sm text-[var(--mos-text-secondary)]">{FREE_METHODOLOGY}</p>
      <p className="mt-3 text-sm text-[var(--mos-text)]" data-testid="keyword-gap-gsc-source">{sourceMessage}</p>
    </Panel>

    <Panel>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Our domain" hint="Defaults to dupoin.co.id when that site is configured.">
          <TextInput value={shownDomain} onChange={event => setDomain(event.target.value)} spellCheck={false} />
        </FormField>
        <FormField label="Market">
          <TextInput value={market} onChange={event => setMarket(event.target.value)} maxLength={80} />
        </FormField>
        <FormField label="Competitor domains" hint="1 to 5, one per line">
          <TextArea rows={4} value={competitors} onChange={event => setCompetitors(event.target.value)} placeholder="competitor.com" />
        </FormField>
        <div className="grid gap-3">
          <FormField label="Language">
            <Select value={language} onChange={event => setLanguage(event.target.value)}>
              <option value="id">Bahasa Indonesia</option>
              <option value="en">English</option>
            </Select>
          </FormField>
          <FormField label="Provider">
            <Select value={provider} onChange={event => setProvider(event.target.value)}>
              <option value="free">Free</option>
              <option value="semrush">Semrush{providers.semrush ? '' : ' (Not configured)'}</option>
              <option value="dataforseo">DataForSEO{providers.dataforseo ? '' : ' (Not configured)'}</option>
            </Select>
          </FormField>
          <FormField label="Queries export" hint="Fallback when no stored Search Console rows exist. CSV or XLSX.">
            <input aria-label="Queries export" type="file" accept=".csv,.xlsx,text/csv" onChange={event => setFile(event.target.files?.[0] ?? null)} />
          </FormField>
        </div>
      </div>
      {providerBlocked && <p className="mt-3 text-sm text-amber-200">Not configured. An admin can save this provider key in SEO settings. No ranking numbers are invented.</p>}
      <div className="mt-4"><Button variant="primary" disabled={busy || providerBlocked || !shownDomain.trim() || !competitors.trim()} onClick={start}>{busy ? 'Starting…' : 'Run keyword gap'}</Button></div>
    </Panel>

    {gap && <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--mos-text)]">{gap.our_domain}</h2>
          <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{gap.message}</p>
        </div>
        <StatusBadge tone={gap.status === 'succeeded' ? 'success' : gap.status === 'failed' ? 'danger' : 'info'} dot>{gap.status}</StatusBadge>
      </div>
      {running && <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[var(--mos-accent)]" style={{ width: `${gap.progress}%` }} /></div>}
      {gap.error && <p className="mt-3 text-sm text-red-300">{gap.error}</p>}
    </Panel>}

    {gap?.summary && <Panel><h2 className="mb-2 text-sm font-medium text-[var(--mos-text)]">Top opportunities</h2><p className="whitespace-pre-wrap text-sm leading-6 text-[var(--mos-text-secondary)]">{gap.summary}</p></Panel>}
    {gap?.summary_error && <Panel><p className="text-sm text-amber-200">Summary unavailable: {gap.summary_error}</p></Panel>}

    {gap?.result && <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={bucket === 'all' ? 'primary' : 'secondary'} onClick={() => setBucket('all')}>All ({gap.result.keywords.length})</Button>
        {GAP_BUCKETS.map(name => <Button key={name} size="sm" variant={bucket === name ? 'primary' : 'secondary'} onClick={() => setBucket(name)}>{LABELS[name]} ({counts[name] ?? 0})</Button>)}
      </div>
      <DataTableFrame title="Keywords" description={gap.result.ranked ? 'Positions come from the ranking provider.' : 'Competitor position and volume are not measured in Free mode.'} action={<span className="flex gap-2">
        <a className="text-xs text-[var(--mos-accent-soft)] hover:underline" href={`/api/seo/keyword-gap/${gap.id}/export?format=csv`}>CSV</a>
        <a className="text-xs text-[var(--mos-accent-soft)] hover:underline" href={`/api/seo/keyword-gap/${gap.id}/export?format=xlsx`}>xlsx</a>
      </span>}>
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
            <tr>
              {([['keyword', 'Keyword'], ['bucket', 'Bucket'], ['ourPosition', 'Our position'], ['ourClicks', 'Clicks'], ['ourImpressions', 'Impressions']] as Array<[SortKey, string]>).map(([key, label]) => (
                <th key={key} className="p-3"><button type="button" className="hover:underline" onClick={() => sort(key)}>{label}</button></th>
              ))}
              <th className="p-3">Competitor position</th><th className="p-3">Volume</th><th className="p-3">Intent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(keyword => <tr key={`${keyword.keyword}-${keyword.bucket}`} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
              <td className="p-3 text-xs">{keyword.keyword}</td>
              <td className="p-3 text-xs">{LABELS[keyword.bucket]}</td>
              <td className="p-3">{showNumber(keyword.ourPosition)}</td>
              <td className="p-3">{showNumber(keyword.ourClicks)}</td>
              <td className="p-3">{showNumber(keyword.ourImpressions)}</td>
              <td className="p-3">{showNumber(keyword.competitorPosition)}</td>
              <td className="p-3">{showNumber(keyword.volume)}</td>
              <td className="p-3 text-xs">{keyword.intent ?? '—'}</td>
            </tr>)}
          </tbody>
        </table>
      </DataTableFrame>
    </>}

    <DataTableFrame title="Past runs">
      {!gaps.length && <EmptyState title="No keyword gaps yet" description="Run a gap to store the first report." />}
      {gaps.length > 0 && <table className="w-full min-w-[680px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">When</th><th className="p-3">Domain</th><th className="p-3">Provider</th><th className="p-3">Status</th><th className="p-3 text-right">Keywords</th><th className="p-3"></th></tr></thead>
        <tbody>
          {gaps.map(item => <tr key={item.id} className="border-b border-[var(--mos-border)]">
            <td className="p-3 text-xs">{new Date(item.created_at).toLocaleString('en-GB')}</td>
            <td className="p-3 text-xs">{item.our_domain}</td>
            <td className="p-3 text-xs">{item.provider}</td>
            <td className="p-3 text-xs">{item.status}</td>
            <td className="p-3 text-right">{item.keyword_count ?? '—'}</td>
            <td className="p-3 text-right"><Button size="sm" onClick={() => setSelectedId(item.id)}>Open</Button></td>
          </tr>)}
        </tbody>
      </table>}
    </DataTableFrame>
  </PageStack>;
}
