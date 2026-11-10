import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import JSZip from 'jszip';
import { syntheticFtdReportCsv, syntheticOnboardingWorkbook } from './fixtures/monthly-report-onboarding';
import { buildOnboardingDocx, onboardingDocxFileName, xlsxTotalRegistrations } from '../src/lib/monthly-report/docx-export';
import { reportTableRows } from '../src/lib/monthly-report/export';
import { parseFtdFile } from '../src/lib/monthly-report/ftd-parse';
import {
  aggregateEventsByDay, aggregateFtdByDay, buildOnboardingReport, dateCoverage, ftdCohortStats, type PeriodData,
} from '../src/lib/monthly-report/metrics';
import { parseOnboardingWorkbook } from '../src/lib/monthly-report/onboarding-parse';
import { resolvePeriod } from '../src/lib/monthly-report/periods';

const rows = parseOnboardingWorkbook(syntheticOnboardingWorkbook(), { offset: '+07:00' }).rows;
const ftdRows = parseFtdFile(Buffer.from(syntheticFtdReportCsv()), { fileName: 'ftd.csv', offset: '+07:00' }).rows;
const empty: PeriodData = { daily: [], ftd: [], ftdCoverage: null, uniqueActivated: 0, ftdCohort: { activatedWithFtd: 0, ftdFromPeriodActivations: 0 } };

function weekReport() {
  const period = resolvePeriod({ preset: 'week', anchor: '2026-10-05' });
  const daily = aggregateEventsByDay(rows);
  const ftd = aggregateFtdByDay(ftdRows);
  return buildOnboardingReport({
    period,
    granularity: 'day',
    current: {
      ...empty,
      daily,
      ftd,
      ftdCoverage: dateCoverage(ftd.map(day => day.date)),
      uniqueActivated: 4,
      ftdCohort: ftdCohortStats(rows, ftdRows, period.range),
    },
    previous: empty,
  });
}

test('the onboarding docx is a Word file and its registration total matches the xlsx row', async () => {
  const report = weekReport();
  const buffer = await buildOnboardingDocx(report, 'week');
  assert.equal(onboardingDocxFileName(report, 'week'), `onboarding-report-weekly-${report.range.from}_${report.range.to}.docx`);
  const zip = await JSZip.loadAsync(buffer);
  const document = await zip.file('word/document.xml')?.async('string');
  const header = await zip.file('word/header1.xml')?.async('string');
  const footer = await zip.file('word/footer1.xml')?.async('string');
  assert.ok(document && header && footer);
  assert.match(document, /w:val="Heading1"/);
  assert.match(document, /w:val="Heading2"/);
  assert.match(document, /<w:tbl[\s>]/);
  assert.doesNotMatch(document, /<w:drawing[\s>]/);
  assert.match(document, /Weekly Onboarding Report/);
  assert.match(document, /REPORT PERIOD/);
  assert.match(document, /Daily registration overview/);
  assert.match(document, /Weekly Total/);
  assert.match(document, /KYC rejection reasons|Registration and account performance/);
  const registrations = xlsxTotalRegistrations(report);
  assert.equal(registrations, reportTableRows(report).find(row => row[0] === 'Total')?.[3]);
  assert.equal(typeof registrations, 'number');
  assert.match(document, new RegExp(String(registrations)));
  const kyc = report.total.kycRejected;
  assert.match(document, new RegExp(`KYC Rejected[\\s\\S]{0,80}${kyc}`));
  assert.match(header, /Weekly Onboarding Report/);
  assert.match(footer, /PAGE/);

  const hidden = structuredClone(report);
  hidden.coverage = {
    today: '2026-10-31',
    onboarding: { through: null, missing: [], missingDays: 7 },
    ftd: { through: null, missing: [], missingDays: 7 },
  };
  hidden.totalCoverage = { onboarding: 'none', ftd: 'none' };
  hidden.total = { ...hidden.total, registrations: 999, kycRejected: 999, realAccountApproved: 999, realAccountActivated: 999, manualKycApproved: 999, ftd: 999 };
  const blank = await zipText(await buildOnboardingDocx(hidden, 'week'));
  const totalAt = blank.indexOf('Weekly Total');
  const totalCells = blank.slice(totalAt, totalAt + 1200);
  assert.match(totalCells, /No data/);
  assert.doesNotMatch(totalCells, />999</);
  assert.match(blank, /Pending: Onboarding/);
  assert.match(blank, /Pending: FTD/);
});

async function zipText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')?.async('string') ?? '';
}

test('the Word export stays behind the Onboarding view check', () => {
  const route = readFileSync('src/app/api/monthly-report/export/route.ts', 'utf8');
  const auth = route.indexOf('requireMonthlyReport');
  const docx = route.indexOf("format') === 'docx'");
  assert.ok(auth >= 0 && docx > auth);
  assert.match(route, /onboardingDocxFileName/);
  const page = readFileSync('src/app/dashboard/monthly-report/page.tsx', 'utf8');
  const header = page.indexOf('title="Onboarding Reports"');
  const word = page.indexOf('Export Word');
  const xlsx = page.indexOf('Export .xlsx');
  assert.ok(header >= 0 && word > header && xlsx > word);
});
