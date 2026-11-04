/**
 * Onboarding metric definitions. These pure functions are the single source
 * of truth; the SQL in store.ts mirrors `classifyEvent` and
 * tests/monthly-report-store.test.ts checks that both agree.
 */
import type { FtdRow } from './ftd-parse';
import type { OnboardingRow } from './onboarding-parse';
import { wibDate } from './onboarding-parse';
import {
  MANUAL_APPROVED_DEMO_NOT_DONE_LABEL, REAL_ACCOUNT_ACTIVATED_LABEL, TOTAL_REAL_ACCOUNT_LABEL, TOTAL_REAL_ACCOUNT_NOTE, pending,
} from './definitions';
import {
  describeRange, reportBuckets, type Bucket, type DateRange, type Granularity, type ResolvedPeriod,
} from './periods';
import { coverageState, summarizeCoverage, type CoverageState, type CoverageSummary, type DataCoverage } from './coverage';

export const ADD_ACCOUNT_STEPS = ['auto_add_account', 'manual_add_account'];
export const ACTIVATED_STATUS = 'Real Account Activated';
export const BANK_INFO_FAILED_STATUS = 'Add USD Bank Info / NPWP Failed';
export const VIDEO_FAILED_STATUS = 'Video Verification Failed';

export type EventKind =
  | 'first_account' | 'additional_account' | 'activated_unclassified'
  | 'manual_kyc_approved' | 'auto_kyc_approved' | 'kyc_rejected'
  | 'approved_bank_info_pending' | 'pending_video_failed' | 'other';

type EventLike = Pick<OnboardingRow, 'step' | 'stepStatus' | 'accountStatus' | 'isFirstAccount'>;

/** Conflicting rows are classified by Step Status first, then Account Status. */
export function classifyEvent(row: EventLike): EventKind {
  const isAddAccount = ADD_ACCOUNT_STEPS.includes(row.step);
  if (isAddAccount && row.stepStatus === 'Approved') {
    if (row.accountStatus === ACTIVATED_STATUS) {
      if (row.isFirstAccount === true) return 'first_account';
      if (row.isFirstAccount === false) return 'additional_account';
      return 'activated_unclassified';
    }
    if (row.accountStatus === BANK_INFO_FAILED_STATUS) return 'approved_bank_info_pending';
  }
  if (row.step === 'manual_kyc' && row.stepStatus === 'Approved') return 'manual_kyc_approved';
  if (row.step === 'auto_kyc' && row.stepStatus === 'Approved') return 'auto_kyc_approved';
  if (row.step === 'manual_kyc' && row.stepStatus === 'Rejected') return 'kyc_rejected';
  if (row.stepStatus === 'Pending' && row.accountStatus === VIDEO_FAILED_STATUS) return 'pending_video_failed';
  return 'other';
}

export function isActivation(kind: EventKind): boolean {
  return kind === 'first_account' || kind === 'additional_account' || kind === 'activated_unclassified';
}

export interface DailyOnboarding {
  date: string;
  kycRejected: number;
  manualKycApproved: number;
  autoKycApproved: number;
  firstAccount: number;
  additionalAccount: number;
  activated: number; // distinct trading accounts activated that day
  approvedBankInfoPending: number;
  pendingVideoFailed: number;
  events: number;
}

export interface DailyFtd {
  date: string; count: number; amount: number; micro: number; standard: number; other: number;
  /** Where the day's value comes from (absent = account rows; see ftd-daily.ts for the precedence). */
  source?: FtdSource;
  /** False when a manual entry left the amount empty (`amount` is then 0 and not a real value). */
  amountEntered?: boolean;
}

export type FtdSource = 'manual' | 'accounts';

/**
 * Links FTDs to onboarding on the trading account number, for one range:
 *  - activatedWithFtd: accounts activated in the range that have an FTD (any date)
 *  - ftdFromPeriodActivations: FTDs in the range whose account was activated in the range
 */
export interface FtdCohort { activatedWithFtd: number; ftdFromPeriodActivations: number }

export {
  MANUAL_APPROVED_DEMO_NOT_DONE_LABEL, REAL_ACCOUNT_ACTIVATED_LABEL, TOTAL_REAL_ACCOUNT_LABEL, TOTAL_REAL_ACCOUNT_NOTE, pending,
} from './definitions';

