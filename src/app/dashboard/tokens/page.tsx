'use client';
import { useEffect, useState } from 'react';
import { LoadingState, MetricCard, PageHeader, PageStack } from '@/components/ui/dashboard';

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
  if (data?.error) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">{data.error}</div>;

  return (
    <PageStack>
      <PageHeader eyebrow="Administration / Usage" title="Token usage" description="Track AI consumption by MarketingOS user and provider." />

      <div className="grid overflow-hidden rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] md:grid-cols-3">
        <MetricCard label="Total tokens" value={(data?.totalTokens || 0).toLocaleString()} note="Recorded consumption" />
        <MetricCard label="Total cost" value={`$${(data?.totalCost || 0).toFixed(6)}`} note="Attributed API cost" />
        <MetricCard label="Tasks generated" value={data?.totalTasks || 0} note="Usage-bearing tasks" />
      </div>

      <section className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
        <h2 className="text-lg font-semibold text-white mb-4">Usage by User Account</h2>
        {data?.accountBreakdown?.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.accountBreakdown.map((account) => (
              <div key={`${account.username}-${account.provider}`} className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
                <div>
                  <div className="font-semibold text-white">{account.username}</div>
                  {account.user_name !== account.username && <div className="text-xs text-gray-400">{account.user_name}</div>}
                </div>
                <div className="mt-3 text-xs text-gray-400">{providerNames[account.provider] || account.provider}</div>
                <div className="mt-2 text-xl font-semibold text-white">{account.total_tokens.toLocaleString()} tokens</div>
                <div className="mt-1 flex justify-between text-xs text-gray-400">
                  <span>{account.request_count.toLocaleString()} requests</span>
                  <span>${account.total_cost.toFixed(6)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-gray-500">No user account usage data yet.</p>}
      </section>

      <section className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
        <h2 className="text-lg font-semibold text-white mb-4">Recent Usage</h2>
        {data?.logs?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700/50">
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
                <tr key={log.id} className="border-b border-gray-800/50 text-gray-300">
                  <td className="py-2 px-2 whitespace-nowrap">{new Date(log.created_at).toLocaleDateString()}</td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <div className="font-medium text-white">{log.username}</div>
                    {log.user_name !== log.username && <div className="text-xs text-gray-500">{log.user_name}</div>}
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
          </div>
        ) : <p className="text-gray-500">No token usage data yet.</p>}
      </section>
    </PageStack>
  );
}
