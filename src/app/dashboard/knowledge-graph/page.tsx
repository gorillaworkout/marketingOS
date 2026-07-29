'use client';

import { useEffect, useMemo, useState } from 'react';

type GraphNode = {
  id: string;
  brief: string;
  taskType: string;
  styleCluster: string;
  platform: string | null;
  audience: string | null;
  qualityScore: number;
  department: string;
  username: string;
  createdAt: string;
};
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

const departmentColors = ['#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#fb7185', '#60a5fa'];
const statusConfig = {
  improving: { label: 'Improving', color: 'text-emerald-300', bg: 'bg-emerald-500/15 border-emerald-500/30', detail: 'Sinyal approval atau rating meningkat.' },
  stable: { label: 'Stable', color: 'text-blue-300', bg: 'bg-blue-500/15 border-blue-500/30', detail: 'Kualitas relatif stabil dibanding 30 hari sebelumnya.' },
  declining: { label: 'Needs attention', color: 'text-red-300', bg: 'bg-red-500/15 border-red-500/30', detail: 'Approval atau rating mengalami penurunan.' },
  'insufficient-data': { label: 'Insufficient data', color: 'text-amber-300', bg: 'bg-amber-500/15 border-amber-500/30', detail: 'Belum cukup feedback untuk membuktikan sistem makin pintar.' },
};