export const DAILY_COUNT_KEYS = [
  'kycRejected', 'manualKycApproved', 'autoKycApproved', 'firstAccount', 'additionalAccount',
  'activated', 'approvedBankInfoPending', 'pendingVideoFailed', 'events',
] as const;
type DailyCountKey = typeof DAILY_COUNT_KEYS[number];

function emptyDay(date: string): DailyOnboarding {
  return { date, kycRejected: 0, manualKycApproved: 0, autoKycApproved: 0, firstAccount: 0, additionalAccount: 0, activated: 0, approvedBankInfoPending: 0, pendingVideoFailed: 0, events: 0 };
}

function accountKey(row: Pick<OnboardingRow, 'tradingAccountNo' | 'documentId'>): string {
  return row.tradingAccountNo ? `acct:${row.tradingAccountNo}` : `doc:${row.documentId}`;
}

const KIND_TO_KEY: Partial<Record<EventKind, DailyCountKey>> = {
  kyc_rejected: 'kycRejected',
  manual_kyc_approved: 'manualKycApproved',
  auto_kyc_approved: 'autoKycApproved',
  first_account: 'firstAccount',
  additional_account: 'additionalAccount',
  approved_bank_info_pending: 'approvedBankInfoPending',
  pending_video_failed: 'pendingVideoFailed',
};

