'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, DataTableFrame, MetricCard, PageHeader, PageStack, Select } from '@/components/ui/dashboard';

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
    ['Total tokens', number(summary?.totalTokens || 0), 'Model consumption'],
    ['Total cost', money(summary?.totalCost || 0), 'Attributed API spend'],
    ['Active users', number(summary?.activeUsers || 0), 'Users in selected period'],
    ['Average tokens / user', number(summary?.avgTokensPerUser || 0), 'Consumption distribution'],
  ];

  return <PageStack>
    <PageHeader eyebrow="Administration / Reporting" title="Usage analytics" description="Monitor AI usage, spend, and attribution across MarketingOS." actions={<>
        <Select value={period} onChange={event => setPeriod(event.target.value as Period)} className="w-auto">
          <option value="month">This month</option><option value="quarter">Last 3 months</option><option value="year">Last 12 months</option>
        </Select>
        <Button variant="primary" onClick={exportCsv}>Export CSV</Button>
      </>} />

    <div className="grid overflow-hidden rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, value, note]) => <MetricCard key={label} label={label} value={loading ? '—' : value} note={note} />)}
    </div>

    <Section title="Top Spenders" action={<button onClick={() => setSort(sort === 'cost' ? 'tokens' : 'cost')} className="text-xs text-blue-400 hover:text-blue-300">Sort: {sort === 'cost' ? 'Cost' : 'Tokens'}</button>}>
      <table className="w-full min-w-[780px] text-sm"><thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Rank</th><th className="p-3">Username</th><th className="p-3">Department</th><th className="p-3 text-right">Tokens</th><th className="p-3 text-right">Cost</th><th className="p-3">Top Model</th><th className="p-3">Top Provider</th><th className="p-3 text-right">Tasks</th></tr></thead>
        <tbody>{sortedUsers.map(user => <tr key={user.userId} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]"><td className="p-3 text-[var(--mos-text-faint)]">#{user.rank}</td><td className="p-3 font-medium text-white">{user.username}</td><td className="p-3">{user.department}</td><td className="p-3 text-right">{number(user.totalTokens)}</td><td className="p-3 text-right text-green-400">{money(user.totalCost)}</td><td className="p-3 text-xs">{user.topModel || '—'}</td><td className="p-3">{user.topProvider || '—'}</td><td className="p-3 text-right">{user.taskCount}</td></tr>)}{!loading && !sortedUsers.length && <Empty colSpan={8} />}</tbody>
      </table>
    </Section>

    <Section title="Department Usage"><table className="w-full min-w-[760px] text-sm"><thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Department</th><th className="p-3 text-right">Users</th><th className="p-3 text-right">Tokens</th><th className="p-3 text-right">Cost</th><th className="p-3">Model breakdown</th><th className="p-3 text-right">% of Total</th></tr></thead>
      <tbody>{departments.map(department => <tr key={department.department} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]"><td className="p-3 font-medium text-white">{department.department}</td><td className="p-3 text-right">{department.userCount}</td><td className="p-3 text-right">{number(department.totalTokens)}</td><td className="p-3 text-right text-green-400">{money(department.totalCost)}</td><td className="p-3 text-xs">{department.modelBreakdown.map(model => `${model.model} (${number(model.tokens)})`).join(', ') || '—'}</td><td className="p-3 text-right">{summary?.totalTokens ? `${((department.totalTokens / summary.totalTokens) * 100).toFixed(1)}%` : '0.0%'}</td></tr>)}{!loading && !departments.length && <Empty colSpan={6} />}</tbody>
    </table></Section>

    <Section title="Provider Attribution"><table className="w-full min-w-[620px] text-sm"><thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Provider</th><th className="p-3">Source</th><th className="p-3 text-right">Tokens</th><th className="p-3 text-right">Cost</th><th className="p-3">Models</th></tr></thead>
      <tbody>{providers.map(provider => <tr key={`${provider.provider}-${provider.accountSource}`} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]"><td className="p-3 font-medium text-white">{provider.provider}</td><td className="p-3">{provider.accountSource === 'personal' ? '👤 Personal' : '🏢 Office'}</td><td className="p-3 text-right">{number(provider.totalTokens)}</td><td className="p-3 text-right text-green-400">{money(provider.totalCost)}</td><td className="p-3 text-xs">{provider.modelBreakdown.map(model => model.model).join(', ') || '—'}</td></tr>)}{!loading && !providers.length && <Empty colSpan={5} />}</tbody>
    </table></Section>
  </PageStack>;
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <DataTableFrame title={title} action={action}>{children}</DataTableFrame>;
}

function Empty({ colSpan }: { colSpan: number }) { return <tr><td colSpan={colSpan} className="p-8 text-center text-[var(--mos-text-faint)]">No usage data for this period.</td></tr>; }
