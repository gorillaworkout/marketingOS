'use client';

import { useState } from 'react';
import { Button, PageHeader, PageStack } from '@/components/ui/dashboard';
import { SettlementDashboard } from './SettlementDashboard';
import { SettlementNav } from './SettlementNav';
import { todayWib } from './report/labels';
import type { SettlementPreset } from '@/lib/settlement/report';

export function SettlementWorkspace() {
  const [preset, setPreset] = useState<SettlementPreset>('month');
  const [anchor, setAnchor] = useState(todayWib());
  return (
    <PageStack>
      <PageHeader
        eyebrow="Reports"
        title="Settlement Report"
        description="CRM against MT5 reconciliation, processing time, withdrawals, margin in–out, commission and swap. Days run 12:00–12:00 WIB."
        actions={(
          <>
            <Button size="sm" onClick={() => window.open(`/dashboard/settlement-report/print?preset=${preset}&anchor=${anchor}`, '_blank', 'noopener')}>Export PDF</Button>
            <a className="inline-flex h-8 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-accent)] bg-[var(--mos-accent)] px-3 text-xs font-medium text-white" href={`/api/settlement-report/export?preset=${preset}&anchor=${anchor}`}>Export .xlsx</a>
          </>
        )}
      />
      <SettlementNav />
      <SettlementDashboard preset={preset} anchor={anchor} onPreset={setPreset} onAnchor={setAnchor} />
    </PageStack>
  );
}
