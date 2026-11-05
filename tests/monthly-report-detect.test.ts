import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  ONBOARDING_HEADERS, SYNTHETIC_ROWS, buildWorkbookBuffer, cleanFtdWorkbook, syntheticFtdReportCsv, syntheticOnboardingWorkbook,
} from './fixtures/monthly-report-onboarding';
import { FTD_IS_MANUAL_MESSAGE, autoUploadAction, detectUploadKind, unknownFormatError } from '../src/lib/monthly-report/detect';
import { FTD_COLUMNS, parseFtdFile } from '../src/lib/monthly-report/ftd-parse';
import { ONBOARDING_COLUMNS, parseOnboardingWorkbook } from '../src/lib/monthly-report/onboarding-parse';

const onboardingCsv = () => Buffer.from([
  ONBOARDING_HEADERS.join(','),
  ...SYNTHETIC_ROWS.map(row => row.map(value => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value))).join(',')),
].join('\n'));

test('detect: onboarding export (.xlsx, "Query result" sheet)', () => {
  const result = detectUploadKind(syntheticOnboardingWorkbook());
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'onboarding');
  assert.equal(result.ok && result.sheetName, 'Query result');
  assert.equal(result.ok && result.label, 'Onboarding export (classic)');
});

test('detect: onboarding export on another sheet name and as .csv', () => {
  assert.equal(detectUploadKind(buildWorkbookBuffer(SYNTHETIC_ROWS, { sheetName: 'Sheet1' })).kind, 'onboarding');
  const csv = onboardingCsv();
  const result = detectUploadKind(csv);
  assert.equal(result.kind, 'onboarding');
  // The detected parser accepts the same file.
  const parsed = parseOnboardingWorkbook(csv, { offset: '+07:00' });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, SYNTHETIC_ROWS.length);
});

test('detect: FTD monthly report CSV (title rows, side-by-side blocks)', () => {
  const buffer = Buffer.from(syntheticFtdReportCsv());
  const result = detectUploadKind(buffer);
  assert.equal(result.kind, 'ftd');
  assert.equal(result.ok && result.kind === 'ftd' && result.layout, 'report');
  assert.equal(result.ok && result.label, 'FTD report (monthly report)');
  assert.equal(parseFtdFile(buffer, { fileName: 'ftd.csv', offset: '+07:00' }).layout, 'report');
});

test('detect: FTD clean table (.xlsx and .csv)', () => {
  const xlsx = cleanFtdWorkbook([['7000001', 'micro', '1-Oct-2026', '10/1/2026 02:41:59', '71.42']]);
  const result = detectUploadKind(xlsx);
  assert.equal(result.kind, 'ftd');
  assert.equal(result.ok && result.kind === 'ftd' && result.layout, 'table');
  assert.equal(result.ok && result.label, 'FTD report (clean table)');
  const csv = Buffer.from(`${FTD_COLUMNS.join(',')}\n7000001,micro,1-Oct-2026,10/1/2026 02:41:59,71.42\n`);
  assert.equal(detectUploadKind(csv).kind, 'ftd');
});

test('detect: unknown format lists the expected columns of both types', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['Name', 'Email', 'Phone'], ['A', 'a@example.com', '1']]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Contacts');
  const result = detectUploadKind(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  assert.equal(result.ok, false);
  assert.equal(result.kind, null);
  if (result.ok) return;
  assert.equal(result.error, unknownFormatError());
  for (const column of [...ONBOARDING_COLUMNS, ...FTD_COLUMNS]) assert.ok(result.error.includes(column), column);
  assert.deepEqual(result.hints, []);
  assert.deepEqual(result.expected.onboarding, ONBOARDING_COLUMNS);
  assert.deepEqual(result.expected.ftd, FTD_COLUMNS);
});

test('detect: near misses name the missing columns', () => {
  const headers = ONBOARDING_HEADERS.filter(header => header !== 'Steps' && header !== 'Step Status');
  const partial = detectUploadKind(buildWorkbookBuffer([], { headers }));
  assert.equal(partial.ok, false);
  assert.match(!partial.ok ? partial.hints.join(' ') : '', /onboarding export, but these columns are missing: Steps, Step Status/);

  const ftd = detectUploadKind(Buffer.from('Account,Type,Amount\n7000001,micro,10\n'));
  assert.equal(ftd.ok, false);
  assert.match(!ftd.ok ? ftd.hints.join(' ') : '', /FTD table, but these columns are missing: Join Date, FTD Time/);
});

test('detect: empty and unreadable files', () => {
  const empty = detectUploadKind(Buffer.alloc(0));
  assert.equal(empty.ok, false);
  assert.match(!empty.ok ? empty.error : '', /empty/);
  assert.equal(detectUploadKind(Buffer.from('just some text\nwithout columns\n')).kind, null);
});

test('detect: the auto route imports onboarding only, rejects FTD files with the manual-entry message, checks the previewed type on commit', async () => {
  const { readFile } = await import('node:fs/promises');
  const route = await readFile('src/app/api/monthly-report/uploads/auto/route.ts', 'utf8');
  assert.match(route, /detectUploadKind\(body\)/);
  assert.match(route, /handleOnboardingUpload\(user, body, params, extra\)/);
  assert.doesNotMatch(route, /handleFtdUpload/);
  assert.match(route, /autoUploadAction\(detected\) === 'ftd-manual'/);
  assert.match(route, /FTD_IS_MANUAL_MESSAGE/);
  assert.match(route, /expect !== detected\.kind/);
  assert.match(route, /requireMonthlyReport\(request, \{ upload: true \}\)/);
  const onboarding = await readFile('src/app/api/monthly-report/uploads/onboarding/route.ts', 'utf8');
  assert.match(onboarding, /requireMonthlyReport\(request, \{ upload: true \}\)/);
  // Legacy account-level FTD file import: admin only.
  const ftd = await readFile('src/app/api/monthly-report/uploads/ftd/route.ts', 'utf8');
  assert.match(ftd, /requireMonthlyReport\(request, \{ adminOnly: true \}\)/);
});

test('detect: auto-upload action per detected kind', () => {
  assert.equal(autoUploadAction(detectUploadKind(syntheticOnboardingWorkbook())), 'onboarding');
  assert.equal(autoUploadAction(detectUploadKind(Buffer.from(syntheticFtdReportCsv(), 'utf8'))), 'ftd-manual');
  assert.equal(autoUploadAction(detectUploadKind(Buffer.from('just some text\nwithout columns\n'))), 'unknown');
  assert.match(FTD_IS_MANUAL_MESSAGE, /FTD is entered manually below/);
});
