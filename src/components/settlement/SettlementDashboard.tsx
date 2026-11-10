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
  const [pickedDate, setPickedDate] = useState(defaultReconDate());
  const reconDate = preset === 'day' ? anchor : pickedDate;
  const [recon, setRecon] = useState<ReconciliationResponse | null>(null);
  const [list, setList] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settlement-report/report?preset=${preset}&anchor=${anchor}`)
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Could not load the report'); return body.report as SettlementReport; })
      .then(value => { if (!cancelled) { setReport(value); setError(''); } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the report'); });
    return () => { cancelled = true; };
  }, [preset, anchor, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settlement-report/reconciliation?date=${reconDate}&list=${list}&page=${page}`)
      .then(response => response.json())
      .then(value => { if (!cancelled) setRecon(value as ReconciliationResponse); })
      .catch(() => { if (!cancelled) setRecon(null); });
    return () => { cancelled = true; };
  }, [reconDate, list, page, reloadToken]);

  if (error) return <EmptyState title="Could not load the report" description={error} />;
  if (!report) return <LoadingState label="Loading settlement report" />;
  return (
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
  );
}
