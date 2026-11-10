'use client';

import { useEffect, useState } from 'react';
import { EmptyState, LoadingState } from '@/components/ui/dashboard';
import type { ReconciliationResponse, SettlementPreset, SettlementReport } from '@/lib/settlement/report';
import { defaultReconDate, shiftAnchor } from './report/labels';
import { SettlementReportView } from './report/SettlementReportView';

export function SettlementDashboard({ reloadToken = 0, preset, anchor, onPreset, onAnchor }: {
  reloadToken?: number;
  preset: SettlementPreset;
  anchor: string;
  onPreset: (preset: SettlementPreset) => void;
  onAnchor: (anchor: string) => void;
}) {
  const [report, setReport] = useState<SettlementReport | null>(null);
  const [error, setError] = useState('');
  const reportKey = `${preset}|${anchor}|${reloadToken}`;
  const [reportSettled, setReportSettled] = useState<string | null>(null);
  const reportLoading = reportSettled !== reportKey;
  const [pickedDate, setPickedDate] = useState(defaultReconDate());
  const reconDate = preset === 'day' ? anchor : pickedDate;
  const [recon, setRecon] = useState<ReconciliationResponse | null>(null);
  const [list, setList] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    const key = reportKey;
    fetch(`/api/settlement-report/report?preset=${preset}&anchor=${anchor}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Could not load the report'); return body.report as SettlementReport; })
      .then(value => { if (controller.signal.aborted) return; setReport(value); setError(''); setReportSettled(key); })
      .catch(err => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load the report');
        setReportSettled(key);
      });
    return () => controller.abort();
  }, [reportKey, preset, anchor]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/settlement-report/reconciliation?date=${reconDate}&list=${list}&page=${page}`, { signal: controller.signal })
      .then(response => response.json())
      .then(value => { if (!controller.signal.aborted) setRecon(value as ReconciliationResponse); })
      .catch(() => { if (!controller.signal.aborted) setRecon(null); });
    return () => controller.abort();
  }, [reconDate, list, page, reloadToken]);

  if (error && !report) return <EmptyState title="Could not load the report" description={error} />;
  if (!report) return <LoadingState label="Loading settlement report" />;
  return (
    <div aria-busy={reportLoading}>
      {reportLoading && <p role="status" className="text-xs text-[var(--mos-text-muted)]">Updating report…</p>}
      <div className={reportLoading ? 'opacity-70 transition-opacity duration-150' : 'transition-opacity duration-150'}>
    <SettlementReportView
      variant="screen"
      report={report}
      recon={recon}
      reconDate={reconDate}
      list={list}
      onPreset={onPreset}
      onAnchor={onAnchor}
      onShift={direction => onAnchor(shiftAnchor(anchor, preset, direction))}
      onReconDate={date => { if (preset === 'day') onAnchor(date); else setPickedDate(date); setPage(1); }}
      onList={reason => { setList(reason); setPage(1); }}
      onPage={setPage}
    />
      </div>
    </div>
  );
}
