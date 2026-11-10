import { buildKpis } from '@/lib/settlement/kpis';
import type { ReconciliationResponse, SettlementPreset, SettlementReport } from '@/lib/settlement/report';
import { CoverageChips } from './CoverageChips';
import { CommissionSwapSection } from './CommissionSwapSection';
import { FlowChart } from './FlowChart';
import { JisdorSection } from './JisdorSection';
import { KpiStrip } from './KpiStrip';
import { MarginSection } from './MarginSection';
import { MethodologySection } from './MethodologySection';
import { periodTitle } from './labels';
import { ProcessingChart } from './ProcessingChart';
import { ProcessingSection } from './ProcessingSection';
import { ReconciliationSection } from './ReconciliationSection';
import { SectionNav } from './SectionNav';
import { SettlementPeriodBar } from './SettlementPeriodBar';
import { WithdrawalTimingSection } from './WithdrawalTimingSection';

type Fixing = { date: string; rate: number };

export function SettlementReportView({
  variant, report, recon, reconDate, list, generatedAt, jisdor, jisdorUnavailable, onPreset, onShift, onAnchor, onReconDate, onList, onPage,
}: {
  variant: 'screen' | 'print';
  report: SettlementReport;
  recon: ReconciliationResponse | null;
  reconDate: string;
  list: string;
  generatedAt?: string;
  jisdor?: Fixing[];
  jisdorUnavailable?: boolean;
  onPreset?: (preset: SettlementPreset) => void;
  onShift?: (direction: number) => void;
  onAnchor?: (anchor: string) => void;
  onReconDate?: (date: string) => void;
  onList?: (reason: string) => void;
  onPage?: (page: number) => void;
}) {
  const cards = buildKpis(report.summary);
  const mismatches = recon ? recon.mismatchCounts.crm_only + recon.mismatchCounts.mt5_only + recon.mismatchCounts.amount_diff + recon.mismatchCounts.account_diff : 0;
  const flowLabel = `Daily deposits and withdrawals, IDR, ${report.period.range.from} to ${report.period.range.to}`;
  return (
    <div className="flex flex-col gap-5">
      {variant === 'print' && (
        <header className="border-b border-[var(--mos-border-subtle)] pb-4">
          <p className="text-xs tracking-[0.14em] uppercase text-[var(--mos-text-faint)]">Dupoin · Settlement Report</p>
          <h1 className="mt-1 text-2xl font-[560]">{periodTitle(report.period)}</h1>
          <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Generated {generatedAt ?? ''}</p>
          <div className="mt-3"><CoverageChips coverage={report.coverage} rangeEnd={report.period.range.to} commission={report.summary.current.commission} asText /></div>
        </header>
      )}
      {variant === 'screen' && onPreset && onShift && onAnchor && <SettlementPeriodBar period={report.period} previous={report.previousRange} onPreset={onPreset} onShift={onShift} onAnchor={onAnchor} />}
      {variant === 'screen' && <CoverageChips coverage={report.coverage} rangeEnd={report.period.range.to} commission={report.summary.current.commission} />}
      {variant === 'screen' && <SectionNav mismatches={mismatches} pendingDays={report.summary.current.commission?.pendingDays ?? 0} />}
      <KpiStrip cards={cards} daily={report.daily} />
      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <section className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-[var(--mos-text-muted)]"><span className="font-medium text-[var(--mos-text-secondary)]">Daily deposits & withdrawals</span><span>Deposits · Withdrawals · Net</span></div>
          <FlowChart daily={report.daily} label={flowLabel} />
        </section>
        <section className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-[var(--mos-text-muted)]"><span className="font-medium text-[var(--mos-text-secondary)]">Processing time, office hour</span><span>Deposit API · Manual · Withdrawal</span></div>
          <ProcessingChart processing={report.processing} label={`Office-hour processing, ${report.period.range.from} to ${report.period.range.to}`} />
        </section>
      </div>
      <ReconciliationSection date={reconDate} recon={recon} list={list} variant={variant} onDate={onReconDate} onList={onList} onPage={onPage} />
      <ProcessingSection processing={report.processing} variant={variant} />
      <div className="grid gap-5 xl:grid-cols-2">
        <WithdrawalTimingSection weeks={report.withdrawalWeeks} />
        <MarginSection months={report.margin} />
      </div>
      <CommissionSwapSection swap={report.swap} days={report.dealsHistory ?? []} summary={report.summary.current.commission} />
      <div className="grid gap-5 lg:grid-cols-2">
        <JisdorSection key={report.period.anchor.slice(0, 7)} variant={variant} month={report.period.anchor.slice(0, 7)} fixings={jisdor} unavailable={jisdorUnavailable} />
        <MethodologySection />
      </div>
    </div>
  );
}
