import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { syntheticComplaints, syntheticEntries, syntheticNotes } from './fixtures/cs-report-docx';
import { buildCsDocx, complaintGroupRows, csDocxFileName, weeklyBreakdown } from '../src/lib/cs-report/docx-export';
import { buildCsDashboard, complaintKpis } from '../src/lib/cs-report/metrics';
import { readPeriodKind } from '../src/lib/cs-report/http';

const october = () => buildCsDashboard({ from: '2026-10-01', to: '2026-10-31', entries: syntheticEntries(), complaints: syntheticComplaints(), notes: syntheticNotes() });

async function documentXml(buffer: Buffer): Promise<{ document: string; header: string; footer: string }> {
  const zip = await JSZip.loadAsync(buffer);
  const document = await zip.file('word/document.xml')?.async('string');
  const header = await zip.file('word/header1.xml')?.async('string');
  const footer = await zip.file('word/footer1.xml')?.async('string');
  assert.ok(document && header && footer);
  return { document, header, footer };
}

const text = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join(' ');

test('the CS docx is a Word file with the Settlement/Onboarding layout and every section', async () => {
  const dashboard = october();
  const buffer = await buildCsDocx(dashboard, { kind: 'month', agentName: null, generatedAt: '2026-11-26 14:00 WIB' });
  const { document, header, footer } = await documentXml(buffer);
  assert.match(document, /w:val="Heading1"/);
  assert.match(document, /w:val="Heading2"/);
  assert.match(document, /<w:tbl[\s>]/);
  assert.match(document, /w:fill="1D4ED8"/, 'blue table header like the other exports');
  assert.doesNotMatch(document, /<w:drawing[\s>]/);
  assert.match(header, /Monthly CS Report/);
  assert.match(footer, /PAGE/);
  assert.match(footer, /NUMPAGES/);
  const body = text(document);
  for (const section of ['Monthly CS Report', 'REPORT PERIOD', 'All agents', 'KPI summary', 'Highlights', 'Attendance', 'Channels', 'Inquiry categories',
    'Per agent', 'Weekly breakdown', 'Daily breakdown', 'Complaints', 'By category', 'By urgency', 'By status', 'Complaint cases', 'Notes',
    'Most frequently asked questions', 'Most difficult questions', 'Unsolved issues and customer UIDs', 'Footnotes']) {
    assert.ok(body.includes(section), `missing section: ${section}`);
  }
  for (const name of ['Alya Test', 'Bima Test', 'Citra Test', 'Client Three', 'How long does a withdrawal take?']) assert.ok(body.includes(name), name);
});

test('the docx shows the dashboard figures, not re-computed ones', async () => {
  const dashboard = october();
  const k = dashboard.kpis;
  const body = text((await documentXml(await buildCsDocx(dashboard, { kind: 'month', agentName: null }))).document);
  assert.ok(body.includes(k.conversations.toLocaleString('en-US')), 'total conversations');
  assert.ok(body.includes(`within ${k.followUpMinutes.join(' / ')} minutes`));
  // 6 cases: 4 solved, 1 solved with SLA No, 1 solved without a flag counts as met.
  assert.deepEqual(complaintKpis(dashboard.complaints), k.complaints);
  assert.equal(k.complaints.total, 6);
  assert.equal(k.complaints.resolved, 4);
  assert.equal(k.complaints.resolvedWithinSla, 3);
  assert.ok(body.includes('1 without an SLA flag counted as met'));
  assert.ok(body.includes('66.7%'), 'closed rate 4/6');
  assert.ok(body.includes('75.0%'), 'SLA met rate 3/4');
});

test('weekly breakdown sums to the period totals and complaint groups use complaintKpis', () => {
  const dashboard = october();
  const weeks = weeklyBreakdown(dashboard);
  assert.equal(weeks[0].from, '2026-10-01');
  assert.equal(weeks.at(-1)!.to, '2026-10-31');
  assert.equal(weeks.reduce((s, w) => s + w.kpis.conversations, 0), dashboard.kpis.conversations);
  assert.equal(weeks.reduce((s, w) => s + w.kpis.entries, 0), dashboard.kpis.entries);
  assert.equal(weeks.reduce((s, w) => s + w.kpis.complaints.total, 0), dashboard.kpis.complaints.total);
  const byCategory = complaintGroupRows(dashboard.complaints, 'Category', c => c.category);
  assert.deepEqual(byCategory[1], ['Deposit/Withdraw', 2, 1, 1, 1, '50.0%']);
  assert.deepEqual(byCategory.at(-1), ['Total', 6, 4, 3, 2, '66.7%']);
});

test('agent filter, day period and empty period', async () => {
  const entries = syntheticEntries().filter(e => e.agentId === 'agent-a');
  const complaints = syntheticComplaints().filter(c => c.agentId === 'agent-a');
  const one = buildCsDashboard({ from: '2026-10-01', to: '2026-10-31', entries, complaints, notes: [] });
  const body = text((await documentXml(await buildCsDocx(one, { kind: 'week', agentName: 'Alya Test' }))).document);
  assert.ok(body.includes('Agent: Alya Test'));
  assert.ok(!body.includes('Bima Test'));
  assert.equal(csDocxFileName(one, { kind: 'month', agentName: 'Alya Test' }), 'cs-report-monthly-2026-10-01_2026-10-31-alya-test.docx');
  assert.equal(csDocxFileName(one, { kind: 'custom', agentName: null }), 'cs-report-custom-2026-10-01_2026-10-31.docx');

  const day = buildCsDashboard({ from: '2026-10-02', to: '2026-10-02', entries: syntheticEntries(), complaints: syntheticComplaints(), notes: [] });
  const dayBody = text((await documentXml(await buildCsDocx(day, { kind: 'day', agentName: null }))).document);
  assert.ok(dayBody.includes('Daily CS Report'));
  assert.ok(!dayBody.includes('Weekly breakdown'));

  const empty = buildCsDashboard({ from: '2026-12-01', to: '2026-12-31', entries: [], complaints: [], notes: [] });
  const emptyBody = text((await documentXml(await buildCsDocx(empty, { kind: 'month', agentName: null }))).document);
  assert.ok(emptyBody.includes('No CS data in this period.'));
  assert.ok(emptyBody.includes('No complaints in this period.'));
});

test('readPeriodKind accepts presets and falls back to custom', () => {
  assert.equal(readPeriodKind(new URLSearchParams('kind=month')), 'month');
  assert.equal(readPeriodKind(new URLSearchParams('kind=year')), 'custom');
  assert.equal(readPeriodKind(new URLSearchParams('')), 'custom');
});