function percent(value: number) { return `${Math.round(value * 100)}%`; }
function delta(value: number, points = false) {
  const display = points ? `${Math.abs(value * 100).toFixed(1)} pp` : Math.abs(value).toFixed(2);
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${display}`;
}

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
      if (!response.ok) throw new Error(payload.error || 'Gagal memuat knowledge graph');
      setData(payload);
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal memuat knowledge graph'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filteredNodes = useMemo(() => (data?.nodes || []).filter(node =>
    (department === 'all' || node.department === department) &&
    (taskType === 'all' || node.taskType === taskType)
  ), [data, department, taskType]);
  const filteredIds = useMemo(() => new Set(filteredNodes.map(node => node.id)), [filteredNodes]);
  const filteredEdges = useMemo(() => (data?.edges || []).filter(edge => filteredIds.has(edge.source) && filteredIds.has(edge.target)), [data, filteredIds]);
  const positions = useMemo(() => {
    const groups = new Map<string, GraphNode[]>();
    filteredNodes.forEach(node => groups.set(node.department, [...(groups.get(node.department) || []), node]));
    const output = new Map<string, { x: number; y: number; color: string }>();
    const departments = [...groups.keys()];
    departments.forEach((name, departmentIndex) => {
      const angle = (departmentIndex / Math.max(departments.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const centerX = 500 + Math.cos(angle) * Math.min(270, departments.length * 55);
      const centerY = 280 + Math.sin(angle) * Math.min(150, departments.length * 35);
      const nodes = groups.get(name) || [];
      nodes.forEach((node, index) => {
        const nodeAngle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
        const radius = Math.min(105, 28 + nodes.length * 4);
        output.set(node.id, { x: centerX + Math.cos(nodeAngle) * radius, y: centerY + Math.sin(nodeAngle) * radius, color: departmentColors[departmentIndex % departmentColors.length] });
      });
    });
    return output;
  }, [filteredNodes]);

  if (loading) return <div className="flex min-h-[70vh] items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-b-2 border-cyan-400" /></div>;
  if (error || !data) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-300">{error || 'Data tidak tersedia'} <button onClick={load} className="ml-3 underline">Coba lagi</button></div>;
  const status = statusConfig[data.learningHealth.status];

  return <div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-400">Admin Intelligence</p><h1 className="mt-1 text-3xl font-bold text-white">Knowledge Graph</h1><p className="mt-2 max-w-3xl text-sm text-gray-400">Peta pengetahuan lintas department, kontribusi manusia, dan bukti apakah MarketingOS benar-benar belajar.</p></div>
      <button onClick={load} className="rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700">Refresh data</button>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {[
        ['Knowledge nodes', data.totals.knowledge, 'Approved selections'],
        ['Relationships', data.totals.edges, 'Graph connections'],
        ['Added 30 days', data.totals.addedLast30Days, 'Knowledge growth'],
        ['Contributors', data.totals.contributors, 'People teaching AI'],
        ['Departments', data.totals.departments, 'Organization scope'],
      ].map(([label, value, note]) => <div key={String(label)} className="rounded-xl border border-gray-700 bg-gray-800/60 p-4"><p className="text-xs uppercase tracking-wide text-gray-500">{label}</p><p className="mt-2 text-3xl font-semibold text-white">{value}</p><p className="mt-1 text-xs text-gray-500">{note}</p></div>)}
    </div>

    <section className={`rounded-2xl border p-5 ${status.bg}`}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-xs uppercase tracking-[0.2em] text-gray-400">Learning Health · latest 30 days</p><div className="mt-2 flex items-center gap-3"><span className={`text-2xl font-bold ${status.color}`}>{status.label}</span><span className="rounded-full bg-black/20 px-2 py-1 text-xs text-gray-300">vs previous 30 days</span></div><p className="mt-2 text-sm text-gray-300">{status.detail} {data.learningHealth.note}</p></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Approval rate" value={percent(data.learningHealth.current.approvalRate)} change={delta(data.learningHealth.approvalDelta, true)} />
          <Metric label="Average rating" value={data.learningHealth.current.averageRating ? data.learningHealth.current.averageRating.toFixed(2) : '—'} change={delta(data.learningHealth.ratingDelta)} />
          <Metric label="Feedback coverage" value={percent(data.learningHealth.current.feedbackCoverage)} />
          <Metric label="Generated" value={String(data.learningHealth.current.generated)} />
        </div>
      </div>
    </section>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="overflow-hidden rounded-2xl border border-gray-700 bg-[#0b1220]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 p-4">
          <div><h2 className="font-semibold text-white">Organization Graph</h2><p className="text-xs text-gray-500">Klik node untuk melihat provenance. Garis menunjukkan relationship yang tersimpan.</p></div>
          <div className="flex gap-2"><select value={department} onChange={event => setDepartment(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-300"><option value="all">All departments</option>{data.departments.map(item => <option key={item.name}>{item.name}</option>)}</select><select value={taskType} onChange={event => setTaskType(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-300"><option value="all">All knowledge types</option>{data.taskTypes.map(item => <option key={item.name}>{item.name}</option>)}</select></div>
        </div>
        {filteredNodes.length ? <div className="overflow-x-auto"><svg viewBox="0 0 1000 560" className="min-h-[520px] min-w-[900px] w-full">
          <g opacity="0.34">{filteredEdges.map((edge, index) => { const source = positions.get(edge.source); const target = positions.get(edge.target); return source && target ? <line key={`${edge.source}-${edge.target}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="#64748b" strokeWidth={Math.max(0.7, Math.min(3, edge.weight * 2))} /> : null; })}</g>
          {filteredNodes.map(node => { const position = positions.get(node.id)!; const active = selected?.id === node.id; return <g key={node.id} onClick={() => setSelected(node)} className="cursor-pointer"><circle cx={position.x} cy={position.y} r={active ? 11 : 7} fill={position.color} stroke={active ? '#fff' : '#0f172a'} strokeWidth={active ? 3 : 1.5} /><title>{node.department} · {node.taskType} · {node.brief}</title></g>; })}
        </svg></div> : <div className="p-16 text-center text-gray-500">Belum ada node untuk filter ini.</div>}
        <div className="flex flex-wrap gap-3 border-t border-gray-800 p-4">{data.departments.map((item, index) => <div key={item.name} className="flex items-center gap-2 text-xs text-gray-400"><span className="h-2.5 w-2.5 rounded-full" style={{ background: departmentColors[index % departmentColors.length] }} />{item.name} ({item.knowledgeCount})</div>)}</div>
      </section>

      <aside className="space-y-5">
        <section className="rounded-2xl border border-gray-700 bg-gray-800/60 p-5"><h2 className="font-semibold text-white">Node details</h2>{selected ? <div className="mt-4 space-y-3 text-sm"><Detail label="Department" value={selected.department} /><Detail label="Contributor" value={selected.username} /><Detail label="Knowledge type" value={selected.taskType} /><Detail label="Style" value={selected.styleCluster} /><Detail label="Platform" value={selected.platform || '—'} /><Detail label="Quality score" value={selected.qualityScore.toFixed(2)} /><div><p className="text-xs text-gray-500">Approved content brief</p><p className="mt-1 rounded-lg bg-gray-900/60 p-3 text-gray-300">{selected.brief}</p></div><Detail label="Created" value={new Date(selected.createdAt).toLocaleString('id-ID')} /></div> : <p className="mt-4 text-sm text-gray-500">Pilih node pada graph untuk memeriksa sumber dan konteksnya.</p>}</section>
        <section className="rounded-2xl border border-gray-700 bg-gray-800/60 p-5"><h2 className="font-semibold text-white">Department coverage</h2><div className="mt-4 space-y-3">{data.departments.length ? data.departments.map(item => <div key={item.name}><div className="flex justify-between text-xs"><span className="text-gray-300">{item.name}</span><span className="text-gray-500">{item.knowledgeCount} nodes · {item.contributorCount} contributors</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-700"><div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(3, item.knowledgeCount / Math.max(data.totals.knowledge, 1) * 100)}%` }} /></div></div>) : <p className="text-sm text-gray-500">Belum ada knowledge.</p>}</div></section>
      </aside>
    </div>

    <section className="rounded-2xl border border-gray-700 bg-gray-800/50 p-5"><h2 className="font-semibold text-white">Interpretasi yang jujur</h2><ul className="mt-3 grid gap-2 text-sm text-gray-400 md:grid-cols-2"><li>• Node bertambah hanya saat output benar-benar dipilih/disetujui, bukan setiap draft.</li><li>• Banyak node bukan bukti sistem pintar; lihat approval, rating, dan feedback coverage.</li><li>• “Insufficient data” adalah status valid jika user belum memberi rating/approval yang cukup.</li><li>• Department tanpa node berarti belum ada pembelajaran terverifikasi dari department tersebut.</li></ul></section>
  </div>;
}

function Metric({ label, value, change }: { label: string; value: string; change?: string }) { return <div className="min-w-28 rounded-xl bg-black/20 p-3"><p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 text-xl font-semibold text-white">{value}</p>{change && <p className="text-xs text-gray-400">{change}</p>}</div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-gray-500">{label}</p><p className="mt-0.5 text-gray-200">{value}</p></div>; }
