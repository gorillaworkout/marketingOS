'use client';
import { useEffect, useState } from 'react';

interface DashboardStats {
  totalTasks: number;
  tasksByType: { type: string; count: number }[];
  totalTokens: number;
  totalCost: number;
  recentTasks: { id: string; title: string; type: string; status: string; created_at: string }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard/stats').then(res => res.json()).then(data => {
      setStats(data);
      setLoading(false);
    });
  }, []);

  const typeIcons: Record<string, string> = {
    'social-post': '📱',
    'video-script': '🎬',
    'event-plan': '📋',
  };
  const typeLabels: Record<string, string> = {
    'social-post': 'Social Media Post',
    'video-script': 'Video Script',
    'event-plan': 'Event Plan',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 mt-1">Welcome to MarketingOS — your AI marketing suite</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <div className="text-3xl mb-2">📋</div>
          <div className="text-2xl font-bold text-white">{stats?.totalTasks || 0}</div>
          <div className="text-sm text-gray-400">Total Tasks</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <div className="text-3xl mb-2">🤖</div>
          <div className="text-2xl font-bold text-white">{stats?.totalTokens?.toLocaleString() || 0}</div>
          <div className="text-sm text-gray-400">Tokens Used</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <div className="text-3xl mb-2">💰</div>
          <div className="text-2xl font-bold text-white">${stats?.totalCost?.toFixed(4) || '0.0000'}</div>
          <div className="text-sm text-gray-400">Total Cost</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <div className="text-3xl mb-2">👥</div>
          <div className="text-2xl font-bold text-white">5</div>
          <div className="text-sm text-gray-400">Team Members</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a href="/dashboard/social-post" className="bg-gradient-to-br from-purple-600/20 to-blue-600/20 rounded-xl p-6 border border-purple-500/20 hover:border-purple-500/40 transition-all group">
          <div className="text-4xl mb-3">📱</div>
          <h3 className="text-lg font-semibold text-white group-hover:text-purple-400 transition-colors">Social Media Post</h3>
          <p className="text-sm text-gray-400 mt-1">Generate captions & images for social media</p>
        </a>
        <a href="/dashboard/video-script" className="bg-gradient-to-br from-green-600/20 to-emerald-600/20 rounded-xl p-6 border border-green-500/20 hover:border-green-500/40 transition-all group">
          <div className="text-4xl mb-3">🎬</div>
          <h3 className="text-lg font-semibold text-white group-hover:text-green-400 transition-colors">Video Script</h3>
          <p className="text-sm text-gray-400 mt-1">Create engaging video scripts for Reels/TikTok</p>
        </a>
        <a href="/dashboard/event-plan" className="bg-gradient-to-br from-orange-600/20 to-red-600/20 rounded-xl p-6 border border-orange-500/20 hover:border-orange-500/40 transition-all group">
          <div className="text-4xl mb-3">📋</div>
          <h3 className="text-lg font-semibold text-white group-hover:text-orange-400 transition-colors">Event Plan</h3>
          <p className="text-sm text-gray-400 mt-1">Plan events with AI-powered research & proposals</p>
        </a>
      </div>

      {/* Tasks by Type */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <h3 className="text-lg font-semibold text-white mb-4">Tasks by Type</h3>
          <div className="space-y-3">
            {stats?.tasksByType?.map((t: any) => (
              <div key={t.type} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>{typeIcons[t.type] || '📄'}</span>
                  <span className="text-gray-300 text-sm">{typeLabels[t.type] || t.type}</span>
                </div>
                <span className="text-white font-semibold">{t.count}</span>
              </div>
            ))}
            {(!stats?.tasksByType || stats.tasksByType.length === 0) && (
              <p className="text-gray-500 text-sm">No tasks yet</p>
            )}
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <h3 className="text-lg font-semibold text-white mb-4">Recent Tasks</h3>
          <div className="space-y-3">
            {stats?.recentTasks?.map((task: any) => (
              <div key={task.id} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <span>{typeIcons[task.type] || '📄'}</span>
                  <span className="text-gray-300 text-sm truncate max-w-[200px]">{task.title}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  task.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {task.status}
                </span>
              </div>
            ))}
            {(!stats?.recentTasks || stats.recentTasks.length === 0) && (
              <p className="text-gray-500 text-sm">No recent tasks</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}