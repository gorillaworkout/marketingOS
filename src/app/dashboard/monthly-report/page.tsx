'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FilterGroup, LoadingState, MetricCard, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextInput, Toolbar,
} from '@/components/ui/dashboard';
import { DUPOIN, formatAmount, formatChange, formatDateTimeWib, formatDecimal, formatInteger, formatPct } from '@/components/monthly-report/brand';
import { FunnelChart, TrendChart } from '@/components/monthly-report/charts';
import { useMonthlyReportPermissions } from '@/components/monthly-report/MonthlyReportContext';
import { InfoTip, ReportTabs } from '@/components/monthly-report/ReportTabs';
import type { BucketValues, OnboardingReport } from '@/lib/monthly-report/metrics';
import {
  GRANULARITIES, PERIOD_PRESETS, PRESET_LABELS, defaultGranularity, formatDayLabel, resolvePeriod, shiftAnchor,
  type Granularity, type PeriodInput, type PeriodPreset,
} from '@/lib/monthly-report/periods';

type UploadInfo = { file_name: string; kind: string; created_at: string; uploaded_by_name: string | null } | null;
type ReportResponse = { report: OnboardingReport; hasAnyData: boolean; lastUpload: UploadInfo };
type DetailKind = 'bank_info_pending' | 'kyc_rejected' | 'pending_video_failed';
type DetailRow = { event_at: string; uid: string | null; trading_account_no: string | null; step: string; step_status: string; account_status: string | null; approval_method: string | null; remarks: string | null };
type TrendMetric = 'registrations' | 'realAccountApproved' | 'kycRejected' | 'ftd';

const TREND_METRICS: Array<[TrendMetric, string]> = [
  ['registrations', 'Registrations'], ['realAccountApproved', 'Real Account Approved'], ['kycRejected', 'KYC Rejected'], ['ftd', 'FTD'],
];
const GRANULARITY_LABELS: Record<Granularity, string> = { day: 'By day', week: 'By week', month: 'By month' };

