import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsDashboard, complaintKpis, isResolvedStatus } from '../src/lib/cs-report/metrics';
import { parseComplaintInput, parseDailyEntryInput } from '../src/lib/cs-report/validate';
import { parseMappingChoice, suggestMappings } from '../src/lib/cs-report/mapping';
import { monthBounds, periodRange, todayWib, weekBounds } from '../src/lib/cs-report/dates';
import { complaintDedupeKey } from '../src/lib/cs-report/dedupe';
import { COUNT_FIELDS } from '../src/lib/cs-report/fields';
import { buildCsWorkbook } from '../src/lib/cs-report/export';
import { parseCsWorkbook } from '../src/lib/cs-report/parse';
import type { Complaint, DailyEntry } from '../src/lib/cs-report/types';

function entry(agent: string, date: string, over: Partial<DailyEntry> = {}): DailyEntry {
  const counts = Object.fromEntries(COUNT_FIELDS.map(f => [f.key, 1])) as Record<string, number>;
  return {
    id: `${agent}-${date}`, agentId: agent, agentName: `Agent ${agent}`, date, status: 'present', unsolvedUids: '', followUpMinutes: 4,
    frequentQuestion: '', difficultQuestion: '', source: 'web', updatedAt: null, ...counts, ...over,
  } as DailyEntry;
}

function complaint(date: string, status: string, slaMet: boolean | null, agentId: string | null = null): Complaint {
  return { id: `${date}-${status}-${slaMet}`, agentId, agentName: agentId, date, clientName: 'C', uid: '1', account: '2', platform: 'MT5', description: 'd', cause: '', resolution: '', completionDate: null, status, slaMet, urgency: '', category: '', source: 'web', createdBy: null, updatedAt: null, updatedByName: null };
}

