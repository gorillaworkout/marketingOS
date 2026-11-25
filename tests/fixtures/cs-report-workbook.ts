/**
 * Synthetic CS workbook in the current layout (no real names or values).
 * Mirrors the quirks of the real file: Total rows, a merged holiday row, leave
 * fills in several shades, follow-up minutes in the header, a Notes block, a
 * complaint table whose columns move (Urgency Level), summary rows, a merged
 * footnote, a copied week (row dates repeat an earlier week), and a week that
 * appears in two monthly sheets.
 */
import ExcelJS from 'exceljs';

export const AGENTS = ['Agent Alpha', 'Agent Bravo', 'Agent Charlie'];
const HEADER = ['Date', 'Name', 'IM Reception', 'E-mail Reception', 'WA Bussiness Reception', 'Social Media Reception', 'Call Reception',
  'Account Problem', 'Deposit/Withdraw', 'Orders and Transactions', 'APP&ActsTrade&MT5', 'Reward Program', 'Complaint',
  'Unsolved Issues and Customer UID', 'Unsolved Completed'];

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

type DayRow = { date: string; rows: Array<{ name: string; fill?: string; values: Array<number | null> }> } | { holiday: string };

function writeWeek(ws: ExcelJS.Worksheet, start: number, label: string, minutes: number, days: DayRow[], notes: Array<[string, string, string]>): number {
  let r = start;
  ws.getCell(r, 1).value = `Date: ${label}`; r += 1;
  ws.getCell(r, 1).value = 'Weekly Work List'; ws.getCell(r, 1).fill = fill('FF2EA121'); r += 1;
  [...HEADER, `Conversations not followed up within ${minutes} minutes`].forEach((h, i) => { ws.getCell(r, i + 1).value = h; });
  r += 1;
  for (const day of days) {
    if ('holiday' in day) {
      ws.getCell(r, 1).value = day.holiday;
      ws.mergeCells(r, 1, r + 3, 16);
      r += 4;
      continue;
    }
    const first = r;
    day.rows.forEach((row, i) => {
      if (i === 0) ws.getCell(r, 1).value = d(day.date);
      ws.getCell(r, 2).value = row.name;
      ws.getCell(r, 2).fill = fill(row.fill ?? 'FFFFFFFF');
      row.values.forEach((v, c) => { if (v !== null) ws.getCell(r, c + 3).value = v; });
      r += 1;
    });
    if (day.rows.length > 1) ws.mergeCells(first, 1, r - 1, 1);
    ws.getCell(r, 1).value = 'Total:';
    for (let c = 3; c <= 16; c++) ws.getCell(r, c).value = 999; // stale totals: must be ignored
    r += 1;
  }
  r += 1;
  ws.getCell(r, 1).value = 'Notes: ';
  ws.getCell(r, 3).value = 'Channel'; ws.getCell(r, 4).value = 'Total';
  ws.getCell(r, 5).value = 'Most frequently asked questions'; ws.getCell(r, 10).value = 'The most difficult question';
  r += 1;
  ['CRM/IM', 'Email', 'WA Bussiness', 'Social Media', 'Call'].forEach((channel, i) => {
    if (i === 0) { ws.getCell(r, 1).value = 'Red : Sick Leave'; ws.getCell(r, 1).fill = fill('FFF4CCCC'); }
    if (i === 1) { ws.getCell(r, 1).value = 'Yellow : Annual Leave'; ws.getCell(r, 1).fill = fill('FFFFF2CC'); }
    ws.getCell(r, 3).value = channel; ws.getCell(r, 4).value = 12345;
    const note = notes.find(n => n[0] === channel);
    ws.getCell(r, 5).value = note?.[1] ?? '-'; ws.mergeCells(r, 5, r, 9);
    ws.getCell(r, 10).value = note?.[2] ?? '-'; ws.mergeCells(r, 10, r, 13);
    r += 1;
  });
  return r + 1;
}

const vals = (base: number): Array<number | null> => [base, null, 2, 0, null, 5, 4, 0, 1, 3, 1, 0, 0, 7];