function todayWib(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function queryString(input: PeriodInput, granularity: Granularity): string {
  const params = new URLSearchParams({ preset: input.preset, granularity });
  if (input.preset === 'custom') { params.set('from', input.from ?? ''); params.set('to', input.to ?? ''); }
  else params.set('anchor', input.anchor ?? todayWib());
  return params.toString();
}

function initialInput(): PeriodInput {
  // Start on the last complete month: monthly reports are read after the month closes.
  const today = todayWib();
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const lastMonth = new Date(`${firstOfMonth}T00:00:00Z`);
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
  return { preset: 'month', anchor: lastMonth.toISOString().slice(0, 10) };
}

export default function MonthlyReportOnboardingPage() {
  const { canUpload } = useMonthlyReportPermissions();
  const [input, setInput] = useState<PeriodInput>(initialInput);
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [customDraft, setCustomDraft] = useState({ from: '', to: '' });
  const [state, setState] = useState<{ key: string; data: ReportResponse | null; error: string } | null>(null);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('registrations');
  const [detail, setDetail] = useState<{ kind: DetailKind; label: string; total: number; rows: DetailRow[] } | null>(null);

  const query = useMemo(() => queryString(input, granularity), [input, granularity]);
  const periodError = useMemo(() => {
    try { resolvePeriod(input); return ''; } catch (error) { return error instanceof Error ? error.message : 'Invalid period'; }
  }, [input]);

  useEffect(() => {
    if (periodError) return;
    let cancelled = false;
    fetch(`/api/monthly-report/report?${query}`).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (cancelled) return;
      setState(response.ok ? { key: query, data, error: '' } : { key: query, data: null, error: data.error || 'Could not load the report' });
    }).catch(() => { if (!cancelled) setState({ key: query, data: null, error: 'Could not load the report' }); });
    return () => { cancelled = true; };
  }, [query, periodError]);

  const loading = !periodError && state?.key !== query;
  const data = state?.data ?? null;
  const report = data?.report ?? null;

  const selectPreset = (preset: PeriodPreset) => {
    const current = (() => { try { return resolvePeriod(input); } catch { return null; } })();
    if (preset === 'custom') {
      const range = current?.range ?? { from: todayWib(), to: todayWib() };
      setCustomDraft(range);
      setInput({ preset: 'custom', from: range.from, to: range.to });
    } else {
      setInput({ preset, anchor: current?.range.from ?? todayWib() });
    }
    setGranularity(defaultGranularity(preset));
  };

  const move = (direction: -1 | 1) => {
    try { setInput(shiftAnchor(input, direction)); } catch { /* invalid period: ignore */ }
  };

  const openDetail = async (kind: DetailKind) => {
    const response = await fetch(`/api/monthly-report/details?kind=${kind}&${query}`);
    const body = await response.json().catch(() => ({}));
    if (response.ok) setDetail(body);
  };

  return (
    <PageStack>
      <PageHeader
        eyebrow="Reports"
        title="Onboarding Reports"
        description="Client onboarding from the CRM export: registrations, KYC, real account activations and first-time deposits. Days are counted in WIB (UTC+7)."
        actions={report && data?.hasAnyData ? (
          <a href={`/api/monthly-report/export?${query}`}><Button variant="primary">Export .xlsx</Button></a>
        ) : undefined}
      />
      <ReportTabs />

      <Toolbar>
        <FilterGroup>
          <div className="flex shrink-0 overflow-hidden rounded-[var(--mos-radius-control)] border border-[var(--mos-border)]" role="group" aria-label="Period">
            {PERIOD_PRESETS.map(preset => (
              <button
                key={preset}
                type="button"
                onClick={() => selectPreset(preset)}
                className="h-9 border-l border-[var(--mos-border)] px-3 text-xs font-medium first:border-l-0"
                style={input.preset === preset ? { background: DUPOIN.teal, color: '#fff' } : undefined}
              >
                <span className={input.preset === preset ? '' : 'text-[var(--mos-text-muted)]'}>{PRESET_LABELS[preset]}</span>
              </button>
            ))}
          </div>
          {input.preset === 'custom' ? (
            <>
              <div className="w-40 shrink-0"><TextInput type="date" aria-label="From" value={customDraft.from} onChange={e => setCustomDraft(d => ({ ...d, from: e.target.value }))} /></div>
              <span className="text-xs text-[var(--mos-text-faint)]">to</span>
              <div className="w-40 shrink-0"><TextInput type="date" aria-label="To" value={customDraft.to} onChange={e => setCustomDraft(d => ({ ...d, to: e.target.value }))} /></div>
              <Button size="sm" onClick={() => setInput({ preset: 'custom', ...customDraft })}>Apply</Button>
            </>
          ) : (
            <div className="w-40 shrink-0"><TextInput type="date" aria-label="Date in period" value={input.anchor ?? ''} onChange={e => e.target.value && setInput({ preset: input.preset, anchor: e.target.value })} /></div>
          )}
          <Button size="sm" variant="ghost" aria-label="Previous period" onClick={() => move(-1)}>← Prev</Button>
          <Button size="sm" variant="ghost" aria-label="Next period" onClick={() => move(1)}>Next →</Button>
        </FilterGroup>
        <div className="w-36 shrink-0">
          <Select aria-label="Group by" value={granularity} onChange={e => setGranularity(e.target.value as Granularity)}>
            {GRANULARITIES.map(g => <option key={g} value={g}>{GRANULARITY_LABELS[g]}</option>)}
          </Select>
        </div>
      </Toolbar>

      {periodError && <Panel padding="compact"><p className="text-sm text-red-300">{periodError}</p></Panel>}
      {state?.error && !loading && <Panel padding="compact"><p className="text-sm text-red-300">{state.error}</p></Panel>}
      {loading && <LoadingState label="Loading report" />}

      {!loading && data && !data.hasAnyData && (
        <Panel>
          <EmptyState
            title="No onboarding data yet"
            description="Upload the CRM onboarding export (Query result sheet) and the monthly FTD report to see this report."
            action={canUpload ? <Link href="/dashboard/monthly-report/uploads"><Button variant="primary">Go to uploads</Button></Link> : <p className="text-xs text-[var(--mos-text-faint)]">Ask an admin or an uploader to add the data.</p>}
          />
        </Panel>
      )}

      {!loading && report && data?.hasAnyData && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mos-text-muted)]">
            <p><span className="font-medium text-[var(--mos-text)]">{report.rangeLabel}</span> · compared with {report.previousLabel}</p>
            {data.lastUpload && <p>Last upload: {data.lastUpload.file_name} · {formatDateTimeWib(data.lastUpload.created_at)}</p>}
          </div>

          {!report.hasOnboardingData && (
            <Panel><EmptyState title="No onboarding entries in this period" description="Try another period, or upload an export that covers these dates." /></Panel>
          )}

          <Panel padding="none">
            <div className="grid grid-cols-2 md:grid-cols-5">
              {report.kpis.map(kpi => (
                <MetricCard
                  key={kpi.key}
                  label={kpi.label}
                  value={kpi.key === 'ftd' && kpi.value === null ? 'No data' : formatInteger(kpi.value)}
                  trend={report.hasPreviousData ? formatChange(kpi.change, kpi.changePct) ?? undefined : 'No previous data'}
                  note={kpi.key === 'registrations' ? 'All onboarding entries, repeats counted' : kpi.note}
                  className={kpi.key === 'ftd' ? 'bg-[rgba(46,181,196,0.06)]' : undefined}
                />
              ))}
            </div>
            <p className="border-t border-[var(--mos-border-subtle)] px-5 py-2.5 text-[11px] text-[var(--mos-text-faint)]">
              Registrations<InfoTip text={report.kpis[0].note} /> = every onboarding entry in the export (all 6 steps; a user rejected and re-registering counts twice).
              Pending = Registrations − Real Account Approved (unique) − KYC Rejected. Change is versus the previous period.
            </p>
          </Panel>

          <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
            <Panel>
              <SectionHeader
                title="Trend"
                description={`${TREND_METRICS.find(m => m[0] === trendMetric)?.[1]} ${GRANULARITY_LABELS[granularity].toLowerCase()}`}
                action={
                  <div className="w-52 shrink-0">
                    <Select aria-label="Trend metric" value={trendMetric} onChange={e => setTrendMetric(e.target.value as TrendMetric)}>
                      {TREND_METRICS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </Select>
                  </div>
                }
              />
              <div className="mt-4 text-[var(--mos-text)]">
                <TrendChart
                  ariaLabel={`${trendMetric} trend`}
                  points={report.buckets.map(bucket => ({ key: bucket.key, label: granularity === 'day' ? formatDayLabel(bucket.from) : bucket.label, value: bucket.values[trendMetric] }))}
                />
              </div>
              {report.peaks.registrations && (
                <p className="mt-2 text-[11px] text-[var(--mos-text-faint)]">
                  Busiest registration day: {formatDayLabel(report.peaks.registrations.date)} ({formatInteger(report.peaks.registrations.value)})
                  {report.peaks.activations && <> · most activations: {formatDayLabel(report.peaks.activations.date)} ({formatInteger(report.peaks.activations.value)})</>}
                </p>
              )}
            </Panel>

            <Panel>
              <SectionHeader title="Funnel" description="Registration → KYC approved → Real account → FTD from those same accounts." />
              <div className="mt-5"><FunnelChart steps={report.funnel} /></div>
              <p className="mt-4 text-[11px] leading-5 text-[var(--mos-text-faint)]">
                KYC approved counts approved manual and auto KYC steps; Real account counts unique activated accounts. The last step only counts FTDs from accounts activated in this period.
              </p>
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <Panel>
              <SectionHeader title="First-time deposits" description="FTD count is the headline. Amount is shown for reference only." />
              {!report.hasFtd ? (
                <EmptyState className="min-h-32" title="No FTD data for this period" description={canUpload ? 'Upload the monthly FTD report on the Uploads tab.' : 'FTD data has not been uploaded for these dates.'} />
              ) : (
                <>
                  <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
                    <div>
                      <p className="text-[11px] text-[var(--mos-text-muted)]">FTD count</p>
                      <p className="text-4xl font-[560] tracking-[-0.04em]" style={{ color: DUPOIN.teal }}>{formatInteger(report.ftd.count)}</p>
                    </div>
                    <Stat label="Daily average" value={formatDecimal(report.ftd.dailyAverage)} />
                    <Stat label="Peak day" value={report.peaks.ftd ? `${formatInteger(report.peaks.ftd.value)} · ${formatDayLabel(report.peaks.ftd.date)}` : '—'} />
                    <Stat label="Micro / Standard" value={`${formatInteger(report.ftd.byType.micro)} / ${formatInteger(report.ftd.byType.standard)}`} />
                  </div>
                  <dl className="mt-5 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                    <Row label="FTD ÷ Real Account Approved" hint="All FTDs in the period divided by unique activations (the monthly deck method)" value={formatPct(report.ftd.ftdPerApprovedPct)} />
                    <Row label="Real → FTD (same accounts)" hint="Accounts activated in the period that also made an FTD" value={formatPct(report.ftd.realToFtdPct)} />
                    <Row label="FTD ÷ Registrations" hint="All FTDs divided by registrations" value={formatPct(report.ftd.ftdPerRegistrationPct)} />
                    <Row label="From accounts activated this period" value={`${formatInteger(report.ftd.fromPeriodActivations)} · earlier accounts ${formatInteger(report.ftd.fromEarlierAccounts)}`} />
                  </dl>
                  <p className="mt-4 border-t border-[var(--mos-border-subtle)] pt-3 text-[11px] text-[var(--mos-text-faint)]">
                    Amount (as in the FTD report): total {formatAmount(report.ftd.amountTotal)} · average {formatAmount(report.ftd.amountAverage)} per FTD
                  </p>
                </>
              )}
            </Panel>

            <Panel>
              <SectionHeader title="Real Account Approved — breakdown" description="Activations by type, and the KYC steps behind them. KYC counts are steps, not accounts." />
              <dl className="mt-4 space-y-2.5 text-xs">
                {report.breakdown.map(item => <Row key={item.key} label={item.label} hint={item.note} value={formatInteger(item.value)} />)}
              </dl>
              <SectionHeader className="mt-6" title="Data quality" description="Rows that need follow-up. Open a row set to see the CRM remark." />
              <div className="mt-3 space-y-2">
                <QualityRow label="Approved, bank info / NPWP pending" value={report.dataQuality.approvedBankInfoPending} onOpen={() => openDetail('bank_info_pending')} />
                <QualityRow label="Pending, video verification failed" value={report.dataQuality.pendingVideoFailed} onOpen={() => openDetail('pending_video_failed')} />
                <QualityRow label="KYC rejected" value={report.total.kycRejected} onOpen={() => openDetail('kyc_rejected')} />
              </div>
            </Panel>
          </div>

          {detail && (
            <DataTableFrame
              title={`${detail.label} — ${formatInteger(detail.total)} rows`}
              description={detail.total > detail.rows.length ? `Showing the latest ${detail.rows.length}. IDs are masked.` : 'IDs are masked.'}
              action={<Button size="sm" variant="ghost" onClick={() => setDetail(null)}>Close</Button>}
            >
              <table className="w-full text-left text-xs">
                <thead className="text-[var(--mos-text-faint)]"><tr>{['Time (WIB)', 'UID', 'Account', 'Step', 'Status', 'Account status', 'Remark'].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {detail.rows.map((row, i) => (
                    <tr key={i} className="border-t border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]">
                      <td className="whitespace-nowrap px-4 py-2">{formatDateTimeWib(row.event_at).replace(' WIB', '')}</td>
                      <td className="px-4 py-2">{row.uid ?? '—'}</td>
                      <td className="px-4 py-2">{row.trading_account_no ?? '—'}</td>
                      <td className="px-4 py-2">{row.step}</td>
                      <td className="px-4 py-2">{row.step_status}</td>
                      <td className="px-4 py-2">{row.account_status ?? '—'}</td>
                      <td className="max-w-md px-4 py-2">{row.remarks ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTableFrame>
          )}

          <DataTableFrame
            title="Summary"
            description="Period rows count activations; the Total row counts unique accounts, so it can be lower than the sum."
            action={<a href={`/api/monthly-report/export?${query}`}><Button size="sm">Export .xlsx</Button></a>}
          >
            <table className="w-full text-right text-xs">
              <thead className="text-[var(--mos-text-faint)]">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Period</th>
                  {['Registrations', 'KYC Rejected', 'Real Account Approved', 'FTD', 'Pending'].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.buckets.map(bucket => <SummaryRow key={bucket.key} label={bucket.label} values={bucket.values} />)}
                <SummaryRow label="Total" values={report.total} strong />
                {report.hasPreviousData ? (
                  <SummaryRow label={`Previous (${report.previousLabel})`} values={previousValues(report)} muted />
                ) : (
                  <tr className="border-t border-[var(--mos-border-subtle)] text-[var(--mos-text-faint)]"><td className="px-4 py-2 text-left" colSpan={6}>Previous ({report.previousLabel}): no data uploaded</td></tr>
                )}
              </tbody>
            </table>
          </DataTableFrame>

          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SectionHeader title="Rejection reasons" description="Why KYC was rejected, grouped by reason." />
              <StatusBadge tone="neutral">Coming soon</StatusBadge>
            </div>
            <p className="mt-3 text-xs text-[var(--mos-text-muted)]">Rejection reasons will be uploaded separately later. The data model is ready (keyed by Document ID or UID, with date and reason).</p>
          </Panel>
        </>
      )}
    </PageStack>
  );
}

function previousValues(report: OnboardingReport): BucketValues {
  const value = (key: string) => report.kpis.find(k => k.key === key)?.previous ?? null;
  return { ...report.total, registrations: value('registrations'), kycRejected: value('kycRejected') ?? 0, realAccountApproved: value('realAccountApproved') ?? 0, ftd: value('ftd') };
}

function SummaryRow({ label, values, strong, muted }: { label: string; values: BucketValues; strong?: boolean; muted?: boolean }) {
  const pending = values.registrations ? values.registrations - values.realAccountApproved - values.kycRejected : null;
  return (
    <tr className={`border-t border-[var(--mos-border-subtle)] ${strong ? 'font-semibold text-[var(--mos-text)]' : muted ? 'text-[var(--mos-text-faint)]' : 'text-[var(--mos-text-secondary)]'}`}>
      <td className="px-4 py-2 text-left">{label}</td>
      <td className="px-4 py-2">{formatInteger(values.registrations)}</td>
      <td className="px-4 py-2">{formatInteger(values.kycRejected)}</td>
      <td className="px-4 py-2">{formatInteger(values.realAccountApproved)}</td>
      <td className="px-4 py-2">{values.ftd === null ? 'No data' : formatInteger(values.ftd)}</td>
      <td className="px-4 py-2">{formatInteger(pending)}</td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-[var(--mos-text-muted)]">{label}</p>
      <p className="text-base font-[560] text-[var(--mos-text)]">{value}</p>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--mos-border-subtle)] pb-2">
      <dt className="text-[var(--mos-text-muted)]">{label}{hint && <InfoTip text={hint} />}</dt>
      <dd className="font-medium text-[var(--mos-text)]">{value}</dd>
    </div>
  );
}

function QualityRow({ label, value, onOpen }: { label: string; value: number; onOpen: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--mos-radius-control)] border border-[var(--mos-border-subtle)] px-3 py-2 text-xs">
      <span className="text-[var(--mos-text-secondary)]">{label}</span>
      <span className="flex items-center gap-3">
        <span className="font-semibold text-[var(--mos-text)]">{formatInteger(value)}</span>
        <Button size="sm" variant="ghost" disabled={!value} onClick={onOpen}>View rows</Button>
      </span>
    </div>
  );
}
