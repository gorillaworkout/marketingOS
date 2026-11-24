'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, DataTableFrame, EmptyState, FilterGroup, LoadingState, MetricCard, Panel, SectionHeader, Select, StatusBadge, TextInput, Toolbar } from '@/components/ui/dashboard';
import { CATEGORY_FIELDS, CHANNEL_FIELDS, COUNT_FIELDS, STATUS_LABELS } from '@/lib/cs-report/fields';
import { periodRange, todayWib, type PeriodKind } from '@/lib/cs-report/dates';
import type { CsDashboard } from '@/lib/cs-report/metrics';

type Data = CsDashboard & { agentOptions: Array<{ id: string; name: string }> };

const CHANNEL_COLORS = ['#2EB5C4', '#818cf8', '#34d399', '#f59e0b', '#f472b6'];
const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function CsDashboardTab() {
  const [kind, setKind] = useState<PeriodKind>('month');
  const [anchor, setAnchor] = useState(() => todayWib());
  const [customTo, setCustomTo] = useState(() => todayWib());
  const [agentId, setAgentId] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const range = useMemo(() => periodRange(kind, anchor, customTo), [kind, anchor, customTo]);
  const query = useMemo(() => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (agentId) params.set('agentId', agentId);
    return params.toString();
  }, [range, agentId]);

  const apply = useCallback((ok: boolean, status: number, body: Data & { error?: string }) => {
    setLoading(false);
    if (!ok) { setError(body.error || `Could not load the dashboard (${status}).`); return; }
    setError(''); setData(body);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cs-report/dashboard?${query}`, { cache: 'no-store' })
      .then(async r => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }))
      .then(({ ok, status, body }) => { if (!cancelled) apply(ok, status, body); })
      .catch(() => { if (!cancelled) { setLoading(false); setError('Could not load the dashboard.'); } });
    return () => { cancelled = true; };
  }, [query, apply]);

  if (loading && !data) return <LoadingState label="Loading CS dashboard" />;
  const k = data?.kpis;
  const maxDay = Math.max(1, ...(data?.trend ?? []).map(d => d.conversations));
  const maxCat = Math.max(1, ...CATEGORY_FIELDS.map(f => k?.categories[f.key] ?? 0));

  return <div className="flex flex-col gap-6">
    <Toolbar>
      <FilterGroup>
        <Select aria-label="Period" value={kind} onChange={e => setKind(e.target.value as PeriodKind)} className="max-w-[170px]">
          <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="custom">Custom range</option>
        </Select>
        <TextInput type="date" aria-label={kind === 'custom' ? 'From' : 'Date'} value={anchor} onChange={e => e.target.value && setAnchor(e.target.value)} className="max-w-[170px]" />
        {kind === 'custom' && <TextInput type="date" aria-label="To" value={customTo} onChange={e => e.target.value && setCustomTo(e.target.value)} className="max-w-[170px]" />}
        <Select aria-label="Agent" value={agentId} onChange={e => setAgentId(e.target.value)} className="max-w-[240px]">
          <option value="">All agents</option>
          {(data?.agentOptions ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <span className="text-xs text-[var(--mos-text-faint)]">{range.from === range.to ? range.from : `${range.from} to ${range.to}`}</span>
      </FilterGroup>
      <a href={`/api/cs-report/export?${query}`} className="inline-flex h-9 items-center whitespace-nowrap rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 text-sm text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]">Export Excel</a>
    </Toolbar>

    {error && <Panel padding="compact"><p className="text-sm text-red-300">{error}</p></Panel>}

    {data && k && <>
      <Panel padding="none">
        <div className="grid grid-cols-2 md:grid-cols-4">
          <MetricCard label="Total conversations" value={fmt(k.conversations)} note={`${fmt(k.entries)} agent-days, ${k.sickDays} sick, ${k.annualLeaveDays} leave`} />
          <MetricCard label="Not followed up" value={fmt(k.notFollowedUp)} note={k.followUpMinutes.length ? `within ${k.followUpMinutes.join(' / ')} min` : 'no data'} />
          <MetricCard label="Unsolved issues" value={fmt(k.unsolvedIssues)} note={`${fmt(k.unsolvedCompleted)} completed`} />
          <MetricCard label="Complaints" value={fmt(k.complaints.total)} note={`${k.complaints.open} open`} />
        </div>
        <div className="grid grid-cols-2 border-t border-[var(--mos-border-subtle)] md:grid-cols-5">
          {CHANNEL_FIELDS.map(f => <MetricCard key={f.key} label={f.short} value={fmt(k.channels[f.key])} />)}
        </div>
        <div className="grid grid-cols-2 border-t border-[var(--mos-border-subtle)] md:grid-cols-4">
          <MetricCard label="Complaints resolved" value={fmt(k.complaints.resolved)} />
          <MetricCard label="Resolved within SLA" value={fmt(k.complaints.resolvedWithinSla)} note={k.complaints.slaUnknown ? `${k.complaints.slaUnknown} without an SLA flag counted as met` : undefined} />
          <MetricCard label="Closed rate" value={pct(k.complaints.closedRate)} note="resolved / total" />
          <MetricCard label="Open complaints" value={fmt(k.complaints.open)} />
        </div>
      </Panel>

      {!k.entries && !k.complaints.total && <Panel padding="none"><EmptyState title="No CS data in this period" description="Agents fill Daily Input every day; historical workbooks can be imported in Bulk Upload." /></Panel>}

      {data.trend.length > 1 && <Panel>
        <SectionHeader title="Daily trend" description="Conversations per day, stacked by channel." />
        <div className="mt-4 flex h-48 items-end gap-[2px]">
          {data.trend.map(day => <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${day.date}: ${fmt(day.conversations)} conversations${day.agentsOnLeave ? `, ${day.agentsOnLeave} on leave` : ''}`}>
            {CHANNEL_FIELDS.map((f, i) => day.channels[f.key] > 0 && <div key={f.key} style={{ height: `${(day.channels[f.key] / maxDay) * 100}%`, background: CHANNEL_COLORS[i] }} />)}
          </div>)}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-[var(--mos-text-faint)]"><span>{shortDate(data.trend[0].date)}</span><span>{shortDate(data.trend.at(-1)!.date)}</span></div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[var(--mos-text-muted)]">
          {CHANNEL_FIELDS.map((f, i) => <span key={f.key} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: CHANNEL_COLORS[i] }} />{f.short}</span>)}
        </div>
      </Panel>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel>
          <SectionHeader title="Category breakdown" />
          <div className="mt-4 space-y-2.5">
            {CATEGORY_FIELDS.map(f => <div key={f.key} className="grid grid-cols-[170px_1fr_60px] items-center gap-3 text-xs">
              <span className="text-[var(--mos-text-secondary)]">{f.label}</span>
              <span className="h-2 rounded-full bg-white/[0.05]"><span className="block h-2 rounded-full bg-[var(--mos-accent)]" style={{ width: `${((k.categories[f.key] ?? 0) / maxCat) * 100}%` }} /></span>
              <span className="text-right tabular-nums text-[var(--mos-text-secondary)]">{fmt(k.categories[f.key])}</span>
            </div>)}
          </div>
        </Panel>
        <DataTableFrame title="Per agent">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-[var(--mos-border)] text-left text-xs text-[var(--mos-text-faint)]">
              <tr><th className="p-3">Agent</th><th className="p-3 text-right">Present</th><th className="p-3 text-right">Sick</th><th className="p-3 text-right">Leave</th><th className="p-3 text-right">Conversations</th><th className="p-3 text-right">Not followed up</th><th className="p-3 text-right">Complaints</th></tr>
            </thead>
            <tbody>
              {data.agents.map(a => <tr key={a.agentId} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
                <td className="p-3 text-[var(--mos-text)]">{a.agentName}</td><td className="p-3 text-right tabular-nums">{a.present}</td><td className="p-3 text-right tabular-nums">{a.sick}</td>
                <td className="p-3 text-right tabular-nums">{a.annualLeave}</td><td className="p-3 text-right tabular-nums">{fmt(a.conversations)}</td>
                <td className="p-3 text-right tabular-nums">{fmt(a.notFollowedUp)}</td><td className="p-3 text-right tabular-nums">{a.complaints}</td>
              </tr>)}
              {!data.agents.length && <tr><td colSpan={7} className="p-6 text-center text-xs text-[var(--mos-text-faint)]">No entries.</td></tr>}
            </tbody>
          </table>
        </DataTableFrame>
      </div>

      {data.recap.length > 0 && <DataTableFrame title="Weekly Work List" description="Same columns as the Excel. Red = sick, yellow = annual leave. Total rows are recomputed.">
        <div className="max-h-[560px] overflow-y-auto">
          <table className="w-full min-w-[1400px] text-xs">
            <thead className="sticky top-0 border-b border-[var(--mos-border)] bg-[var(--mos-panel)] text-left text-[var(--mos-text-faint)]">
              <tr><th className="p-2">Date</th><th className="p-2">Name</th>{COUNT_FIELDS.map(f => <th key={f.key} className="p-2 text-right">{'short' in f ? f.short : f.label}</th>)}</tr>
            </thead>
            <tbody>
              {data.recap.map(day => [
                ...day.rows.map((row, i) => <tr key={row.id} className="border-b border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]">
                  <td className="whitespace-nowrap p-2">{i === 0 ? day.date : ''}</td>
                  <td className={`whitespace-nowrap p-2 ${row.status === 'sick' ? 'bg-red-400/15 text-red-200' : row.status === 'annual_leave' ? 'bg-amber-300/15 text-amber-100' : ''}`} title={STATUS_LABELS[row.status]}>{row.agentName}</td>
                  {COUNT_FIELDS.map(f => <td key={f.key} className="p-2 text-right tabular-nums">{row[f.key] ?? ''}</td>)}
                </tr>),
                <tr key={`${day.date}-total`} className="border-b border-[var(--mos-border)] bg-white/[0.03] font-medium text-[var(--mos-text)]">
                  <td className="p-2">Total</td><td className="p-2" />
                  {COUNT_FIELDS.map(f => <td key={f.key} className="p-2 text-right tabular-nums">{day.total[f.key]}</td>)}
                </tr>,
              ])}
            </tbody>
          </table>
        </div>
      </DataTableFrame>}

      {data.questions.length > 0 && <DataTableFrame title="Frequent and difficult questions" description="From Daily Input, plus the imported weekly Notes.">
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 border-b border-[var(--mos-border)] bg-[var(--mos-panel)] text-left text-xs text-[var(--mos-text-faint)]">
              <tr><th className="p-3">Date</th><th className="p-3">Agent / channel</th><th className="p-3">Type</th><th className="p-3">Question</th></tr>
            </thead>
            <tbody>
              {data.questions.map((q, i) => <tr key={`${q.date}-${q.who}-${q.kind}-${i}`} className="border-b border-[var(--mos-border)] align-top text-[var(--mos-text-secondary)]">
                <td className="whitespace-nowrap p-3">{q.dateTo ? `${shortDate(q.date)} to ${shortDate(q.dateTo)}` : q.date}</td>
                <td className="p-3">{q.who}</td>
                <td className="p-3"><StatusBadge tone={q.kind === 'difficult' ? 'warning' : 'info'}>{q.kind === 'difficult' ? 'Difficult' : 'Frequent'}</StatusBadge></td>
                <td className="p-3">{q.text}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </DataTableFrame>}

      <DataTableFrame title="Report Complaint" description="Imported cases have no agent and show under All agents.">
        <div className="max-h-[520px] overflow-y-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="sticky top-0 border-b border-[var(--mos-border)] bg-[var(--mos-panel)] text-left text-xs text-[var(--mos-text-faint)]">
              <tr><th className="p-3">Date</th><th className="p-3">Client</th><th className="p-3">UID</th><th className="p-3">Platform</th><th className="p-3">Description</th><th className="p-3">Category</th><th className="p-3">Status</th><th className="p-3">SLA</th><th className="p-3">Completed</th><th className="p-3">Agent</th></tr>
            </thead>
            <tbody>
              {data.complaints.map(c => <tr key={c.id} className="border-b border-[var(--mos-border)] align-top text-[var(--mos-text-secondary)]">
                <td className="whitespace-nowrap p-3">{c.date}</td><td className="p-3">{c.clientName || '—'}</td><td className="p-3 tabular-nums">{c.uid || '—'}</td><td className="p-3">{c.platform || '—'}</td>
                <td className="max-w-[360px] p-3">{c.description}</td><td className="p-3">{c.category || '—'}</td>
                <td className="p-3"><StatusBadge tone={/^(solved|resolved|closed|done|completed)$/i.test(c.status) ? 'success' : 'warning'}>{c.status || '—'}</StatusBadge></td>
                <td className="p-3">{c.slaMet === null ? '—' : c.slaMet ? 'Yes' : 'No'}</td><td className="whitespace-nowrap p-3">{c.completionDate || '—'}</td><td className="p-3">{c.agentName || '—'}</td>
              </tr>)}
              {!data.complaints.length && <tr><td colSpan={10} className="p-6 text-center text-xs text-[var(--mos-text-faint)]">No complaints in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </DataTableFrame>
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setAnchor(todayWib())}>Back to today</Button>
    </>}
  </div>;
}