test('dates: WIB today, week (Mon-Sun), month, custom range', () => {
  assert.equal(todayWib(new Date('2026-11-24T17:30:00Z')), '2026-11-25', '00:30 WIB is already the next day');
  assert.equal(todayWib(new Date('2026-11-24T16:59:00Z')), '2026-11-24');
  assert.deepEqual(weekBounds('2026-11-26'), { from: '2026-11-23', to: '2026-11-29' });
  assert.deepEqual(monthBounds('2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodRange('day', '2026-11-24'), { from: '2026-11-24', to: '2026-11-24' });
  assert.deepEqual(periodRange('custom', '2026-11-24', '2026-11-01'), { from: '2026-11-01', to: '2026-11-24' });
});

test('daily entry validation: present allows blank counts as 0 if at least one is filled, leave makes them optional, no future dates', () => {
  const counts = Object.fromEntries(COUNT_FIELDS.map(f => [f.key, '3']));
  const ok = parseDailyEntryInput({ date: '2026-11-24', status: 'present', ...counts, followUpMinutes: '', frequentQuestion: '  How to deposit? ' }, '2026-11-24');
  assert.ok('value' in ok);
  if ('value' in ok) { assert.equal(ok.value.imReception, 3); assert.equal(ok.value.followUpMinutes, 4); assert.equal(ok.value.frequentQuestion, 'How to deposit?'); }

  assert.equal((parseDailyEntryInput({ date: '2026-11-24', status: 'present' }, '2026-11-24') as { error: string }).error, 'Fill in at least one number before saving.');
  assert.equal((parseDailyEntryInput({ date: '2026-11-24', status: 'present', ...Object.fromEntries(COUNT_FIELDS.map(f => [f.key, ''])) }, '2026-11-24') as { error: string }).error, 'Fill in at least one number before saving.');

  const partial = parseDailyEntryInput({ date: '2026-11-24', status: 'present', imReception: '5' }, '2026-11-24');
  assert.ok('value' in partial);
  if ('value' in partial) {
    assert.equal(partial.value.imReception, 5);
    assert.equal(partial.value.emailReception, 0);
    assert.equal(partial.value.notFollowedUp, 0);
    assert.ok(COUNT_FIELDS.every(f => partial.value[f.key] === (f.key === 'imReception' ? 5 : 0)));
  }

  const allZero = parseDailyEntryInput({ date: '2026-11-24', status: 'present', ...Object.fromEntries(COUNT_FIELDS.map(f => [f.key, 0])) }, '2026-11-24');
  assert.ok('value' in allZero);
  if ('value' in allZero) assert.ok(COUNT_FIELDS.every(f => allZero.value[f.key] === 0));

  const existing = parseDailyEntryInput({ date: '2026-11-24', status: 'present', ...counts, imReception: '', followUpMinutes: 4 }, '2026-11-24');
  assert.ok('value' in existing && existing.value.imReception === 0 && existing.value.callReception === 3);

  const sick = parseDailyEntryInput({ date: '2026-11-24', status: 'sick' }, '2026-11-24');
  assert.ok('value' in sick && sick.value.imReception === null);
  const leave = parseDailyEntryInput({ date: '2026-11-24', status: 'annual_leave', imReception: '2' }, '2026-11-24');
  assert.ok('value' in leave && leave.value.imReception === 2 && leave.value.emailReception === null);

  assert.match((parseDailyEntryInput({ date: '2026-11-25', status: 'sick' }, '2026-11-24') as { error: string }).error, /future/);
  assert.match((parseDailyEntryInput({ date: '2026-11-24', status: 'present', ...counts, callReception: '-1' }, '2026-11-24') as { error: string }).error, /Call Reception/);
  assert.match((parseDailyEntryInput({ date: '2026-11-24', status: 'present', callReception: '-1' }, '2026-11-24') as { error: string }).error, /Call Reception/);
  assert.match((parseDailyEntryInput({ date: '2026-11-24', status: 'away' }, '2026-11-24') as { error: string }).error, /status/);
  assert.match((parseDailyEntryInput({ date: '2026-11-24', status: 'sick', followUpMinutes: 0 }, '2026-11-24') as { error: string }).error, /minutes/);
});

test('complaint validation and dedupe key', () => {
  const ok = parseComplaintInput({ date: '2026-11-20', uid: ' 123 ', description: 'Slippage', completionDate: '2026-11-21', slaMet: 'yes', status: 'Solved' }, '2026-11-24');
  assert.ok('value' in ok && ok.value.uid === '123' && ok.value.slaMet === true);
  assert.match((parseComplaintInput({ date: '2026-11-20', uid: '1' }, '2026-11-24') as { error: string }).error, /Describe/);
  assert.match((parseComplaintInput({ date: '2026-11-20', description: 'x' }, '2026-11-24') as { error: string }).error, /client name or UID/);
  assert.match((parseComplaintInput({ date: '2026-11-20', uid: '1', description: 'x', completionDate: '2026-11-19' }, '2026-11-24') as { error: string }).error, /before/);
  const a = complaintDedupeKey({ date: '2026-11-20', uid: '123', account: 'A1', description: 'Order  slipped' });
  assert.equal(a, complaintDedupeKey({ date: '2026-11-20', uid: ' 123', account: 'a1', description: 'order slipped ' }));
  assert.notEqual(a, complaintDedupeKey({ date: '2026-11-21', uid: '123', account: 'A1', description: 'Order slipped' }));
});

test('complaint KPIs: resolved, within SLA (unknown counts as met), closed rate', () => {
  assert.ok(isResolvedStatus('Solved ') && isResolvedStatus('closed') && !isResolvedStatus('On Progress'));
  const k = complaintKpis([complaint('2026-11-01', 'Solved', true), complaint('2026-11-02', 'Solved', false), complaint('2026-11-03', 'Solved', null), complaint('2026-11-04', 'On Progress', null)]);
  assert.deepEqual(k, { total: 4, resolved: 3, resolvedWithinSla: 2, slaUnknown: 1, open: 1, closedRate: 0.75 });
  assert.equal(complaintKpis([]).closedRate, null);
});

test('dashboard: totals, per-agent leave days, trend, recap totals, questions, range filter', () => {
  const entries = [
    entry('a', '2026-11-23', { imReception: 10, emailReception: null, frequentQuestion: 'Deposit?' }),
    entry('b', '2026-11-23', { status: 'sick', ...Object.fromEntries(COUNT_FIELDS.map(f => [f.key, null])) }),
    entry('a', '2026-11-24', { notFollowedUp: 3, followUpMinutes: 5 }),
    entry('a', '2026-12-01'),
  ];
  const d = buildCsDashboard({ from: '2026-11-23', to: '2026-11-29', entries, complaints: [complaint('2026-11-24', 'Solved', null, 'a'), complaint('2026-12-02', 'Solved', true)], notes: [
    { weekStart: '2026-11-23', weekEnd: '2026-11-27', channel: 'Email', frequentQuestion: 'Withdrawal time', difficultQuestion: '' },
    { weekStart: '2026-11-30', weekEnd: '2026-12-04', channel: 'Email', frequentQuestion: 'out of range', difficultQuestion: '' },
  ] });
  assert.equal(d.kpis.entries, 3);
  assert.equal(d.kpis.channels.imReception, 11);
  assert.equal(d.kpis.channels.emailReception, 1);
  assert.equal(d.kpis.conversations, 10 + 0 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1);
  assert.equal(d.kpis.notFollowedUp, 1 + 3);
  assert.deepEqual(d.kpis.followUpMinutes, [4, 5]);
  assert.equal(d.kpis.sickDays, 1);
  assert.equal(d.kpis.complaints.total, 1);
  assert.equal(d.trend.length, 7);
  assert.equal(d.trend[0].agentsOnLeave, 1);
  const b = d.agents.find(x => x.agentId === 'b')!;
  assert.deepEqual([b.days, b.present, b.sick, b.conversations], [1, 0, 1, 0]);
  assert.equal(d.agents.find(x => x.agentId === 'a')!.complaints, 1);
  assert.equal(d.recap[0].total.imReception, 10);
  assert.deepEqual(d.questions.map(q => q.text).sort(), ['Deposit?', 'Withdrawal time']);
});

test('name mapping: known alias, exact user name, unique first name, otherwise name only', () => {
  const suggestions = suggestMappings(['Agent Alpha', 'Bravo Person', 'Charlie Someone', 'Delta Unknown'],
    [{ id: 'ag1', displayName: 'Alpha', userId: 'u1', aliases: ['agent alpha'] }],
    [{ id: 'u2', name: 'bravo person', username: 'bravo' }, { id: 'u3', name: 'Charlie X', username: 'cx' }]);
  assert.deepEqual(suggestions.map(s => [s.reason, s.target.kind]), [['alias', 'agent'], ['exact', 'user'], ['first-name', 'user'], ['none', 'name']]);
  assert.deepEqual(parseMappingChoice('{"A":"user:u1","B":"name"}'), { A: 'user:u1', B: 'name' });
  assert.ok('error' in (parseMappingChoice('{"A":"drop table"}') as object));
  assert.ok('error' in (parseMappingChoice('not json') as object));
});

test('export uses the workbook layout and parses back to the same rows', async () => {
  const entries = [
    entry('a', '2026-08-31', { agentName: 'Agent Alpha', imReception: 7, emailReception: null }),
    entry('b', '2026-08-31', { agentName: 'Agent Bravo', status: 'annual_leave', ...Object.fromEntries(COUNT_FIELDS.map(f => [f.key, null])) }),
    entry('a', '2026-09-01', { agentName: 'Agent Alpha', followUpMinutes: 5 }),
    entry('b', '2026-09-01', { agentName: 'Agent Bravo', status: 'sick', ...Object.fromEntries(COUNT_FIELDS.map(f => [f.key, null])) }),
    entry('a', '2026-09-07', { agentName: 'Agent Alpha', frequentQuestion: 'How to deposit?' }),
  ];
  const complaints = [{ ...complaint('2026-09-02', 'Solved', true, 'a'), agentName: 'Agent Alpha', category: 'Spread' }];
  const buffer = await buildCsWorkbook({ entries, complaints, notes: [{ weekStart: '2026-08-31', weekEnd: '2026-09-04', channel: 'Email', frequentQuestion: 'Withdrawal time', difficultQuestion: 'Swap' }] });
  const parsed = await parseCsWorkbook(buffer);
  assert.deepEqual(parsed.sheets.map(s => s.sheet), ['Sep 2026'], 'a week belongs to the month of its Thursday');
  assert.equal(parsed.entries.length, 5);
  const back = parsed.entries.find(e => e.name === 'Agent Alpha' && e.date === '2026-08-31')!;
  assert.equal(back.imReception, 7);
  assert.equal(back.emailReception, null);
  assert.equal(parsed.entries.find(e => e.name === 'Agent Bravo' && e.date === '2026-08-31')?.status, 'annual_leave');
  assert.equal(parsed.entries.find(e => e.name === 'Agent Bravo' && e.date === '2026-09-01')?.status, 'sick');
  assert.equal(parsed.complaints.length, 1);
  assert.equal(parsed.complaints[0].slaMet, true);
  assert.equal(parsed.complaints[0].category, 'Spread');
  assert.equal(parsed.notes.find(n => n.channel === 'Email' && n.weekStart === '2026-08-31')?.frequentQuestion, 'Withdrawal time');
  assert.equal(parsed.notes.find(n => n.channel === 'CRM/IM' && n.weekStart === '2026-09-07')?.frequentQuestion, 'How to deposit?', 'daily questions fill the Notes block when no weekly note exists');
  assert.deepEqual(parsed.warnings, []);
});