export function aggregateEventsByDay(rows: OnboardingRow[]): DailyOnboarding[] {
  const days = new Map<string, DailyOnboarding>();
  const activatedPerDay = new Map<string, Set<string>>();
  for (const row of rows) {
    const date = wibDate(row.eventAt);
    const day = days.get(date) ?? emptyDay(date);
    days.set(date, day);
    day.events += 1;
    const kind = classifyEvent(row);
    const key = KIND_TO_KEY[kind];
    if (key) day[key] += 1;
    if (isActivation(kind)) {
      const set = activatedPerDay.get(date) ?? new Set<string>();
      set.add(accountKey(row));
      activatedPerDay.set(date, set);
    }
  }
  for (const [date, set] of activatedPerDay) days.get(date)!.activated = set.size;
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function distinctActivatedAccounts(rows: OnboardingRow[]): number {
  const accounts = new Set<string>();
  for (const row of rows) if (isActivation(classifyEvent(row))) accounts.add(accountKey(row));
  return accounts.size;
}

export function aggregateFtdByDay(rows: FtdRow[]): DailyFtd[] {
  const days = new Map<string, DailyFtd & { cents: number }>();
  for (const row of rows) {
    const date = wibDate(row.ftdAt);
    const day = days.get(date) ?? { date, count: 0, amount: 0, micro: 0, standard: 0, other: 0, cents: 0 };
    days.set(date, day);
    day.count += 1;
    day.cents += Math.round(row.amount * 100);
    if (row.accountType === 'micro') day.micro += 1;
    else if (row.accountType === 'standard') day.standard += 1;
    else day.other += 1;
  }
  return [...days.values()]
    .map(({ cents, ...day }) => ({ ...day, amount: cents / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const inRange = (date: string, range: DateRange) => date >= range.from && date <= range.to;

export function dateCoverage(dates: string[]): DateRange | null {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  return { from: sorted[0], to: sorted[sorted.length - 1] };
}

export function ftdCohortStats(onboarding: OnboardingRow[], ftd: FtdRow[], range: DateRange): FtdCohort {
  const activated = new Set<string>();
  for (const row of onboarding) {
    if (row.tradingAccountNo && isActivation(classifyEvent(row)) && inRange(wibDate(row.eventAt), range)) activated.add(row.tradingAccountNo);
  }
  const withFtd = new Set(ftd.map(row => row.accountNo));
  return {
    activatedWithFtd: [...activated].filter(account => withFtd.has(account)).length,
    ftdFromPeriodActivations: ftd.filter(row => inRange(wibDate(row.ftdAt), range) && activated.has(row.accountNo)).length,
  };
}

export function sumDaily(days: DailyOnboarding[]): Omit<DailyOnboarding, 'date'> {
  const total = emptyDay('');
  for (const day of days) for (const key of DAILY_COUNT_KEYS) total[key] += day[key];
  const { date: _date, ...rest } = total;
  return rest;
}

export function maskIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const pct = (part: number | null, whole: number | null) => (part === null || whole === null || whole === 0 ? null : round1((part / whole) * 100));

export interface BucketValues {
  registrations: number | null;
  kycRejected: number;
  /** Total Real Account = realAccountActivated + manualKycApproved. */
  realAccountApproved: number;
  /** Trading accounts activated (unique in the period total; per day/bucket otherwise). */
  realAccountActivated: number;
  manualKycApproved: number;
  autoKycApproved: number;
  firstAccount: number;
  additionalAccount: number;
  kycApproved: number;
  ftd: number | null;
  ftdAmount: number | null;
  approvedBankInfoPending: number;
  pendingVideoFailed: number;
}

/** Per-bucket coverage: `none` / `future` buckets show "No data" instead of 0. */
export interface BucketCoverage { onboarding: CoverageState; ftd: CoverageState }

export interface ReportBucket extends Bucket { values: BucketValues; coverage: BucketCoverage }

export type KpiKey = 'registrations' | 'kycRejected' | 'realAccountApproved' | 'ftd' | 'pending';

export interface Kpi {
  key: KpiKey;
  label: string;
  note: string;
  value: number | null;
  previous: number | null;
  change: number | null;
  changePct: number | null;
  /** Secondary detail shown under the headline value (e.g. the Total Real Account parts). */
  parts?: Array<{ key: string; label: string; value: number | null; previous: number | null }>;
}

export interface FunnelStep { key: string; label: string; value: number | null; stepPct: number | null; overallPct: number | null }

export interface PeriodData {
  daily: DailyOnboarding[];
  ftd: DailyFtd[];
  /** First and last WIB day covered by FTD data overall; FTD shows "no data" outside it. */
  ftdCoverage: DateRange | null;
  uniqueActivated: number;
  ftdCohort: FtdCohort;
}

export interface FtdSummary {
  count: number;
  /** Sum of the entered amounts (days whose manual entry has no amount add nothing; see daysWithoutAmount). */
  amountTotal: number;
  amountAverage: number | null;
  /** Account types are only known for days from the FTD file (manual days have no type). */
  byType: { micro: number; standard: number; other: number };
  /** False when some days of the period come from manual entries (their types are unknown). */
  byTypeComplete: boolean;
  /** Days of the period whose FTD value is a manual entry / derived from account rows. */
  manualDays: number;
  accountDays: number;
  /** Manual days saved without an amount. */
  daysWithoutAmount: number;
  /**
   * Same-account cohort metrics need account-level FTD data for the whole period.
   * When false, fromPeriodActivations / fromEarlierAccounts / realToFtdPct / activatedWithFtd are null ("No data").
   */
  cohortAvailable: boolean;
  fromPeriodActivations: number | null;
  fromEarlierAccounts: number | null;
  /** FTD count ÷ days in the period (the PPT's "daily average"). */
  dailyAverage: number | null;
  /** FTD count ÷ Total Real Account — the method the monthly PPT used (33.8% in Oct with 8,096; 8,098 here). */
  ftdPerApprovedPct: number | null;
  /** FTD count ÷ Registrations — the PPT's "overall" conversion. */
  ftdPerRegistrationPct: number | null;
  /** Accounts activated in the period that made an FTD ÷ unique Real Account Activated (same-account cohort). */
  realToFtdPct: number | null;
  activatedWithFtd: number | null;
}

/** One WIB day of FTD for the period: null count = no data (no manual entry, no FTD file covers it). */
export interface FtdDayValue { date: string; count: number | null; amount: number | null; source: FtdSource | null }

export { COHORT_UNAVAILABLE_NOTE } from './definitions';

export interface OnboardingReport {
  range: DateRange;
  previousRange: DateRange;
  rangeLabel: string;
  previousLabel: string;
  granularity: Granularity;
  kpis: Kpi[];
  breakdown: Array<{ key: string; label: string; note: string; value: number }>;
  buckets: ReportBucket[];
  daily: ReportBucket[];
  total: BucketValues;
  /** The previous period's totals, built the same way as `total`. */
  previousTotal: BucketValues;
  funnel: FunnelStep[];
  ftd: FtdSummary;
  /** Every day of the period with its FTD value and source (manual entry overrides the FTD file). */
  ftdDays: FtdDayValue[];
  dataQuality: { approvedBankInfoPending: number; pendingVideoFailed: number };
  peaks: { activations: { date: string; value: number } | null; registrations: { date: string; value: number } | null; ftd: { date: string; value: number } | null };
  hasOnboardingData: boolean;
  /** False when the previous period has no onboarding rows, so "change vs previous" means nothing. */
  hasPreviousData: boolean;
  hasFtd: boolean;
  /** Coverage of the whole period (same states as the buckets). */
  totalCoverage: BucketCoverage;
  /**
   * Upload coverage (from the upload history's WIB date ranges): last covered day
   * and the days of the period, up to today, that no upload covers.
   * Null when the caller did not pass coverage (legacy: FTD span only).
   */
  coverage: { today: string; onboarding: CoverageSummary; ftd: CoverageSummary } | null;
}

/**
 * Registrations = every onboarding row (all steps: KYC, video verification,
 * add account …) in the period, repeats included — a user rejected and then
 * registering again counts twice. This is the business owner's definition
 * ("all KYC and video verification entries in CRM OBD").
 */
export const REGISTRATIONS_DEFINITION = 'Every onboarding entry in the CRM export (all steps, repeats counted: a user rejected and re-registering counts twice).';

interface CoverageContext { coverage: DataCoverage | null; today: string }

const hasData = (state: CoverageState) => state === 'full' || state === 'partial';

export function bucketCoverage(range: DateRange, data: Pick<PeriodData, 'ftdCoverage'>, context: CoverageContext): BucketCoverage {
  if (!context.coverage) {
    // Legacy (no upload coverage passed): onboarding always counts; FTD by its overall span.
    const ftdCovered = data.ftdCoverage !== null && data.ftdCoverage.from <= range.to && data.ftdCoverage.to >= range.from;
    return { onboarding: 'full', ftd: ftdCovered ? 'full' : 'none' };
  }
  return {
    onboarding: coverageState(range, context.coverage.onboarding, context.today),
    ftd: coverageState(range, context.coverage.ftd, context.today),
  };
}

/**
 * The same-account cohort (Activated → FTD) joins FTDs to onboarding by account
 * number, so it is only reported when account-level FTD data (the FTD file)
 * covers every past day of the range. Manual daily counts have no accounts;
 * computing the cohort on part of the period would understate it silently.
 */
export function cohortAvailable(range: DateRange, context: CoverageContext): boolean {
  if (!context.coverage) return true; // legacy: no coverage passed, FTD rows are the only source
  const state = coverageState(range, context.coverage.ftdAccounts ?? context.coverage.ftd, context.today);
  return state === 'full';
}

function valuesFor(range: DateRange, data: Pick<PeriodData, 'daily' | 'ftd' | 'ftdCoverage'>, coverage: BucketCoverage): BucketValues {
  const days = data.daily.filter(day => inRange(day.date, range));
  const ftd = data.ftd.filter(day => inRange(day.date, range));
  const sum = sumDaily(days);
  const ftdCount = ftd.reduce((total, day) => total + day.count, 0);
  const ftdCents = ftd.reduce((total, day) => total + Math.round(day.amount * 100), 0);
  const covered = hasData(coverage.ftd);
  return {
    // Registrations is null ("No data") when no upload covers the bucket, not 0.
    registrations: hasData(coverage.onboarding) ? sum.events : null,
    kycRejected: sum.kycRejected,
    realAccountApproved: sum.activated + sum.manualKycApproved,
    realAccountActivated: sum.activated,
    manualKycApproved: sum.manualKycApproved,
    autoKycApproved: sum.autoKycApproved,
    firstAccount: sum.firstAccount,
    additionalAccount: sum.additionalAccount,
    kycApproved: sum.manualKycApproved + sum.autoKycApproved,
    ftd: covered ? ftdCount : null,
    ftdAmount: covered ? ftdCents / 100 : null,
    approvedBankInfoPending: sum.approvedBankInfoPending,
    pendingVideoFailed: sum.pendingVideoFailed,
  };
}

/** Period totals count activated accounts once, even when activated on several days. */
function withUniqueActivated(values: BucketValues, uniqueActivated: number): BucketValues {
  return { ...values, realAccountActivated: uniqueActivated, realAccountApproved: uniqueActivated + values.manualKycApproved };
}

function kpi(key: KpiKey, label: string, note: string, value: number | null, previous: number | null, parts?: Kpi['parts']): Kpi {
  const change = value !== null && previous !== null ? value - previous : null;
  return { key, label, note, value, previous, change, changePct: change !== null && previous ? round1((change / previous) * 100) : null, ...(parts ? { parts } : {}) };
}

function peak<T extends { date: string }>(rows: T[], pick: (row: T) => number | null) {
  let best: { date: string; value: number } | null = null;
  for (const row of rows) {
    const value = pick(row);
    if (value !== null && value > 0 && (!best || value > best.value)) best = { date: row.date, value };
  }
  return best;
}

export function buildOnboardingReport(input: {
  period: ResolvedPeriod;
  granularity: Granularity;
  current: PeriodData;
  previous: PeriodData;
  /** Upload coverage per kind; when given, uncovered days show "No data" and gaps are reported. */
  coverage?: DataCoverage | null;
  /** Today in WIB (`YYYY-MM-DD`); days after it are never reported missing. */
  today?: string;
}): OnboardingReport {
  const { period, granularity, current, previous } = input;
  const context: CoverageContext = {
    coverage: input.coverage ?? null,
    today: input.today ?? new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10),
  };
  const totalCoverage = bucketCoverage(period.range, current, context);
  const total = withUniqueActivated(valuesFor(period.range, current, totalCoverage), current.uniqueActivated);
  const prev = withUniqueActivated(valuesFor(period.previous, previous, bucketCoverage(period.previous, previous, context)), previous.uniqueActivated);
  const toBuckets = (buckets: Bucket[]) => buckets.map(bucket => {
    const coverage = bucketCoverage(bucket, current, context);
    return { ...bucket, values: valuesFor(bucket, current, coverage), coverage };
  });
  const ftdDays = current.ftd.filter(day => inRange(day.date, period.range));
  const ftdCount = total.ftd ?? 0;
  const manualDays = ftdDays.filter(day => day.source === 'manual');
  const amountedCount = ftdDays.reduce((n, day) => n + (day.amountEntered === false ? 0 : day.count), 0);
  const cohort = total.ftd !== null && cohortAvailable(period.range, context) ? current.ftdCohort : null;
  const ftdSummary: FtdSummary = {
    count: ftdCount,
    amountTotal: total.ftdAmount ?? 0,
    // Average over the FTDs whose amount is known, so empty manual amounts do not pull it down.
    amountAverage: amountedCount ? Math.round(((total.ftdAmount ?? 0) / amountedCount) * 100) / 100 : null,
    byType: {
      micro: ftdDays.reduce((n, day) => n + day.micro, 0),
      standard: ftdDays.reduce((n, day) => n + day.standard, 0),
      other: ftdDays.reduce((n, day) => n + day.other, 0),
    },
    byTypeComplete: manualDays.length === 0,
    manualDays: manualDays.length,
    accountDays: ftdDays.length - manualDays.length,
    daysWithoutAmount: manualDays.filter(day => day.amountEntered === false).length,
    cohortAvailable: cohort !== null,
    fromPeriodActivations: cohort ? cohort.ftdFromPeriodActivations : null,
    fromEarlierAccounts: cohort ? Math.max(0, ftdCount - cohort.ftdFromPeriodActivations) : null,
    dailyAverage: total.ftd === null ? null : Math.round((total.ftd / period.days) * 10) / 10,
    ftdPerApprovedPct: total.ftd === null ? null : pct(total.ftd, total.realAccountApproved),
    ftdPerRegistrationPct: total.ftd === null ? null : pct(total.ftd, total.registrations),
    realToFtdPct: cohort ? pct(cohort.activatedWithFtd, total.realAccountActivated) : null,
    activatedWithFtd: cohort ? cohort.activatedWithFtd : null,
  };
  const dailyBuckets = toBuckets(reportBuckets(period.range.from, period.range.to, 'day'));
  const ftdByDate = new Map(ftdDays.map(day => [day.date, day]));
  const ftdDayValues: FtdDayValue[] = dailyBuckets.map(bucket => {
    const day = ftdByDate.get(bucket.from);
    if (bucket.values.ftd === null) return { date: bucket.from, count: null, amount: null, source: null };
    return {
      date: bucket.from,
      count: bucket.values.ftd,
      amount: day && day.amountEntered === false ? null : bucket.values.ftdAmount,
      source: day?.source ?? 'accounts',
    };
  });

  const kpis: Kpi[] = [
    kpi('registrations', 'Registrations', REGISTRATIONS_DEFINITION, total.registrations, prev.registrations),
    kpi('kycRejected', 'KYC Rejected', 'Manual KYC step rejected', total.kycRejected, prev.kycRejected),
    kpi('realAccountApproved', TOTAL_REAL_ACCOUNT_LABEL, TOTAL_REAL_ACCOUNT_NOTE, total.realAccountApproved, prev.realAccountApproved, [
      { key: 'realAccountActivated', label: REAL_ACCOUNT_ACTIVATED_LABEL, value: total.realAccountActivated, previous: prev.realAccountActivated },
      { key: 'manualKycApproved', label: MANUAL_APPROVED_DEMO_NOT_DONE_LABEL, value: total.manualKycApproved, previous: prev.manualKycApproved },
    ]),
    kpi('ftd', 'FTD', 'First-time deposits made in the period', total.ftd, prev.ftd),
    kpi('pending', 'Pending', 'Registrations − Total Real Account − KYC Rejected', pending(total), pending(prev)),
  ];

  const kycApproved = total.kycApproved;
  const registrations = total.registrations;
  const funnel: FunnelStep[] = [
    { key: 'registrations', label: 'Registration', value: registrations, stepPct: null, overallPct: registrations ? 100 : null },
    { key: 'kycApproved', label: 'KYC approved', value: kycApproved, stepPct: pct(kycApproved, registrations), overallPct: pct(kycApproved, registrations) },
    // Funnel and FTD cohort use unique activated accounts (not Total Real Account), so the
    // manual-approved-demo-not-done KYC rows are not counted twice against KYC approved.
    { key: 'realAccountActivated', label: 'Real account activated (unique)', value: total.realAccountActivated, stepPct: pct(total.realAccountActivated, kycApproved), overallPct: pct(total.realAccountActivated, registrations) },
    {
      key: 'ftd', label: 'FTD (same accounts)',
      value: cohort ? cohort.activatedWithFtd : null,
      stepPct: cohort ? pct(cohort.activatedWithFtd, total.realAccountActivated) : null,
      overallPct: cohort ? pct(cohort.activatedWithFtd, registrations) : null,
    },
  ];

  return {
    range: period.range,
    previousRange: period.previous,
    rangeLabel: describeRange(period.range),
    previousLabel: describeRange(period.previous),
    granularity,
    kpis,
    breakdown: [
      { key: 'realAccountActivated', label: REAL_ACCOUNT_ACTIVATED_LABEL, note: 'Unique trading accounts activated', value: total.realAccountActivated },
      { key: 'manualKycApproved', label: MANUAL_APPROVED_DEMO_NOT_DONE_LABEL, note: 'Manual KYC approved, demo account not done yet; counted in Total Real Account', value: total.manualKycApproved },
      { key: 'firstAccount', label: 'First account activation (auto)', note: 'Activated accounts flagged as the client’s first account', value: total.firstAccount },
      { key: 'additionalAccount', label: 'Additional account', note: 'Activated accounts for clients who already had one', value: total.additionalAccount },
      { key: 'autoKycApproved', label: 'Auto KYC approved', note: 'KYC step approved automatically (not an account count)', value: total.autoKycApproved },
    ],
    buckets: toBuckets(reportBuckets(period.range.from, period.range.to, granularity)),
    daily: dailyBuckets,
    total,
    previousTotal: prev,
    funnel,
    ftd: ftdSummary,
    ftdDays: ftdDayValues,
    dataQuality: { approvedBankInfoPending: total.approvedBankInfoPending, pendingVideoFailed: total.pendingVideoFailed },
    peaks: {
      activations: peak(current.daily.filter(d => d.date >= period.range.from && d.date <= period.range.to), d => d.activated),
      registrations: peak(current.daily.filter(d => inRange(d.date, period.range)), d => d.events),
      ftd: peak(current.ftd.filter(d => inRange(d.date, period.range)), d => d.count),
    },
    hasOnboardingData: current.daily.some(day => day.events > 0),
    hasPreviousData: previous.daily.some(day => inRange(day.date, period.previous) && day.events > 0),
    hasFtd: total.ftd !== null,
    totalCoverage,
    coverage: context.coverage ? {
      today: context.today,
      onboarding: summarizeCoverage(period.range, context.coverage.onboarding, context.today),
      ftd: summarizeCoverage(period.range, context.coverage.ftd, context.today),
    } : null,
  };
}
