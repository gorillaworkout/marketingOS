/**
 * Prints Monthly Report numbers for a real onboarding export, using the same
 * pure parse/metric functions as the app. Reads a local file only; nothing is
 * written or committed.
 *
 *   npx tsx scripts/verify-monthly-report-source.ts <onboarding.xlsx> [--ftd=ftd.csv] [--offset=+08:00] [--month=2026-10]
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { DEFAULT_SOURCE_OFFSET, offsetFromFileName, parseOnboardingWorkbook, wibDate } from '../src/lib/monthly-report/onboarding-parse';
import { parseFtdFile } from '../src/lib/monthly-report/ftd-parse';
import { aggregateEventsByDay, aggregateFtdByDay, distinctActivatedAccounts, ftdCohortStats, sumDaily } from '../src/lib/monthly-report/metrics';
import { monthWeekBuckets } from '../src/lib/monthly-report/periods';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('Usage: verify-monthly-report-source.ts <onboarding.xlsx> [--ftd=file.csv] [--offset=+08:00] [--month=YYYY-MM]');
  process.exit(1);
}
const flag = (name: string) => flags.find(f => f.startsWith(`--${name}=`))?.split('=')[1];
const offset = flag('offset') ?? offsetFromFileName(basename(file)) ?? DEFAULT_SOURCE_OFFSET;
const parsed = parseOnboardingWorkbook(readFileSync(file), { offset });
if (parsed.errors.length) {
  console.error(parsed.errors.join('\n'));
  process.exit(1);
}
const month = flag('month') ?? parsed.summary.wibRange?.to.slice(0, 7) ?? '';
const inMonth = parsed.rows.filter(row => wibDate(row.eventAt).startsWith(month));
const outside = parsed.rows.length - inMonth.length;
const total = sumDaily(aggregateEventsByDay(inMonth));

console.log(`file: ${basename(file)}  offset: ${offset}  month (WIB): ${month}`);
console.log(`rows parsed: ${parsed.rows.length}  invalid: ${parsed.summary.invalid}  in-file duplicates: ${parsed.summary.duplicatesInFile}  outside month: ${outside}`);
console.log(`WIB range: ${parsed.summary.wibRange?.from} .. ${parsed.summary.wibRange?.to}`);
console.log('unknown values:', JSON.stringify(parsed.summary.unknownValues));
console.table({
  'KYC Rejected (manual)': total.kycRejected,
  'Manual KYC approved': total.manualKycApproved,
  'Auto KYC approved': total.autoKycApproved,
  'First account activation': total.firstAccount,
  'Additional account': total.additionalAccount,
  'Real Account Approved (unique)': distinctActivatedAccounts(inMonth),
  'Approved, bank info / NPWP pending': total.approvedBankInfoPending,
  'Pending video, marked failed': total.pendingVideoFailed,
});
const weeks = monthWeekBuckets(month).map(week => {
  const rows = inMonth.filter(row => { const d = wibDate(row.eventAt); return d >= week.from && d <= week.to; });
  const sum = sumDaily(aggregateEventsByDay(rows));
  return { week: week.label, rejected: sum.kycRejected, realAccount: distinctActivatedAccounts(rows), manualKyc: sum.manualKycApproved, autoKyc: sum.autoKycApproved, first: sum.firstAccount, additional: sum.additionalAccount };
});
console.table(weeks);

const ftdFile = flag('ftd');
if (ftdFile) {
  const ftd = parseFtdFile(readFileSync(ftdFile), { fileName: basename(ftdFile), offset });
  if (ftd.errors.length) {
    console.error(ftd.errors.join('\n'));
    process.exit(1);
  }
  const ftdInMonth = ftd.rows.filter(row => wibDate(row.ftdAt).startsWith(month));
  const daily = aggregateFtdByDay(ftdInMonth);
  const range = { from: `${month}-01`, to: `${month}-31` };
  const cohort = ftdCohortStats(inMonth, ftd.rows, range);
  const activated = distinctActivatedAccounts(inMonth);
  const amount = daily.reduce((n, d) => n + Math.round(d.amount * 100), 0) / 100;
  console.log(`\nFTD file: ${basename(ftdFile)}  layout: ${ftd.layout}  header month: ${JSON.stringify(ftd.reportMonth)}  issues: ${ftd.issues.length}  warnings: ${ftd.warnings.join(' ') || 'none'}`);
  console.table({
    'FTD in month (WIB)': ftdInMonth.length,
    'Unique FTD accounts': new Set(ftdInMonth.map(r => r.accountNo)).size,
    'Amount total': amount,
    'Amount average': Math.round((amount / ftdInMonth.length) * 100) / 100,
    micro: ftdInMonth.filter(r => r.accountType === 'micro').length,
    standard: ftdInMonth.filter(r => r.accountType === 'standard').length,
    'FTD from accounts activated this month': cohort.ftdFromPeriodActivations,
    'FTD from earlier accounts': ftdInMonth.length - cohort.ftdFromPeriodActivations,
    'Activated this month with an FTD': cohort.activatedWithFtd,
    'FTD ÷ Real Account Approved %': Math.round((ftdInMonth.length / activated) * 1000) / 10,
    'Real → FTD (same accounts) %': Math.round((cohort.activatedWithFtd / activated) * 1000) / 10,
  });
  const byDay = Object.fromEntries(daily.map(d => [d.date, d.count]));
  console.log('FTD per day:', Object.entries(byDay).map(([d, n]) => `${d.slice(5)}=${n}`).join(' '));
}
