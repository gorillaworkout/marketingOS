import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNTHETIC_FTD, cleanFtdWorkbook, excelSerial, syntheticFtdReportCsv } from './fixtures/monthly-report-onboarding';
import { parseFlexibleDate, parseFtdFile } from '../src/lib/monthly-report/ftd-parse';

test('join dates accept 17-Sep-2026, 10/22/2026 (M/D/YYYY) and ISO', () => {
  assert.equal(parseFlexibleDate('17-Sep-2026'), '2026-09-17');
  assert.equal(parseFlexibleDate('1-Oct-2026'), '2026-10-01');
  assert.equal(parseFlexibleDate('10/22/2026'), '2026-10-22');
  assert.equal(parseFlexibleDate('2026-10-22'), '2026-10-22');
  assert.equal(parseFlexibleDate(excelSerial('2026-10-22')), '2026-10-22');
  assert.equal(parseFlexibleDate('31-Feb-2026'), null);
  assert.equal(parseFlexibleDate('13/01/2026'), null);
  assert.equal(parseFlexibleDate(''), null);
});

test('the report-style CSV: only the MONTHLY block is read', () => {
  const result = parseFtdFile(Buffer.from(syntheticFtdReportCsv()), { fileName: 'ftd.csv', offset: '+08:00' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.layout, 'report');
  assert.deepEqual(result.reportMonth, { year: 2026, month: 10 });
  assert.equal(result.rows.length, SYNTHETIC_FTD.length);
  assert.deepEqual(result.rows[0], {
    accountNo: '7000001', accountType: 'micro', joinDate: '2026-10-01', ftdAt: '2026-09-30T18:41:59.000Z', amount: 71.42,
  });
  assert.equal(result.rows[1].amount, 1000);
  assert.equal(result.rows[4].amount, 12345.6);
  assert.equal(result.summary.amountTotal, 13667.02);
  assert.deepEqual(result.summary.byType, { micro: 3, standard: 2 });
  // 10/2 00:30 at +08:00 is 1 Oct 23:30 WIB.
  assert.deepEqual(result.summary.wibRange, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(result.warnings, []);
});

test('a clean single-table XLSX with the same headers is accepted', () => {
  const buffer = cleanFtdWorkbook([
    ['7000001', 'Micro', '17-Sep-2026', '10/1/2026 02:41:59', 71.42],
    [7000002, 'standard', excelSerial('2026-10-02'), excelSerial('2026-10-02 09:00:00'), '1,000.00'],
  ]);
  const result = parseFtdFile(buffer, { fileName: 'ftd.xlsx', offset: '+07:00' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.layout, 'table');
  assert.equal(result.reportMonth, null);
  assert.deepEqual(result.rows.map(r => [r.accountNo, r.accountType, r.joinDate, r.ftdAt, r.amount]), [
    ['7000001', 'micro', '2026-09-17', '2026-09-30T19:41:59.000Z', 71.42],
    ['7000002', 'standard', '2026-10-02', '2026-10-02T02:00:00.000Z', 1000],
  ]);
});

test('bad rows are reported, duplicates keep the last row, missing headers reject the file', () => {
  const csv = syntheticFtdReportCsv([
    ...SYNTHETIC_FTD.slice(0, 2),
    ['7000009', 'micro', '1-Oct-2026', 'yesterday', '10.00'],
    ['7000010', 'micro', '1-Oct-2026', '10/3/2026 10:00:00', 'abc'],
    ['7000001', 'micro', '1-Oct-2026', '10/1/2026 05:00:00', '80.00'],
  ]);
  const result = parseFtdFile(Buffer.from(csv), { fileName: 'ftd.csv', offset: '+08:00' });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].amount, 80);
  assert.equal(result.summary.duplicatesInFile, 1);
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0].message, /FTD Time/);
  assert.match(result.issues[1].message, /Amount/);

  const missing = parseFtdFile(Buffer.from('Account,Type\n1,micro\n'), { fileName: 'x.csv', offset: '+08:00' });
  assert.match(missing.errors.join(' '), /Could not find the FTD table/);
});

test('rows outside the Year/Month in the report header produce a warning', () => {
  const csv = syntheticFtdReportCsv([['7000001', 'micro', '1-Oct-2026', '11/1/2026 12:00:00', '10.00']]);
  const result = parseFtdFile(Buffer.from(csv), { fileName: 'ftd.csv', offset: '+08:00' });
  assert.match(result.warnings.join(' '), /outside 2026-10/);
});
