'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Period = 'month' | 'quarter' | 'year';
type Summary = { totalTokens: number; totalCost: number; activeUsers: number; avgTokensPerUser: number };
type UserUsage = { rank: number; userId: string; username: string; department: string; totalTokens: number; totalCost: number; taskCount: number; topModel: string | null; topProvider: string | null };
type DepartmentUsage = { department: string; totalTokens: number; totalCost: number; userCount: number; taskCount: number; modelBreakdown: { model: string; tokens: number; cost: number }[] };
type ProviderUsage = { provider: string; accountSource: string; totalTokens: number; totalCost: number; modelBreakdown: { model: string; tokens: number; cost: number }[] };

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });
const money = (value: number) => `$${value.toFixed(4)}`;

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [users, setUsers] = useState<UserUsage[]>([]);
  const [departments, setDepartments] = useState<DepartmentUsage[]>([]);
  const [providers, setProviders] = useState<ProviderUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'cost' | 'tokens'>('cost');

  const load = useCallback(async () => {
    setLoading(true);
    const suffix = `?period=${period}`;
    try {
      const [summaryResult, usersResult, departmentsResult, providersResult] = await Promise.all([
        fetch(`/api/admin/usage/summary${suffix}`),
        fetch(`/api/admin/usage/by-user${suffix}&limit=100`),
        fetch(`/api/admin/usage/by-department${suffix}`),
        fetch(`/api/admin/usage/by-provider${suffix}`),
      ]);
      if (![summaryResult, usersResult, departmentsResult, providersResult].every(result => result.ok)) return;
      const [nextSummary, nextUsers, nextDepartments, nextProviders] = await Promise.all([
        summaryResult.json(), usersResult.json(), departmentsResult.json(), providersResult.json(),
      ]);
      setSummary(nextSummary); setUsers(nextUsers); setDepartments(nextDepartments); setProviders(nextProviders);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const sortedUsers = useMemo(() => [...users].sort((a, b) => sort === 'cost'
    ? b.totalCost - a.totalCost || b.totalTokens - a.totalTokens
    : b.totalTokens - a.totalTokens || b.totalCost - a.totalCost).map((user, index) => ({ ...user, rank: index + 1 })), [users, sort]);

  const exportCsv = () => { window.location.assign(`/api/admin/usage/export?period=${period}`); };
  const cards = [
    ['🪙', 'Total Tokens', number(summary?.totalTokens || 0), 'text-white'],
    ['💵', 'Total Cost', money(summary?.totalCost || 0), 'text-green-400'],
    ['👤', 'Active Users', number(summary?.activeUsers || 0), 'text-white'],
    ['📈', 'Avg Tokens/User', number(summary?.avgTokensPerUser || 0), 'text-white'],
  ];

  return <div className="space-y-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-bold text-white">📊 Usage Analytics</h1><p className="mt-1 text-gray-400">Monitor AI usage, spend, and attribution across MarketingOS.</p></div>
      <div className="flex gap-2">
        <select value={period} onChange={event => setPeriod(event.target.value as Period)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none">
          <option value="month">This month</option><option value="quarter">Last 3 months</option><option value="year">Last 12 months</option>
        </select>
        <button onClick={exportCsv} className="rounded-lg border border-blue-500/40 bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">Export CSV</button>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([icon, label, value, color]) => <div key={label} className="rounded-xl border border-gray-700 bg-gray-800 p-5">
        <div className="mb-3 text-2xl">{icon}</div><div className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</div><div className="mt-1 text-sm text-gray-400">{label}</div>
      </div>)}
    </div>

    <Section title="Top Spenders" action={<button onClick={() => setSort(sort === 'cost' ? 'tokens' : 'cost')} className="text-xs text-blue-400 hover:text-blue-300">Sort: {sort === 'cost' ? 'Cost' : 'Tokens'}</button>}>
      <table className="w-full min-w-[780px] text-sm"><thead className="border-b border-gray-700 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="p-3">Rank</th><th className="p-3">Username</th><th className="p-3">Department</th><th className="p-3 text-right">Tokens</th><th className="p-3 text-right">Cost</th><th className="p-3">Top Model</th><th className="p-3">Top Provider</th><th className="p-3 text-right">Tasks</th></tr></thead>
        <tbody>{sortedUsers.map(user => <tr key={user.userId} className="border-b border-gray-700/60 text-gray-300"><td className="p-3 text-gray-500">#{user.rank}</td><td className="p-3 font-medium text-white">{user.username}</td><td className="p-3">{user.department}</td><td className="p-3 text-right">{number(user.totalTokens)}</td><td className="p-3 text-right text-green-400">{money(user.totalCost)}</td><td className="p-3 text-xs">{user.topModel || '—'}</td><td className="p-3">{user.topProvider || '—'}</td><td className="p-3 text-right">{user.taskCount}</td></tr>)}{!loading && !sortedUsers.length && <Empty colSpan={8} />}</tbody>
      </table>
    </Section>

    <Section title="Department Usage"><table className="w-full min-w-[760px] text-sm"><thead className="border-b border-gray-700 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="p-3">Department</th><th className="p-3 text-right">Users</th><th className="p-3 text-right">Tokens</th><th className="p-3 text-right">Cost</th><th className="p-3">Model breakdown</th><th className="p-3 text-right">% of Total</th></tr></thead>
      <tbody>{departments.map(department => <tr key={department.department} className="border-b border-gray-700/60 text-gray-300"><td className="p-3 font-medium text-white">{department.department}</td><td className="p-3 text-right">{department.userCount}</td><td className="p-3 text-right">{number(department.totalTokens)}</td><td className="p-3 text-right text-green-400">{money(department.totalCost)}</td><td className="p-3 text-xs">{department.modelBreakdown.map(model => `${model.model} (${number(model.tokens)})`).join(', ') || '—'}</td><td className="p-3 text-right">{summary?.totalTokens ? `${((department.totalTokens / summary.totalTokens) * 100).toFixed(1)}%` : '0.0%'}</td></tr>)}{!loading && !departments.length && <Empty colSpan={6} />}</tbody>
    </table></Section>

    <Section title="Provider Attribution"><table className="w-full min-w-[620px] text-sm"><thead className="border-b border-gray-700 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="p-3">Provider</th><th className="p-3">Source</th><th className="p-3 text-right">Tokens</th><th className="p-3 text-right">Cost</th><th className="p-3">Models</th></tr></thead>
      <tbody>{providers.map(provider => <tr key={`${provider.provider}-${provider.accountSource}`} className="border-b border-gray-700/60 text-gray-300"><td className="p-3 font-medium text-white">{provider.provider}</td><td className="p-3">{provider.accountSource === 'personal' ? '👤 Personal' : '🏢 Office'}</td><td className="p-3 text-right">{number(provider.totalTokens)}</td><td className="p-3 text-right text-green-400">{money(provider.totalCost)}</td><td className="p-3 text-xs">{provider.modelBreakdown.map(model => model.model).join(', ') || '—'}</td></tr>)}{!loading && !providers.length && <Empty colSpan={5} />}</tbody>
    </table></Section>
  </div>;
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800"><div className="flex items-center justify-between border-b border-gray-700 px-5 py-4"><h2 className="font-semibold text-white">{title}</h2>{action}</div><div className="overflow-x-auto">{children}</div></section>;
}

function Empty({ colSpan }: { colSpan: number }) { return <tr><td colSpan={colSpan} className="p-8 text-center text-gray-500">No usage data for this period.</td></tr>; }
