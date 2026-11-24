'use client';

import { useEffect, useState } from 'react';
import { PageHeader, PageStack } from '@/components/ui/dashboard';
import { CsDashboardTab } from './CsDashboardTab';
import { CsDailyInputTab } from './CsDailyInputTab';
import { CsBulkUploadTab } from './CsBulkUploadTab';

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'daily', label: 'Daily Input' },
  { key: 'upload', label: 'Bulk Upload' },
] as const;
type TabKey = typeof TABS[number]['key'];

export function CsReportApp() {
  const [tab, setTab] = useState<TabKey>('dashboard');
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the tab from the URL once after mount
    if (fromUrl && TABS.some(t => t.key === fromUrl)) setTab(fromUrl as TabKey);
  }, []);
  const choose = (key: TabKey) => {
    setTab(key);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', key);
    window.history.replaceState(null, '', url.toString());
  };
  return <PageStack>
    <PageHeader eyebrow="Customer Service" title="CS Report"
      description="Daily work list per CS agent: conversations per channel, categories, follow-ups, questions, leave, and complaint cases. Agents fill Daily Input before going home; old workbooks come in through Bulk Upload." />
    <div role="tablist" aria-label="CS Report sections" className="flex flex-wrap gap-1 border-b border-[var(--mos-border-subtle)]">
      {TABS.map(t => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => choose(t.key)}
        className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${tab === t.key ? 'border-[var(--mos-accent)] text-[var(--mos-text)]' : 'border-transparent text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]'}`}>{t.label}</button>)}
    </div>
    {tab === 'dashboard' && <CsDashboardTab />}
    {tab === 'daily' && <CsDailyInputTab />}
    {tab === 'upload' && <CsBulkUploadTab />}
  </PageStack>;
}
