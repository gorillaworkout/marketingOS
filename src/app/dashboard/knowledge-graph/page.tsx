'use client';

import { useEffect, useMemo, useState } from 'react';
import KnowledgeGraphCanvas from './KnowledgeGraphCanvas';

type GraphNode = { id: string; brief: string; taskType: string; styleCluster: string; platform: string | null; audience: string | null; qualityScore: number; department: string; username: string; createdAt: string };
type GraphEdge = { source: string; target: string; type: string; weight: number };
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
  improving: { label: 'Improving', dot: 'bg-[#55c2b7]', text: 'Approval and rating signals are moving in the right direction.' },
  stable: { label: 'Stable', dot: 'bg-[#739adf]', text: 'Quality signals are holding steady against the prior period.' },
  declining: { label: 'Review needed', dot: 'bg-[#d2778a]', text: 'Recent approval or rating signals have weakened.' },
  'insufficient-data': { label: 'Gathering signal', dot: 'bg-[#d5a85d]', text: 'More approvals and ratings are needed before a trend can be established.' },
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
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/admin/knowledge-graph?limit=350', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Knowledge graph could not be loaded.');
      setData(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Knowledge graph could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filteredNodes = useMemo(() => (data?.nodes || []).filter(node => (department === 'all' || node.department === department) && (taskType === 'all' || node.taskType === taskType)), [data, department, taskType]);
  const ids = useMemo(() => new Set(filteredNodes.map(node => node.id)), [filteredNodes]);
  const filteredEdges = useMemo(() => (data?.edges || []).filter(edge => ids.has(edge.source) && ids.has(edge.target)), [data, ids]);

  if (loading) return <div className="flex min-h-[72vh] items-center justify-center bg-[#08090a]"><div className="h-5 w-5 animate-spin rounded-full border border-[#34343a] border-t-[#8b8cf8]" /></div>;
  if (error || !data) return <div className="border border-white/[.08] bg-[#0f1011] p-6 text-sm text-[#d2778a]">{error}<button onClick={load} className="ml-4 text-[#d0d6e0] underline underline-offset-4">Retry</button></div>;
  const state = health[data.learningHealth.status];

  return <main className="kg-page -m-6 min-h-screen bg-[#08090a] px-6 py-7 text-[#f7f8f8] lg:px-9">
    <div className="mx-auto max-w-[1500px]">
      <header className="flex flex-col gap-5 border-b border-white/[.06] pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="mb-3 font-mono text-[10px] uppercase tracking-[.18em] text-[#62666d]">Organization intelligence / Knowledge</p><h1 className="text-[30px] font-[510] tracking-[-.7px] text-[#f7f8f8]">Knowledge graph</h1><p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#8a8f98]">A current view of what the organization has learned, where it came from, and whether that knowledge is improving output quality.</p></div>
        <div className="flex items-center gap-3"><p className="hidden text-xs text-[#62666d] sm:block">Updated {new Date(data.generatedAt).toLocaleString('id-ID')}</p><button onClick={load} className="rounded-md border border-white/[.08] bg-white/[.025] px-3.5 py-2 text-xs font-medium text-[#d0d6e0] transition hover:bg-white/[.055]">Refresh</button></div>
      </header>

      <section className="grid border-b border-white/[.06] sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Knowledge" value={data.totals.knowledge} note="approved records" />
        <Stat label="Relationships" value={data.totals.edges} note="stored links" />
        <Stat label="Recent growth" value={data.totals.addedLast30Days} note="last 30 days" />
        <Stat label="Contributors" value={data.totals.contributors} note="people represented" />
        <Stat label="Departments" value={data.totals.departments} note="organization scope" last />
      </section>

      <section className="grid gap-px border-b border-white/[.06] bg-white/[.06] lg:grid-cols-[1.3fr_repeat(4,minmax(130px,.55fr))]">
        <div className="bg-[#0d0e10] p-5"><div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} /><span className="text-sm font-medium text-[#f7f8f8]">{state.label}</span><span className="text-[11px] text-[#62666d]">30-day learning health</span></div><p className="mt-2 max-w-lg text-xs leading-5 text-[#8a8f98]">{state.text} The comparison uses the preceding 30-day period.</p></div>
        <Measure label="Approval rate" value={pct(data.learningHealth.current.approvalRate)} change={pp(data.learningHealth.approvalDelta)} />
        <Measure label="Average rating" value={data.learningHealth.current.averageRating ? data.learningHealth.current.averageRating.toFixed(2) : '—'} change={`${data.learningHealth.ratingDelta > 0 ? '+' : ''}${data.learningHealth.ratingDelta.toFixed(2)}`} />
        <Measure label="Feedback coverage" value={pct(data.learningHealth.current.feedbackCoverage)} />
        <Measure label="Generated" value={String(data.learningHealth.current.generated)} />
      </section>

      <section className="mt-7 overflow-hidden rounded-xl border border-white/[.08] bg-[#0f1011] shadow-[0_24px_80px_rgba(0,0,0,.32)]">
        <div className="flex flex-col gap-4 border-b border-white/[.06] px-5 py-4 md:flex-row md:items-center md:justify-between"><div><h2 className="text-sm font-[510] text-[#f7f8f8]">Organization map</h2><p className="mt-1 text-xs text-[#62666d]">Connections between approved knowledge records, grouped by department.</p></div><div className="flex gap-2"><Filter value={department} onChange={setDepartment} label="All departments" options={data.departments.map(item => item.name)} /><Filter value={taskType} onChange={setTaskType} label="All knowledge types" options={data.taskTypes.map(item => item.name)} /></div></div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_310px]">
          <div className="min-w-0 border-white/[.06] lg:border-r">{filteredNodes.length ? <KnowledgeGraphCanvas nodes={filteredNodes} edges={filteredEdges} selectedId={selected?.id} onSelect={setSelected} /> : <div className="flex h-[590px] items-center justify-center text-sm text-[#62666d]">No records match these filters.</div>}</div>
          <aside className="bg-[#0d0e10]">
            <div className="border-b border-white/[.06] p-5"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#62666d]">Selected record</p>{selected ? <div className="mt-5 space-y-4"><div><h3 className="line-clamp-3 text-[15px] font-medium leading-6 text-[#f7f8f8]">{selected.brief}</h3><p className="mt-2 text-xs text-[#62666d]">Recorded {new Date(selected.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div><dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-white/[.06] pt-4"><Meta label="Department" value={selected.department} /><Meta label="Contributor" value={selected.username} /><Meta label="Type" value={selected.taskType} /><Meta label="Style" value={selected.styleCluster} /><Meta label="Platform" value={selected.platform || 'Not set'} /><Meta label="Quality" value={selected.qualityScore.toFixed(2)} /></dl></div> : <p className="mt-4 text-sm leading-6 text-[#737780]">Select a node to inspect its source, owner, type, and quality score.</p>}</div>
            <div className="p-5"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#62666d]">Department coverage</p><div className="mt-4 space-y-4">{data.departments.map(item => <div key={item.name}><div className="flex items-baseline justify-between gap-3"><span className="truncate text-xs text-[#d0d6e0]">{item.name}</span><span className="font-mono text-[10px] text-[#62666d]">{item.knowledgeCount} / {item.contributorCount}</span></div><div className="mt-2 h-px bg-white/[.06]"><div className="h-px bg-[#7170ff]" style={{ width: `${Math.max(2, item.knowledgeCount / Math.max(data.totals.knowledge, 1) * 100)}%` }} /></div></div>)}</div><p className="mt-4 text-[10px] leading-4 text-[#51545b]">Values show records and contributors. Empty departments have not produced verified knowledge yet.</p></div>
          </aside>
        </div>
      </section>

      <footer className="mt-5 flex flex-col gap-2 border-t border-white/[.06] pt-5 text-xs leading-5 text-[#62666d] md:flex-row md:justify-between"><p>Only selected or approved outputs become knowledge. Draft volume is excluded.</p><p>More records do not imply better quality. Learning health depends on approvals, ratings, and feedback coverage.</p></footer>
    </div>
  </main>;
}

