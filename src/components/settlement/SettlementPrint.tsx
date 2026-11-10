'use client';

import { useEffect, useState } from 'react';
import type { ReconciliationResponse, SettlementReport } from '@/lib/settlement/report';
import { SettlementReportView } from './report/SettlementReportView';

export function SettlementPrint({ preset, anchor, noprint, generatedAt }: { preset: string; anchor: string; noprint: boolean; generatedAt: string }) {
  const [report, setReport] = useState<SettlementReport | null>(null);
  const [recon, setRecon] = useState<ReconciliationResponse | null>(null);
  const [error, setError] = useState('');
  const date = report?.period.preset === 'day' ? report.period.anchor : anchor;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settlement-report/report?preset=${preset}&anchor=${anchor}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Could not load the report');
        return body.report as SettlementReport;
      })
      .then(value => { if (!cancelled) setReport(value); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load the report'); });
    return () => { cancelled = true; };
  }, [preset, anchor]);

  useEffect(() => {
    if (!report) return undefined;
    const reconDate = report.period.preset === 'day' ? report.period.anchor : anchor;
    let cancelled = false;
    fetch(`/api/settlement-report/reconciliation?date=${reconDate}&list=all&page=1`)
      .then(response => response.json())
      .then(value => { if (!cancelled) setRecon(value as ReconciliationResponse); });
    return () => { cancelled = true; };
  }, [report, anchor]);

  useEffect(() => {
    if (!report || noprint) return undefined;
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [report, noprint]);

  if (error) return <p className="p-8 text-sm">{error}</p>;
  if (!report) return <p className="p-8 text-sm">Loading settlement report…</p>;
  return (
    <div className="print-report mx-auto max-w-[1400px] bg-white p-6 text-[#1A1F24]">
      <SettlementReportView variant="print" report={report} recon={recon} reconDate={date} list="all" generatedAt={generatedAt} />
    </div>
  );
}
