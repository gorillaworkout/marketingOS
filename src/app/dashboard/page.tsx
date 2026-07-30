'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DataTableFrame, EmptyState, LoadingState, MetricCard, PageHeader, PageStack, Panel, SectionHeader, StatusBadge } from '@/components/ui/dashboard';

interface DashboardStats {
  totalTasks: number;
  tasksByType: { type: string; count: number }[];
  totalTokens: number;
  totalCost: number;
  recentTasks: { id: string; title: string; type: string; status: string; created_at: string }[];
}

const typeLabels: Record<string, string> = {
  'social-post': 'Social media post',
  'video-script': 'Video script',
  'event-plan': 'Event plan',
  'article-market-news': 'Market news article',
  'market-research': 'Market research',
};

const quickActions = [
  { href: '/dashboard/social-post', index: '01', title: 'Social post', description: 'Develop captions and image directions for social channels.' },
  { href: '/dashboard/video-script', index: '02', title: 'Video script', description: 'Build structured short-form scripts from a campaign brief.' },
  { href: '/dashboard/event-plan', index: '03', title: 'Event plan', description: 'Research and prepare event proposals with budget controls.' },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard/stats').then(response => response.json()).then(data => {
      setStats(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <LoadingState label="Loading workspace" />;

  return (
    <PageStack>
      <PageHeader
        eyebrow="Workspace overview"
        title="Dashboard"
        description="Monitor production activity, usage, and recent work across MarketingOS."
      />

      <Panel padding="none">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total tasks" value={stats?.totalTasks || 0} note="All generation workflows" />
          <MetricCard label="Tokens used" value={stats?.totalTokens?.toLocaleString() || 0} note="Recorded model consumption" />
          <MetricCard label="Total cost" value={`$${stats?.totalCost?.toFixed(4) || '0.0000'}`} note="Attributed API cost" />
          <MetricCard label="Team members" value="5" note="Current workspace access" />
        </div>
      </Panel>

      <section>
        <SectionHeader title="Start new work" description="Choose a production workflow. Your brief and generated output remain within that workflow." />
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {quickActions.map(action => (
            <Link key={action.href} href={action.href} className="group rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5 transition hover:border-[var(--mos-border-strong)] hover:bg-[var(--mos-raised)]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-[var(--mos-text-faint)]">{action.index}</span>
                <span className="text-[var(--mos-text-faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--mos-accent-soft)]">→</span>
              </div>
              <h3 className="mt-8 text-sm font-[560] text-[var(--mos-text)]">{action.title}</h3>
              <p className="mt-1.5 text-xs leading-5 text-[var(--mos-text-muted)]">{action.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
        <Panel>
          <SectionHeader title="Production mix" description="Completed and in-progress tasks by workflow." />
          <div className="mt-5 divide-y divide-[var(--mos-border-subtle)]">
            {stats?.tasksByType?.map(item => (
              <div key={item.type} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <span className="text-xs text-[var(--mos-text-secondary)]">{typeLabels[item.type] || item.type}</span>
                <span className="font-mono text-xs text-[var(--mos-text-muted)]">{item.count}</span>
              </div>
            ))}
            {!stats?.tasksByType?.length && <EmptyState title="No tasks yet" description="Your workflow distribution will appear after the first generation." className="min-h-40" />}
          </div>
        </Panel>

        <DataTableFrame title="Recent tasks" description="Latest activity across production workflows.">
          {stats?.recentTasks?.length ? (
            <div className="divide-y divide-[var(--mos-border-subtle)]">
              {stats.recentTasks.map(task => (
                <div key={task.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[var(--mos-text-secondary)]">{task.title}</p>
                    <p className="mt-1 text-[11px] text-[var(--mos-text-faint)]">{typeLabels[task.type] || task.type} · {new Date(task.created_at).toLocaleDateString('id-ID')}</p>
                  </div>
                  <StatusBadge tone={task.status === 'completed' ? 'success' : 'warning'} dot>{task.status}</StatusBadge>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No recent tasks" description="Generated content will be listed here." />}
        </DataTableFrame>
      </div>
    </PageStack>
  );
}
