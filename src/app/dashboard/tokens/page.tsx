'use client';
import { useEffect, useState } from 'react';
import { DataTableFrame, EmptyState, LoadingState, MetricCard, Panel, PageHeader, PageStack, SectionHeader, StatusBadge } from '@/components/ui/dashboard';

type TokenLog = {
  id: string;
  username: string;
  user_name: string;
  model: string;
  provider: string;
  task_type?: string | null;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  created_at: string;
};

type AccountUsage = {
  username: string;
  user_name: string;
  provider: string;
  total_tokens: number;
  total_cost: number;
  request_count: number;
};

type TokenUsageData = {
  totalTokens: number;
  totalCost: number;
  totalTasks: number;
  accountBreakdown: AccountUsage[];
  logs: TokenLog[];
  error?: string;
};

const providerNames: Record<string, string> = {
  codex: 'Codex CLI',
  'claude-code': 'Claude Code',
  openrouter: 'OpenRouter',
  gorillaworkout: 'GorillaWorkout LLM API',
};

export default function TokensPage() {
  const [data, setData] = useState<TokenUsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard/tokens')
      .then((response) => response.json())
      .then((result: TokenUsageData) => setData(result))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="Loading token usage" />;
  if (data?.error) return <div className="rounded-[var(--mos-radius-panel)] border border-red-500/30 bg-red-500/10 p-4 text-red-300">{data.error}</div>;

  return (
    <PageStack>
      <PageHeader eyebrow="Administration / Usage" title="Token usage" description="Track AI consumption by MarketingOS user and provider." />

      <div className="grid overflow-hidden rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] md:grid-cols-3">
        <MetricCard label="Total tokens" value={(data?.totalTokens || 0).toLocaleString()} note="Recorded consumption" />
        <MetricCard label="Total cost" value={`$${(data?.totalCost || 0).toFixed(6)}`} note="Attributed API cost" />
        <MetricCard label="Tasks generated" value={data?.totalTasks || 0} note="Usage-bearing tasks" />
      </div>

      <Panel>
        <SectionHeader className="mb-4" title="Usage by user account" />
        {data?.accountBreakdown?.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.accountBreakdown.map((account) => (
              <Panel key={`${account.username}-${account.provider}`} padding="compact">
                <div>
                  <div className="font-semibold text-white">{account.username}</div>
                  {account.user_name !== account.username && <div className="text-xs text-[var(--mos-text-muted)]">{account.user_name}</div>}
                </div>
                <StatusBadge className="mt-3">{providerNames[account.provider] || account.provider}</StatusBadge>
                <div className="mt-2 text-xl font-semibold text-white">{account.total_tokens.toLocaleString()} tokens</div>
                <div className="mt-1 flex justify-between text-xs text-[var(--mos-text-muted)]">
                  <span>{account.request_count.toLocaleString()} requests</span>
                  <span>${account.total_cost.toFixed(6)}</span>
                </div>
              </Panel>
            ))}
          </div>
        ) : <EmptyState title="No account usage data yet" />}
      </Panel>

      <DataTableFrame title="Recent usage">
        {data?.logs?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--mos-text-faint)] border-b border-[var(--mos-border)]">
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">User Account</th>
                  <th className="text-left py-2 px-2">Provider</th>
                  <th className="text-left py-2 px-2">Model</th>
                  <th className="text-left py-2 px-2">Task</th>
                  <th className="text-right py-2 px-2">Input</th>
                  <th className="text-right py-2 px-2">Output</th>
                  <th className="text-right py-2 px-2">Cost</th>
                </tr>
              </thead>
              <tbody>{data.logs.map((log) => (
                <tr key={log.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
                  <td className="py-2 px-2 whitespace-nowrap">{new Date(log.created_at).toLocaleDateString()}</td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <div className="font-medium text-white">{log.username}</div>
                    {log.user_name !== log.username && <div className="text-xs text-[var(--mos-text-faint)]">{log.user_name}</div>}
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap">{providerNames[log.provider] || log.provider}</td>
                  <td className="py-2 px-2 text-xs max-w-64 truncate" title={log.model}>{log.model}</td>
                  <td className="py-2 px-2 text-xs whitespace-nowrap">{log.task_type || 'Legacy'}</td>
                  <td className="py-2 px-2 text-right">{log.input_tokens.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right">{log.output_tokens.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right text-green-400">${log.cost.toFixed(8)}</td>
                </tr>
              ))}</tbody>
            </table>
        ) : <EmptyState title="No token usage data yet" />}
      </DataTableFrame>
    </PageStack>
  );
}
