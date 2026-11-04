/**
 * Admin import for Monthly Report data: loads the onboarding export and/or
 * the FTD report with the same parsers and upserts as the dashboard uploads
 * (one upload-history row per file). Onboarding events are insert-only by
 * Document ID + event time + Steps: re-running with the same file inserts 0
 * rows and reports every row as a skipped duplicate. FTD upserts by Account.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/monthly-report-import.ts \
 *     --onboarding=source.xlsx --ftd=ftd.csv [--offset=+07:00] [--ftd-offset=+07:00] \
 *     [--as=bayu] [--report=2026-10] [--dry-run]
 *
 * --offset is the UTC offset of the export timestamps (default +07:00 WIB; the
 * `+08_00` suffix in CRM file names is the export time, not the data's, and is
 * ignored); --ftd-offset defaults to --offset. --report prints the
 * month's numbers from the database after importing.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const dryRun = args.includes('--dry-run');

function warnFileNameOffset(name: string, offset: string, fromName: (n: string) => string | null) {
  const suffix = fromName(name);
  if (suffix && suffix !== offset) console.warn(`  note: file name suffix says ${suffix} (export time); using ${offset} for the data`);
}

async function main() {
  const { closeDb, queryOne } = await import('../src/lib/database');
  const { DEFAULT_SOURCE_OFFSET, offsetFromFileName, parseOnboardingWorkbook } = await import('../src/lib/monthly-report/onboarding-parse');
  const { parseFtdFile } = await import('../src/lib/monthly-report/ftd-parse');
  const store = await import('../src/lib/monthly-report/store');
  const { buildOnboardingReport } = await import('../src/lib/monthly-report/metrics');
  const { resolvePeriod } = await import('../src/lib/monthly-report/periods');

  const onboardingFile = flag('onboarding');
  const ftdFile = flag('ftd');
  const reportMonth = flag('report');
  if (!onboardingFile && !ftdFile && !reportMonth) {
    console.error('Usage: monthly-report-import.ts --onboarding=<xlsx> --ftd=<csv|xlsx> [--offset=+07:00] [--ftd-offset=] [--as=username] [--report=YYYY-MM] [--dry-run]');
    process.exit(1);
  }

  const username = flag('as') ?? 'admin';
  const user = await queryOne<{ id: string; name: string }>('SELECT id, name FROM users WHERE username = ?', [username]);
  const actor = { id: user?.id ?? null, name: user ? `${user.name} (CLI import)` : `CLI import (${username})` };
  let failed = false;

  if (onboardingFile) {
    const offset = flag('offset') ?? DEFAULT_SOURCE_OFFSET;
    warnFileNameOffset(basename(onboardingFile), offset, offsetFromFileName);
    const parsed = parseOnboardingWorkbook(readFileSync(onboardingFile), { offset });
    console.log(`Onboarding ${basename(onboardingFile)} @ ${offset}: ${parsed.rows.length} events, ${parsed.issues.length} invalid, ${parsed.summary.duplicatesInFile} repeated in file (${parsed.summary.conflictingDuplicatesInFile} with differing values), WIB ${parsed.summary.wibRange?.from} → ${parsed.summary.wibRange?.to}`);
    if (parsed.errors.length) { console.error(parsed.errors.join('\n')); failed = true; }
    else if (!dryRun) {
      const saved = await store.saveOnboardingEvents(parsed.rows, { fileName: basename(onboardingFile), offset, actor, skipped: parsed.issues.length, duplicatesInFile: parsed.summary.duplicatesInFile, range: parsed.summary.wibRange });
      const c = saved.counts;
      console.log(`  saved: ${c.inserted} inserted, ${c.skippedDuplicate} skipped as duplicate (${c.duplicatesInFile} within the file), ${c.invalid} invalid, ${c.total} rows total; upload ${saved.uploadId}`);
    }
  }

  if (ftdFile) {
    const offset = flag('ftd-offset') ?? flag('offset') ?? DEFAULT_SOURCE_OFFSET;
    warnFileNameOffset(basename(ftdFile), offset, offsetFromFileName);
    const parsed = parseFtdFile(readFileSync(ftdFile), { fileName: basename(ftdFile), offset });
    console.log(`FTD ${basename(ftdFile)} @ ${offset}: layout ${parsed.layout}, ${parsed.rows.length} accounts, ${parsed.issues.length} invalid, amount ${parsed.summary.amountTotal.toFixed(2)}`);
    for (const warning of parsed.warnings) console.warn(`  warning: ${warning}`);
    if (parsed.errors.length) { console.error(parsed.errors.join('\n')); failed = true; }
    else if (!dryRun) {
      const saved = await store.saveFtd(parsed.rows, { fileName: basename(ftdFile), offset, actor, skipped: parsed.issues.length, range: parsed.summary.wibRange });
      console.log('  saved:', saved.counts, 'upload', saved.uploadId);
    }
  }

  if (reportMonth) {
    const period = resolvePeriod({ preset: 'month', anchor: `${reportMonth}-01` });
    const coverage = await store.loadFtdCoverage();
    const [current, previous] = await Promise.all([store.loadPeriodData(period.range, coverage), store.loadPeriodData(period.previous, coverage)]);
    const report = buildOnboardingReport({ period, granularity: 'week', current, previous });
    console.log(`\nReport ${period.range.from} → ${period.range.to} (from the database, WIB days)`);
    console.table(Object.fromEntries(report.kpis.map(k => [k.label, k.value])));
    console.table(Object.fromEntries(report.breakdown.map(b => [b.label, b.value])));
    console.table(report.buckets.map(b => ({ week: b.label, registrations: b.values.registrations, rejected: b.values.kycRejected, approved: b.values.realAccountApproved, ftd: b.values.ftd })));
    console.table(report.funnel.map(s => ({ step: s.label, value: s.value, stepPct: s.stepPct, overallPct: s.overallPct })));
    const { byType, ...ftd } = report.ftd;
    console.table({ ...ftd, micro: byType.micro, standard: byType.standard, peakDay: report.peaks.ftd?.date, peak: report.peaks.ftd?.value });
    console.log('FTD per day:', JSON.stringify(report.daily.map(d => d.values.ftd)));
  }

  await closeDb();
  if (failed) process.exitCode = 1;
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
});
