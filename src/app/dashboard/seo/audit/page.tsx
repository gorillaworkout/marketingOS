'use client';

import { useEffect, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FormField, LoadingState, MetricCard, PageHeader, PageStack, Panel, StatusBadge, TextInput,
} from '@/components/ui/dashboard';
import { fetchJson, useSeoSites } from '@/components/seo/useSeoSites';
import { defaultAuditUrl } from '@/lib/seo/audit-url';
import type { AuditIssue, AuditResult, IssueSeverity } from '@/lib/seo/audit-types';

type AuditSummary = {
  id: string; start_url: string; site_name: string | null; status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number; message: string; health_score: number | null; summary: string | null; summary_error: string | null;
  error: string | null; created_by_name: string | null; created_at: string; result: AuditResult | null;
};

const GROUPS: Array<{ severity: IssueSeverity; label: string }> = [
  { severity: 'error', label: 'Errors' },
  { severity: 'warning', label: 'Warnings' },
  { severity: 'notice', label: 'Notices' },
];

function metric(value: number | null, unit = 'ms'): string {
  if (value === null) return '—';
  return unit === 'cls' ? value.toFixed(3) : `${Math.round(value)}${unit === 'ms' ? ' ms' : ''}`;
}

export default function WebsiteAuditPage() {
  const { data, error: sitesError, loading } = useSeoSites();
  const [url, setUrl] = useState<string | null>(null);
  const [maxPages, setMaxPages] = useState('100');
  const [audits, setAudits] = useState<AuditSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const shownUrl = url ?? (data ? defaultAuditUrl(data.sites) : '');

  const loadList = async () => {
    const { ok, data: body } = await fetchJson<{ audits: AuditSummary[] }>('/api/seo/audit');
    if (ok) setAudits(body.audits);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadList(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    let timer = 0;
    const pull = async () => {
      const { ok, data: body } = await fetchJson<{ audit: AuditSummary }>(`/api/seo/audit/${encodeURIComponent(selectedId)}`);
      if (cancelled || !ok) return;
      setAudit(body.audit);
      if (body.audit.status === 'queued' || body.audit.status === 'running') timer = window.setTimeout(() => { void pull(); }, 2000);
    };
    timer = window.setTimeout(() => { void pull(); }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [selectedId]);

  const start = async () => {
    setBusy(true); setMessage('');
    try {
      const { ok, status, data: body } = await fetchJson<{ id: string }>('/api/seo/audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: shownUrl, maxPages: Number(maxPages) }),
      });
      if (!ok) { setMessage(body.error || 'Could not start the audit.'); return; }
      setSelectedId(body.id);
      setMessage(status === 202 ? 'Audit started.' : '');
      await loadList();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading Website Audit" />;

  const result = audit?.result ?? null;
  const running = audit?.status === 'queued' || audit?.status === 'running';

  return <PageStack>
    <PageHeader eyebrow="SEO OS / Website Audit" title="Website Audit" description="Crawl one public site, score technical issues, and check Core Web Vitals for the homepage and a few top pages." />
    {(sitesError || message) && <Panel><p className={`text-sm ${message.startsWith('Could') || message.startsWith('An ') ? 'text-red-300' : 'text-[var(--mos-text-secondary)]'}`}>{sitesError || message}</p></Panel>}

    <Panel>
      <div className="grid gap-3 md:grid-cols-[1fr_140px_auto] md:items-end">
        <FormField label="Site URL" hint="Defaults to dupoin.co.id when that site is configured.">
          <TextInput value={shownUrl} onChange={event => setUrl(event.target.value)} placeholder="https://dupoin.co.id/" spellCheck={false} />
        </FormField>
        <FormField label="Max pages" hint="1–200">
          <TextInput value={maxPages} onChange={event => setMaxPages(event.target.value)} inputMode="numeric" />
        </FormField>
        <Button variant="primary" disabled={busy || !shownUrl.trim()} onClick={start}>{busy ? 'Starting…' : 'Run audit'}</Button>
      </div>
    </Panel>

    {audit && <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--mos-text)]">{audit.start_url}</h2>
          <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{audit.message} · {new Date(audit.created_at).toLocaleString('en-GB')}</p>
        </div>
        <StatusBadge tone={audit.status === 'succeeded' ? 'success' : audit.status === 'failed' ? 'danger' : 'info'} dot>{audit.status}</StatusBadge>
      </div>
      {running && <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[var(--mos-accent)]" style={{ width: `${audit.progress}%` }} /></div>}
      {audit.error && <p className="mt-3 text-sm text-red-300">{audit.error}</p>}
    </Panel>}

    {result && <>
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Site Health" value={result.healthScore} note="Notices do not change the score." />
        <MetricCard label="Pages crawled" value={result.limits.crawled} note={`Limit ${result.limits.maxPages}`} />
        <MetricCard label="PageSpeed" value={result.psiKeyUsed ? 'Key configured' : 'Public quota'} note="Homepage plus the shallowest pages." />
      </div>

      {audit?.summary && <Panel><h2 className="mb-2 text-sm font-medium text-[var(--mos-text)]">Prioritized fixes</h2><p className="whitespace-pre-wrap text-sm leading-6 text-[var(--mos-text-secondary)]">{audit.summary}</p></Panel>}
      {audit?.summary_error && <Panel><p className="text-sm text-amber-200">Summary unavailable: {audit.summary_error}</p></Panel>}

      <div className="grid gap-3 md:grid-cols-2">
        <Panel>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-[var(--mos-text)]">{result.indexing.gsc.title}</h2>
            <StatusBadge tone="warning">Not connected</StatusBadge>
          </div>
          <p className="text-sm text-[var(--mos-text-secondary)]">{result.indexing.gsc.needed}</p>
        </Panel>
        <Panel>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-[var(--mos-text)]">{result.indexing.ga4.title}</h2>
            <StatusBadge tone="warning">Not connected</StatusBadge>
          </div>
          <p className="text-sm text-[var(--mos-text-secondary)]">{result.indexing.ga4.needed}</p>
        </Panel>
      </div>

      {GROUPS.map(group => {
        const issues = result.issues.filter(issue => issue.severity === group.severity);
        return <IssueList key={group.severity} label={group.label} issues={issues} />;
      })}

      {result.indexing.rows.length > 0 && <DataTableFrame title="Indexing signals from the crawl" description="These come from the crawl only. Search Console coverage is not connected.">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">URL</th><th className="p-3">Signals</th></tr></thead>
          <tbody>
            {result.indexing.rows.slice(0, 40).map(row => <tr key={row.url} className="border-b border-[var(--mos-border)]"><td className="p-3 text-xs">{row.url}</td><td className="p-3 text-xs text-[var(--mos-text-muted)]">{row.reasons.join(', ')}</td></tr>)}
          </tbody>
        </table>
      </DataTableFrame>}

      <DataTableFrame title="Core Web Vitals" description="Lab data is from PageSpeed Insights. Field data appears only when Chrome UX Report has a sample.">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
            <tr><th className="p-3">URL</th><th className="p-3">Device</th><th className="p-3">Score</th><th className="p-3">LCP</th><th className="p-3">INP</th><th className="p-3">CLS</th><th className="p-3">FCP</th><th className="p-3">TTFB</th><th className="p-3">Field</th></tr>
          </thead>
          <tbody>
            {result.psi.map(row => <tr key={`${row.url}-${row.strategy}`} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
              <td className="max-w-[240px] truncate p-3 text-xs">{row.url}</td>
              <td className="p-3 text-xs">{row.strategy}</td>
              <td className="p-3">{row.performanceScore ?? '—'}</td>
              <td className="p-3 text-xs">{metric(row.lab?.lcp ?? null)}</td>
              <td className="p-3 text-xs">{metric(row.lab?.inp ?? null)}</td>
              <td className="p-3 text-xs">{metric(row.lab?.cls ?? null, 'cls')}</td>
              <td className="p-3 text-xs">{metric(row.lab?.fcp ?? null)}</td>
              <td className="p-3 text-xs">{metric(row.lab?.ttfb ?? null)}</td>
              <td className="p-3 text-xs">{row.error ? row.error : row.field ? (row.field.category || 'CrUX') : 'No field data'}</td>
            </tr>)}
          </tbody>
        </table>
      </DataTableFrame>

      <DataTableFrame title="Crawled pages" description="Same-host pages fetched for this run." action={<span className="flex gap-2">
        <a className="text-xs text-[var(--mos-accent-soft)] hover:underline" href={`/api/seo/audit/${audit?.id}/export?format=csv`}>CSV</a>
        <a className="text-xs text-[var(--mos-accent-soft)] hover:underline" href={`/api/seo/audit/${audit?.id}/export?format=xlsx`}>xlsx</a>
      </span>}>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
            <tr><th className="p-3">URL</th><th className="p-3">Status</th><th className="p-3">Title</th><th className="p-3 text-right">Words</th><th className="p-3 text-right">Depth</th><th className="p-3 text-right">Issues</th></tr>
          </thead>
          <tbody>
            {result.pages.map(page => <tr key={page.url} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
              <td className="max-w-[280px] truncate p-3 text-xs">{page.url}</td>
              <td className="p-3">{page.status || '—'}</td>
              <td className="max-w-[220px] truncate p-3 text-xs">{page.title || '—'}</td>
              <td className="p-3 text-right">{page.wordCount}</td>
              <td className="p-3 text-right">{page.depth}</td>
              <td className="p-3 text-right">{page.issueCount}</td>
            </tr>)}
          </tbody>
        </table>
      </DataTableFrame>
    </>}

    <DataTableFrame title="Past audits" description="A new run is stored here. Refresh the row to see progress.">
      {!audits.length && <EmptyState title="No audits yet" description="Run an audit to store the first report." />}
      {audits.length > 0 && <table className="w-full min-w-[680px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
          <tr><th className="p-3">When</th><th className="p-3">URL</th><th className="p-3">Status</th><th className="p-3 text-right">Score</th><th className="p-3"></th></tr>
        </thead>
        <tbody>
          {audits.map(item => <tr key={item.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
            <td className="p-3 text-xs">{new Date(item.created_at).toLocaleString('en-GB')}</td>
            <td className="max-w-[280px] truncate p-3 text-xs">{item.start_url}</td>
            <td className="p-3 text-xs">{item.status}</td>
            <td className="p-3 text-right">{item.health_score ?? '—'}</td>
            <td className="p-3 text-right"><Button size="sm" onClick={() => setSelectedId(item.id)}>Open</Button></td>
          </tr>)}
        </tbody>
      </table>}
    </DataTableFrame>
  </PageStack>;
}

function IssueList({ label, issues }: { label: string; issues: AuditIssue[] }) {
  if (!issues.length) return null;
  return <DataTableFrame title={label} description={`${issues.length} ${issues.length === 1 ? 'group' : 'groups'}`}>
    <ul className="space-y-3 p-3">
      {issues.map(issue => <li key={issue.code}>
        <p className="text-sm text-[var(--mos-text)]">{issue.title} <span className="text-[var(--mos-text-faint)]">({issue.urls.length})</span></p>
        <p className="text-xs text-[var(--mos-text-muted)]">{issue.detail}</p>
        <p className="mt-1 truncate text-xs text-[var(--mos-text-faint)]">{issue.urls.slice(0, 4).join(' · ')}</p>
      </li>)}
    </ul>
  </DataTableFrame>;
}