function Stat({ label, value, note, last = false }: { label: string; value: number; note: string; last?: boolean }) { return <div className={`py-5 pr-5 sm:border-r sm:border-white/[.06] ${last ? 'lg:border-r-0' : ''}`}><p className="text-[11px] text-[#62666d]">{label}</p><p className="mt-2 text-[25px] font-[510] tracking-[-.5px] text-[#f7f8f8]">{value.toLocaleString()}</p><p className="mt-1 text-[10px] text-[#51545b]">{note}</p></div>; }
function Measure({ label, value, change }: { label: string; value: string; change?: string }) { return <div className="bg-[#0d0e10] p-5"><p className="text-[10px] text-[#62666d]">{label}</p><div className="mt-2 flex items-baseline gap-2"><p className="text-xl font-[510] text-[#f7f8f8]">{value}</p>{change && <span className="font-mono text-[10px] text-[#737780]">{change}</span>}</div></div>; }
function Meta({ label, value }: { label: string; value: string }) { return <div><dt className="text-[10px] text-[#51545b]">{label}</dt><dd className="mt-1 truncate text-xs text-[#b5bac4]" title={value}>{value}</dd></div>; }
function Filter({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: string[] }) { return <select value={value} onChange={event => onChange(event.target.value)} className="rounded-md border border-white/[.08] bg-[#151619] px-3 py-2 text-[11px] text-[#b5bac4] outline-none transition focus:border-[#7170ff]/60"><option value="all">{label}</option>{options.map(option => <option key={option}>{option}</option>)}</select>; }
