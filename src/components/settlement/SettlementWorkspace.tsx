'use client';

import { useState } from 'react';
import { Button, PageHeader, PageStack } from '@/components/ui/dashboard';
import { SettlementDashboard } from './SettlementDashboard';
import { SettlementNav } from './SettlementNav';
import { defaultReconDate, todayWib } from './report/labels';
import type { SettlementPreset } from '@/lib/settlement/report';

export function SettlementWorkspace() {
  const [preset, setPreset] = useState<SettlementPreset>('month');
  const [anchor, setAnchor] = useState(todayWib());
  const [reconDate, setReconDate] = useState(defaultReconDate);
  const query = `preset=${encodeURIComponent(preset)}&anchor=${encodeURIComponent(anchor)}`;
  const reconQuery = `recon=${encodeURIComponent(preset === 'day' ? anchor : reconDate)}`;
  const htmlQuery = `${query}&format=html&${reconQuery}`;
  const docxQuery = `${query}&format=docx&${reconQuery}`;
  return (
    <PageStack>
      <PageHeader
        eyebrow="Reports"
        title="Settlement Report"
        description="CRM against MT5 reconciliation, processing time, withdrawals, margin in–out, commission and swap. Days run 12:00–12:00 WIB."
        actions={(
          <>
            <Button size="sm" className="cursor-pointer transition duration-150 hover:border-[var(--mos-border-strong)] hover:text-[var(--mos-text)] active:bg-white/[0.06]" onClick={() => window.open(`/dashboard/settlement-report/print?preset=${preset}&anchor=${anchor}`, '_blank', 'noopener')}>Export PDF</Button>
            <a className="inline-flex h-8 cursor-pointer items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-panel)] px-3 text-xs font-medium text-[var(--mos-text)] transition duration-150 hover:border-[var(--mos-border-strong)] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)]" href={`/api/settlement-report/export?${htmlQuery}`}>Export HTML</a>
            <a className="inline-flex h-8 cursor-pointer items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-panel)] px-3 text-xs font-medium text-[var(--mos-text)] transition duration-150 hover:border-[var(--mos-border-strong)] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)]" href={`/api/settlement-report/export?${docxQuery}`}>Export Word</a>
            <a className="inline-flex h-8 cursor-pointer items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-accent)] bg-[var(--mos-accent)] px-3 text-xs font-medium text-white transition duration-150 hover:bg-[#2EB5C4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)] active:bg-[#146e78]" href={`/api/settlement-report/export?${query}`}>Export .xlsx</a>
          </>
        )}
      />
      <SettlementNav />
      <SettlementDashboard preset={preset} anchor={anchor} reconDate={reconDate} onPreset={setPreset} onAnchor={setAnchor} onReconDate={setReconDate} />
    </PageStack>
  );
}
