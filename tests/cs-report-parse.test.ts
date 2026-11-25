import test from 'node:test';
import assert from 'node:assert/strict';
import { asDate, parseBlockRange, parseCsWorkbook, sheetMonth } from '../src/lib/cs-report/parse';
import { statusFromFill } from '../src/lib/cs-report/leave';
import { buildSyntheticWorkbook } from './fixtures/cs-report-workbook';

test('leave status comes from the fill hue (all shades seen in the real files)', () => {
  for (const argb of ['FFF4CCCC', 'FFFF0000', 'FFEA4335', 'FFF54A45', 'FFFDDDEF']) assert.equal(statusFromFill(argb), 'sick', argb);
  for (const argb of ['FFFFF2CC', 'FFFAF1D1', 'FFFFFF00']) assert.equal(statusFromFill(argb), 'annual_leave', argb);
  for (const argb of ['FFFFFFFF', 'FFD9EAD3', 'FFA8D08D', '00000000', null, undefined, 'theme', 'FFEEEEEE']) assert.equal(statusFromFill(argb as string | null), 'present', String(argb));
});

test('week labels and sheet titles are read with the right year', () => {
  assert.deepEqual(sheetMonth('Dec 2025'), { year: 2025, month: 11 });
  assert.deepEqual(parseBlockRange('Date: 1th Dec to 5th Dec ', sheetMonth('Dec 2025')), { from: '2025-12-01', to: '2025-12-05' });
  assert.deepEqual(parseBlockRange('Date: 29th Dec to 2th Jan ', sheetMonth('Dec 2025')), { from: '2025-12-29', to: '2026-01-02' });
  assert.deepEqual(parseBlockRange('Date: 31th August to 4th September', sheetMonth('Sep 2026')), { from: '2026-08-31', to: '2026-09-04' });
  assert.deepEqual(parseBlockRange('Date: 29th June to 3th July', sheetMonth('Jul 2026')), { from: '2026-06-29', to: '2026-07-03' });
  assert.equal(parseBlockRange('Date: soon', sheetMonth('Jul 2026')), null);
  assert.equal(asDate(new Date('2026-07-01T00:00:00Z')), '2026-07-01');
  assert.equal(asDate('3/7/2026'), '2026-07-03');
  assert.equal(asDate(46204), '2026-07-01');
  assert.equal(asDate('Total:'), null);
});

test('synthetic workbook: agent-days, leave, totals ignored, holiday row skipped, names normalised', async () => {
  const parsed = await parseCsWorkbook(await buildSyntheticWorkbook());
  assert.deepEqual(parsed.names, ['Agent Alpha', 'Agent Bravo', 'Agent Charlie']);
  const jun = parsed.sheets.find(s => s.sheet === 'Jun 2026')!;
  assert.deepEqual({ weeks: jun.weeks, agentDays: jun.agentDays, present: jun.presentDays, sick: jun.sickDays, annual: jun.annualLeaveDays, complaints: jun.complaints, notes: jun.notes },
    { weeks: 2, agentDays: 12, present: 7, sick: 3, annual: 2, complaints: 2, notes: 10 });
  const alpha = parsed.entries.find(e => e.name === 'Agent Alpha' && e.date === '2026-06-01')!;
  assert.equal(alpha.status, 'present');
  assert.equal(alpha.imReception, 10);
  assert.equal(alpha.emailReception, null, 'empty cell stays null');
  assert.equal(alpha.waBusinessReception, 2);
  assert.equal(alpha.socialMediaReception, 0);
  assert.equal(alpha.accountProblem, 5);
  assert.equal(alpha.notFollowedUp, 7);
  assert.equal(alpha.followUpMinutes, 5);
  assert.ok(!parsed.entries.some(e => e.imReception === 999), 'Total rows are ignored');
  assert.ok(!parsed.entries.some(e => /holiday/i.test(e.name)), 'merged holiday row is not an agent');
  assert.equal(parsed.entries.find(e => e.name === 'Agent Bravo' && e.date === '2026-06-04')?.status, 'annual_leave', 'name with odd spacing/case maps to the same agent');
  assert.equal(parsed.entries.find(e => e.name === 'Agent Charlie' && e.date === '2026-06-04')?.status, 'sick');
  assert.equal(parsed.entries.find(e => e.date === '2026-06-29' && e.name === 'Agent Alpha')?.followUpMinutes, 4);
});

