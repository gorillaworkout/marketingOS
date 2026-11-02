import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, defaultGranularity, monthWeekBuckets, reportBuckets, resolvePeriod, shiftAnchor, weekdayOf,
} from '../src/lib/monthly-report/periods';

const ranges = (buckets: Array<{ from: string; to: string }>) => buckets.map(b => `${b.from.slice(5)}..${b.to.slice(5)}`);

test('date helpers work on plain YYYY-MM-DD strings', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(weekdayOf('2026-10-01'), 4); // Thursday (Mon=1..Sun=7)
  assert.equal(weekdayOf('2026-11-01'), 7);
});

test('October 2026 weeks match the PPT: 1-11, 12-18, 19-25, 26-31', () => {
  const weeks = monthWeekBuckets('2026-10');
  assert.deepEqual(ranges(weeks), ['10-01..10-11', '10-12..10-18', '10-19..10-25', '10-26..10-31']);
  assert.deepEqual(weeks.map(w => w.label), ['Week I (01-11)', 'Week II (12-18)', 'Week III (19-25)', 'Week IV (26-31)']);
});

test('a short last partial week (< 4 days) merges into the previous week', () => {
  // Nov 2026: Sun 1 merges forward, Mon 30 merges back.
  assert.deepEqual(ranges(monthWeekBuckets('2026-11')), ['11-01..11-08', '11-09..11-15', '11-16..11-22', '11-23..11-30']);
});

test('a month that starts on Monday and ends on Sunday has clean weeks', () => {
  assert.deepEqual(ranges(monthWeekBuckets('2027-02')), ['02-01..02-07', '02-08..02-14', '02-15..02-21', '02-22..02-28']);
});

test('cross-month ranges use per-month weeks clipped to the range', () => {
  const buckets = reportBuckets('2026-10-15', '2026-11-10', 'week');
  assert.deepEqual(ranges(buckets), ['10-15..10-18', '10-19..10-25', '10-26..10-31', '11-01..11-08', '11-09..11-10']);
  assert.ok(buckets.every(b => b.from <= b.to));
});

test('daily and monthly buckets', () => {
  assert.equal(reportBuckets('2026-10-01', '2026-10-31', 'day').length, 31);
  const months = reportBuckets('2026-01-01', '2026-12-31', 'month');
  assert.equal(months.length, 12);
  assert.deepEqual(months[9], { key: '2026-10', from: '2026-10-01', to: '2026-10-31', label: 'Oct 2026' });
});

test('presets resolve to inclusive WIB date ranges', () => {
  assert.deepEqual(resolvePeriod({ preset: 'day', anchor: '2026-10-26' }).range, { from: '2026-10-26', to: '2026-10-26' });
  assert.deepEqual(resolvePeriod({ preset: 'week', anchor: '2026-10-03' }).range, { from: '2026-10-01', to: '2026-10-11' });
  assert.deepEqual(resolvePeriod({ preset: 'week', anchor: '2026-10-27' }).range, { from: '2026-10-26', to: '2026-10-31' });
  assert.deepEqual(resolvePeriod({ preset: 'month', anchor: '2026-10-15' }).range, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(resolvePeriod({ preset: '3m', anchor: '2026-10-15' }).range, { from: '2026-08-01', to: '2026-10-31' });
  assert.deepEqual(resolvePeriod({ preset: 'year', anchor: '2026-10-15' }).range, { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(resolvePeriod({ preset: 'custom', from: '2026-10-05', to: '2026-10-09' }).range, { from: '2026-10-05', to: '2026-10-09' });
});

test('previous period has the same shape and navigation moves one period', () => {
  assert.deepEqual(resolvePeriod({ preset: 'month', anchor: '2026-10-15' }).previous, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(resolvePeriod({ preset: 'week', anchor: '2026-10-12' }).previous, { from: '2026-10-01', to: '2026-10-11' });
  assert.deepEqual(resolvePeriod({ preset: 'week', anchor: '2026-10-05' }).previous, { from: '2026-09-21', to: '2026-09-30' });
  assert.deepEqual(resolvePeriod({ preset: 'custom', from: '2026-10-05', to: '2026-10-09' }).previous, { from: '2026-09-30', to: '2026-10-04' });
  assert.equal(shiftAnchor({ preset: 'month', anchor: '2026-10-31' }, -1).anchor, '2026-09-30');
  assert.equal(shiftAnchor({ preset: 'week', anchor: '2026-10-03' }, 1).anchor, '2026-10-12');
  assert.equal(shiftAnchor({ preset: 'week', anchor: '2026-10-12' }, -1).anchor, '2026-10-01');
  assert.equal(shiftAnchor({ preset: '3m', anchor: '2026-10-15' }, -1).anchor, '2026-07-15');
  assert.equal(shiftAnchor({ preset: 'year', anchor: '2026-10-15' }, 1).anchor, '2027-10-15');
  assert.equal(shiftAnchor({ preset: 'day', anchor: '2026-10-31' }, 1).anchor, '2026-11-01');
  const custom = shiftAnchor({ preset: 'custom', from: '2026-10-05', to: '2026-10-09' }, 1);
  assert.deepEqual([custom.from, custom.to], ['2026-10-10', '2026-10-14']);
});

test('default granularity per preset', () => {
  assert.equal(defaultGranularity('day'), 'day');
  assert.equal(defaultGranularity('week'), 'day');
  assert.equal(defaultGranularity('month'), 'week');
  assert.equal(defaultGranularity('3m'), 'week');
  assert.equal(defaultGranularity('year'), 'month');
  assert.equal(defaultGranularity('custom'), 'week');
});

test('invalid input is rejected', () => {
  assert.throws(() => resolvePeriod({ preset: 'custom', from: '2026-10-10', to: '2026-10-01' }), /from/);
  assert.throws(() => resolvePeriod({ preset: 'month', anchor: '2026-13-01' }), /date/);
  assert.throws(() => resolvePeriod({ preset: 'custom', from: '2020-01-01', to: '2026-01-01' }), /366/);
});
