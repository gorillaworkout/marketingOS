'use client';
import { useEffect, useState } from 'react';

export default function TokensPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard/tokens').then(r => r.json()).then(d => { setData(d); setLoading(false); });
  }, []);

  if (loading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>;

  return (
    <div className="space-y-8">
      <div><h1 className="text-2xl font-bold text-white">💰 Token Usage</h1><p className="text-gray-400 mt-1">Track AI token consumption and costs</p></div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <div className="text-3xl mb-2">📊</div>
          <div className="text-2xl font-bold text-white">{(data?.totalTokens || 0).toLocaleString()}</div>
          <div className="text-sm text-gray-400">Total Tokens</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <div className="text-3xl mb-2">💰</div>
          <div className="text-2xl font-bold text-green-400">${(data?.totalCost || 0).toFixed(6)}</div>
          <div className="text-sm text-gray-400">Total Cost</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <div className="text-3xl mb-2">🤖</div>
          <div className="text-2xl font-bold text-white">{data?.totalTasks || 0}</div>
          <div className="text-sm text-gray-400">Tasks Generated</div>
        </div>
      </div>

      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
        <h3 className="text-lg font-semibold text-white mb-4">📋 Recent Usage</h3>
        {data?.logs?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-gray-500 border-b border-gray-700/50">
                <th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">Model</th>
                <th className="text-right py-2 px-2">Input</th><th className="text-right py-2 px-2">Output</th>
                <th className="text-right py-2 px-2">Cost</th>
              </tr></thead>
              <tbody>{data.logs.map((log: any) => (
                <tr key={log.id} className="border-b border-gray-800/50 text-gray-300">
                  <td className="py-2 px-2">{new Date(log.created_at).toLocaleDateString()}</td>
                  <td className="py-2 px-2 text-xs">{log.model}</td>
                  <td className="py-2 px-2 text-right">{log.input_tokens?.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right">{log.output_tokens?.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right text-green-400">${(log.cost || 0).toFixed(8)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="text-gray-500">No token usage data yet</p>}
      </div>
    </div>
  );
}