test('synthetic workbook: copied week moved to its label, label typos ignored, cross-sheet week skipped once', async () => {
  const parsed = await parseCsWorkbook(await buildSyntheticWorkbook());
  const jul = parsed.sheets.find(s => s.sheet === 'Jul 2026')!;
  assert.equal(jul.agentDays, 5);
  assert.equal(jul.weeks, 4);
  const julDates = parsed.entries.filter(e => e.sheet === 'Jul 2026').map(e => `${e.name}|${e.date}`).sort();
  assert.deepEqual(julDates, ['Agent Alpha|2026-07-06', 'Agent Alpha|2026-07-13', 'Agent Alpha|2026-07-20', 'Agent Bravo|2026-07-06', 'Agent Bravo|2026-07-13']);
  assert.equal(parsed.entries.find(e => e.date === '2026-07-13' && e.name === 'Agent Alpha')?.imReception, 60);
  assert.equal(parsed.entries.find(e => e.date === '2026-07-13' && e.name === 'Agent Alpha')?.followUpMinutes, 2);
  assert.equal(parsed.entries.filter(e => e.date === '2026-06-29').length, 3, '29 Jun appears in both sheets but is stored once');
  assert.ok(parsed.warnings.some(w => /repeats the dates 2026-07-06 to 2026-07-06 .* moved to 2026-07-13 to 2026-07-17/.test(w)));
  assert.ok(parsed.warnings.some(w => /Jul 2026: 3 agent-day\(s\) were already in an earlier sheet with the same values/.test(w)));
  assert.equal(parsed.dateFrom, '2026-06-01');
  assert.equal(parsed.dateTo, '2026-07-20');
});

test('synthetic workbook: notes per week and complaint table by header text', async () => {
  const parsed = await parseCsWorkbook(await buildSyntheticWorkbook());
  const im = parsed.notes.find(n => n.weekStart === '2026-06-01' && n.channel === 'CRM/IM')!;
  assert.deepEqual(im, { weekStart: '2026-06-01', weekEnd: '2026-06-04', channel: 'CRM/IM', frequentQuestion: 'How to verify the account?', difficultQuestion: 'Swap calculation' });
  assert.equal(parsed.notes.find(n => n.weekStart === '2026-06-01' && n.channel === 'Email')?.difficultQuestion, '', '"-" means none');
  assert.equal(parsed.notes.filter(n => n.weekStart === '2026-06-29').length, 5, 'the repeated week keeps one set of notes');
  assert.equal(parsed.notes.find(n => n.channel === 'Social Media' && n.weekStart === '2026-07-06')?.frequentQuestion, 'Reward program');

  assert.equal(parsed.complaints.length, 3);
  const [first, second, third] = parsed.complaints;
  assert.deepEqual({ ...first, dedupeKey: undefined, row: undefined }, {
    date: '2026-06-02', clientName: 'Client One', uid: '1000001', account: '2000001', platform: 'MT5', description: 'Order executed at a different price',
    cause: 'Cause text', resolution: 'Resolution text', completionDate: '2026-06-03', status: 'Solved', slaMet: null, urgency: 'High', category: '',
    sheet: 'Jun 2026', dedupeKey: undefined, row: undefined,
  });
  assert.equal(second.status, 'On Progress');
  assert.equal(second.account, 'DEMO-ACC-0002');
  assert.equal(second.completionDate, null);
  assert.equal(third.category, 'Execution & Slippage Issues');
  assert.equal(third.cause, 'Market gap');
  assert.equal(third.resolution, 'Explained');
  assert.ok(parsed.warnings.some(w => /duplicate complaint/.test(w)));
});

test('a file without CS blocks parses to nothing instead of throwing', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Sheet1').getCell('A1').value = 'hello';
  const parsed = await parseCsWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(parsed.entries.length, 0);
  assert.equal(parsed.complaints.length, 0);
});