export async function buildSyntheticWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // --- Sheet 1: "Jun 2026" (weeks 1-5 Jun and 29 Jun - 3 Jul).
  const jun = wb.addWorksheet('Jun 2026');
  let r = writeWeek(jun, 1, '1th June to 5th June', 5, [
    { date: '2026-06-01', rows: [{ name: 'Agent Alpha', values: vals(10) }, { name: 'Agent Bravo', fill: 'FFF4CCCC', values: Array(14).fill(null) }, { name: 'Agent Charlie', values: vals(30) }] },
    { date: '2026-06-02', rows: [{ name: 'Agent Alpha', fill: 'FFFF0000', values: Array(14).fill(null) }, { name: 'Agent Bravo', values: vals(21) }, { name: 'Agent Charlie', fill: 'FFFFF2CC', values: Array(14).fill(null) }] },
    { holiday: 'PUBLIC HOLIDAY' },
    { date: '2026-06-04', rows: [{ name: 'Agent Alpha', values: vals(12) }, { name: 'agent  bravo ', fill: 'FFFAF1D1', values: Array(14).fill(null) }, { name: 'Agent Charlie', fill: 'FFEA4335', values: Array(14).fill(null) }] },
  ], [['CRM/IM', 'How to verify the account?', 'Swap calculation'], ['Email', 'Withdrawal time', '-']]);
  r = writeWeek(jun, r, '29th June to 3th July', 4, [
    { date: '2026-06-29', rows: [{ name: 'Agent Alpha', values: vals(40) }, { name: 'Agent Bravo', values: vals(41) }, { name: 'Agent Charlie', values: vals(42) }] },
  ], []);
  jun.getCell(r, 1).value = 'Report Complaint'; jun.mergeCells(r, 1, r, 16); r += 1;
  ['Date', 'Client Name', 'UID', 'Account', 'Platform', 'Complaint Description', null, null, 'Urgency Level', 'Cause Analysis', null, 'Complaint Resolution Actions', null, 'Completion Date', null, 'Status']
    .forEach((h, i) => { if (h) jun.getCell(r, i + 1).value = h; });
  r += 1;
  const complaintRow = (date: string, client: string, uid: number, account: number | string, platform: string, desc: string, status: string, done: string | null) => {
    jun.getCell(r, 1).value = d(date); jun.getCell(r, 2).value = client; jun.getCell(r, 3).value = uid; jun.getCell(r, 4).value = account;
    jun.getCell(r, 5).value = platform; jun.getCell(r, 6).value = desc; jun.mergeCells(r, 6, r, 8); jun.getCell(r, 9).value = 'High';
    jun.getCell(r, 10).value = 'Cause text'; jun.getCell(r, 12).value = 'Resolution text';
    if (done) jun.getCell(r, 14).value = d(done);
    jun.getCell(r, 16).value = status; r += 1;
  };
  complaintRow('2026-06-02', 'Client One', 1000001, 2000001, 'Mt5', 'Order executed at a different price', 'Solved ', '2026-06-03');
  complaintRow('2026-06-04', 'Client Two', 1000002, 'DEMO-ACC-0002', 'Apps', 'Stop out question', 'on Progress', null);
  complaintRow('2026-06-04', 'Client Two', 1000002, 'DEMO-ACC-0002', 'Apps', 'Stop out question', 'on Progress', null); // duplicate in file
  r += 1;
  jun.getCell(r, 3).value = 'Footnote text merged over the table'; jun.mergeCells(r, 3, r, 16); r += 1;
  for (const [label, value] of [['Total Complaint', 3], ['Complaint resolved', 1], ['Complaints resolved as per SLA', 1], ['Complaint Closed Rate', 0.33]] as const) {
    jun.getCell(r, 1).value = label; jun.getCell(r, 3).value = value; r += 1;
  }

  // --- Sheet 2: "Jul 2026": repeats 29 Jun (same values), then a copied week.
  const jul = wb.addWorksheet('Jul 2026');
  r = writeWeek(jul, 1, '29th June to 3th July', 4, [
    { date: '2026-06-29', rows: [{ name: 'Agent Alpha', values: vals(40) }, { name: 'Agent Bravo', values: vals(41) }, { name: 'Agent Charlie', values: vals(42) }] },
  ], []);
  r = writeWeek(jul, r, '6th July to 10th July', 4, [
    { date: '2026-07-06', rows: [{ name: 'Agent Alpha', values: vals(50) }, { name: 'Agent Bravo', values: vals(51) }] },
  ], [['Social Media', 'Reward program', 'Bonus rules']]);
  // Copied block: label says 13-17 July but the rows repeat 6 July.
  r = writeWeek(jul, r, '13th July to 17th July', 2, [
    { date: '2026-07-06', rows: [{ name: 'Agent Alpha', values: vals(60) }, { name: 'Agent Bravo', values: vals(61) }] },
  ], []);
  // Label typo only (no repeat): label says 1-2 Oct, rows are 20 July. Row dates win.
  r = writeWeek(jul, r, '1th October to 2th October', 4, [
    { date: '2026-07-20', rows: [{ name: 'Agent Alpha', values: vals(70) }] },
  ], []);
  jul.getCell(r, 1).value = 'Report Complaint'; r += 1;
  ['Date', 'Client Name', 'UID', 'Account', 'Platform', 'Complaint Description', null, null, 'Cause Analysis', null, 'Complaint Resolution Actions', null, 'Completion Date', null, 'Status', 'Category']
    .forEach((h, i) => { if (h) jul.getCell(r, i + 1).value = h; });
  r += 1;
  jul.getCell(r, 1).value = d('2026-07-07'); jul.getCell(r, 2).value = 'Client Three'; jul.getCell(r, 3).value = 1000003; jul.getCell(r, 4).value = 2000003;
  jul.getCell(r, 5).value = 'MT5'; jul.getCell(r, 6).value = 'Slippage on news'; jul.getCell(r, 9).value = 'Market gap'; jul.getCell(r, 11).value = 'Explained';
  jul.getCell(r, 13).value = d('2026-07-08'); jul.getCell(r, 15).value = 'Solved'; jul.getCell(r, 16).value = 'Execution & Slippage Issues'; r += 2;
  jul.getCell(r, 1).value = 'Total Complaint'; jul.getCell(r, 3).value = 1;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
