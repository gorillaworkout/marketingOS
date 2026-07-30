'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, LoadingState, MetricCard, PageHeader, PageStack, Panel, Select, StatusBadge, Toolbar } from '@/components/ui/dashboard';
import KnowledgeGraphCanvas from './KnowledgeGraphCanvas';

type GraphNode = { id: string; brief: string; taskType: string; styleCluster: string; platform: string | null; audience: string | null; qualityScore: number; department: string; username: string; createdAt: string };
type GraphEdge = { source: string; target: string; type: string; weight: number; sourceType: 'stored' | 'derived' };
type WindowMetrics = { generated: number; approved: number; rated: number; approvalRate: number; feedbackCoverage: number; averageRating: number };
type GraphData = {
  generatedAt: string;
  totals: { knowledge: number; edges: number; addedLast30Days: number; contributors: number; departments: number };
  learningHealth: { status: 'improving' | 'stable' | 'declining' | 'insufficient-data'; current: WindowMetrics; previous: WindowMetrics; approvalDelta: number; ratingDelta: number; note: string };
  departments: { name: string; knowledgeCount: number; contributorCount: number }[];
  taskTypes: { name: string; count: number }[];
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const health = {
  improving: { label: 'Improving', tone: 'success' as const, text: 'Approval and rating signals are moving in the right direction.' },
  stable: { label: 'Stable', tone: 'info' as const, text: 'Quality signals are holding steady against the prior period.' },
  declining: { label: 'Review needed', tone: 'danger' as const, text: 'Recent approval or rating signals have weakened.' },
  'insufficient-data': { label: 'Gathering signal', tone: 'warning' as const, text: 'More approvals and ratings are needed before a trend can be established.' },
};
const pct = (value: number) => `${Math.round(value * 100)}%`;
const pp = (value: number) => `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`;

export default function AdminKnowledgeGraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [department, setDepartment] = useState('all');
  const [taskType, setTaskType] = useState('all');
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/knowledge-graph?limit=350', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Knowledge graph could not be loaded.');
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Knowledge graph could not be loaded.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredNodes = useMemo(() => (data?.nodes || []).filter(node => (department === 'all' || node.department === department) && (taskType === 'all' || node.taskType === taskType)), [data, department, taskType]);
  const ids = useMemo(() => new Set(filteredNodes.map(node => node.id)), [filteredNodes]);
  const filteredEdges = useMemo(() => (data?.edges || []).filter(edge => ids.has(edge.source) && ids.has(edge.target)), [data, ids]);
  const edgeCounts = useMemo(() => ({
    stored: filteredEdges.filter(edge => edge.sourceType === 'stored').length,
    derived: filteredEdges.filter(edge => edge.sourceType === 'derived').length,
  }), [filteredEdges]);
  const selectedConnections = useMemo(() => selected ? filteredEdges.filter(edge => edge.source === selected.id || edge.target === selected.id) : [], [filteredEdges, selected]);

  if (loading) return <LoadingState label="Loading organization graph" />;
  if (error || !data) return <Panel className="text-sm text-red-300">{error}<Button className="ml-4" onClick={load}>Retry</Button></Panel>;
  const state = health[data.learningHealth.status];

  return (
    <PageStack className="max-w-[1500px]">
      <PageHeader
        eyebrow="Organization intelligence / Knowledge"
        title="Knowledge graph"
        description="A current view of what the organization has learned, where it came from, and whether that knowledge is improving output quality."
        actions={<><span className="hidden text-[11px] text-[var(--mos-text-faint)] sm:block">Updated {new Date(data.generatedAt).toLocaleString('id-ID')}</span><Button onClick={load}>Refresh</Button></>}
      />

      <Panel padding="none">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Knowledge" value={data.totals.knowledge.toLocaleString()} note="Approved records" />
          <MetricCard label="Stored relationships" value={data.totals.edges.toLocaleString()} note="Persisted connections" />
          <MetricCard label="Recent growth" value={data.totals.addedLast30Days.toLocaleString()} note="Last 30 days" />
          <MetricCard label="Contributors" value={data.totals.contributors.toLocaleString()} note="People represented" />
          <MetricCard label="Departments" value={data.totals.departments.toLocaleString()} note="Organization scope" />
        </div>
      </Panel>

      <Panel padding="none">
        <div className="grid lg:grid-cols-[1.3fr_repeat(4,minmax(130px,.55fr))]">
          <div className="p-5">
            <div className="flex items-center gap-2"><StatusBadge tone={state.tone} dot>{state.label}</StatusBadge><span className="text-[11px] text-[var(--mos-text-faint)]">30-day learning health</span></div>
            <p className="mt-2 max-w-lg text-xs leading-5 text-[var(--mos-text-muted)]">{state.text} The comparison uses the preceding 30-day period.</p>
          </div>
          <Measure label="Approval rate" value={pct(data.learningHealth.current.approvalRate)} change={pp(data.learningHealth.approvalDelta)} />
          <Measure label="Average rating" value={data.learningHealth.current.averageRating ? data.learningHealth.current.averageRating.toFixed(2) : '—'} change={`${data.learningHealth.ratingDelta > 0 ? '+' : ''}${data.learningHealth.ratingDelta.toFixed(2)}`} />
          <Measure label="Feedback coverage" value={pct(data.learningHealth.current.feedbackCoverage)} />
          <Measure label="Generated" value={String(data.learningHealth.current.generated)} />
        </div>
      </Panel>

      <Panel padding="none">
        <Toolbar className="rounded-none border-x-0 border-t-0 bg-transparent">
          <div>
            <h2 className="text-sm font-medium text-[var(--mos-text)]">Organization map</h2>
            <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Solid lines are stored relationships; dashed lines are metadata-derived view connections.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Filter by department" value={department} onChange={event => setDepartment(event.target.value)} className="w-auto">
              <option value="all">All departments</option>{data.departments.map(item => <option key={item.name}>{item.name}</option>)}
            </Select>
            <Select aria-label="Filter by knowledge type" value={taskType} onChange={event => setTaskType(event.target.value)} className="w-auto">
              <option value="all">All knowledge types</option>{data.taskTypes.map(item => <option key={item.name}>{item.name}</option>)}
            </Select>
          </div>
        </Toolbar>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 border-[var(--mos-border-subtle)] lg:border-r">
            {filteredNodes.length ? <KnowledgeGraphCanvas nodes={filteredNodes} edges={filteredEdges} selectedId={selected?.id} onSelect={setSelected} /> : <EmptyState title="No matching records" description="Adjust the department or knowledge type filter." className="h-[590px]" />}
          </div>
          <aside className="bg-[var(--mos-bg)]/35">
            <div className="border-b border-[var(--mos-border-subtle)] p-5">
              <p className="text-[10px] font-medium uppercase tracking-[.12em] text-[var(--mos-text-faint)]">Selected record</p>
              {selected ? <div className="mt-5 space-y-4">
                <div><h3 className="line-clamp-3 text-sm font-medium leading-6 text-[var(--mos-text)]">{selected.brief}</h3><p className="mt-2 text-xs text-[var(--mos-text-faint)]">Recorded {new Date(selected.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
                <dl className="grid grid-cols-2 gap-4 border-t border-[var(--mos-border-subtle)] pt-4">
                  <Meta label="Department" value={selected.department} /><Meta label="Contributor" value={selected.username} /><Meta label="Type" value={selected.taskType} /><Meta label="Style" value={selected.styleCluster} /><Meta label="Platform" value={selected.platform || 'Not set'} /><Meta label="Quality" value={selected.qualityScore.toFixed(2)} />
                </dl>
                <div className="border-t border-[var(--mos-border-subtle)] pt-4">
                  <p className="text-[10px] text-[var(--mos-text-faint)]">Connection provenance</p>
                  <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{selectedConnections.filter(edge => edge.sourceType === 'stored').length} stored · {selectedConnections.filter(edge => edge.sourceType === 'derived').length} derived</p>
                </div>
              </div> : <p className="mt-4 text-sm leading-6 text-[var(--mos-text-muted)]">Select a node to inspect its source, owner, type, quality score, and connection provenance.</p>}
            </div>
            <div className="p-5">
              <p className="text-[10px] font-medium uppercase tracking-[.12em] text-[var(--mos-text-faint)]">Visible connections</p>
              <div className="mt-3 flex gap-2"><StatusBadge>{edgeCounts.stored} stored</StatusBadge><StatusBadge tone="info">{edgeCounts.derived} derived</StatusBadge></div>
              <p className="mt-3 text-[11px] leading-5 text-[var(--mos-text-faint)]">Derived connections are deterministic, view-only links based on shared department, task type, platform, or style. They are not stored knowledge edges.</p>
            </div>
          </aside>
        </div>
      </Panel>

      <footer className="flex flex-col gap-2 border-t border-[var(--mos-border-subtle)] pt-5 text-xs leading-5 text-[var(--mos-text-faint)] md:flex-row md:justify-between"><p>Only selected or approved outputs become knowledge. Draft volume is excluded.</p><p>More records do not imply better quality. Learning health depends on approvals, ratings, and feedback coverage.</p></footer>
    </PageStack>
  );
}

function Measure({ label, value, change }: { label: string; value: string; change?: string }) {
  return <div className="border-l border-[var(--mos-border-subtle)] p-5"><p className="text-[10px] text-[var(--mos-text-faint)]">{label}</p><div className="mt-2 flex items-baseline gap-2"><p className="text-xl font-[560] text-[var(--mos-text)]">{value}</p>{change && <span className="font-mono text-[10px] text-[var(--mos-text-muted)]">{change}</span>}</div></div>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[10px] text-[var(--mos-text-faint)]">{label}</dt><dd className="mt-1 truncate text-xs text-[var(--mos-text-secondary)]" title={value}>{value}</dd></div>;
}
