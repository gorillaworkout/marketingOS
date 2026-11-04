import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_HISTORY_PAGE_SIZE, MAX_HISTORY_PAGE_SIZE, monthBounds, pageCount, pageOffset, parseUploadHistoryQuery, uploadHistoryWhere,
} from '../src/lib/monthly-report/upload-history';

const parse = (query: string) => parseUploadHistoryQuery(new URLSearchParams(query));

test('history: defaults to page 1 of 25, newest first, no filters', () => {
  assert.deepEqual(parse(''), { page: 1, pageSize: DEFAULT_HISTORY_PAGE_SIZE, kind: null, month: null });
  assert.equal(DEFAULT_HISTORY_PAGE_SIZE, 25);
});

test('history: page size is clamped, invalid values fall back', () => {
  assert.equal(parse('pageSize=500').pageSize, MAX_HISTORY_PAGE_SIZE);
  assert.equal(parse('pageSize=0').pageSize, 1);
  assert.equal(parse('pageSize=abc').pageSize, 25);
  assert.equal(parse('page=-3').page, 1);
  assert.equal(parse('page=4').page, 4);
  assert.equal(parse('kind=settlement').kind, null);
  assert.equal(parse('kind=ftd').kind, 'ftd');
  assert.equal(parse('month=2026-13').month, null);
  assert.equal(parse('month=2026-10').month, '2026-10');
});

test('history: paging offsets and page count (no 100-row cap)', () => {
  assert.equal(pageOffset({ page: 1, pageSize: 25 }), 0);
  assert.equal(pageOffset({ page: 3, pageSize: 25 }), 50);
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageCount(25, 25), 1);
  assert.equal(pageCount(251, 25), 11);
});

test('history: type and data-month filters build parameterized SQL', () => {
  assert.deepEqual(uploadHistoryWhere({ kind: null, month: null }), { sql: '', params: [] });
  assert.deepEqual(uploadHistoryWhere({ kind: 'onboarding', month: null }), { sql: 'WHERE kind = ?', params: ['onboarding'] });
  const both = uploadHistoryWhere({ kind: 'ftd', month: '2026-02' });
  assert.match(both.sql, /^WHERE kind = \? AND COALESCE\(data_from, .+\) <= \?::date AND COALESCE\(data_to, .+\) >= \?::date$/);
  assert.deepEqual(both.params, ['ftd', '2026-02-28', '2026-02-01']);
  assert.match(both.sql, /AT TIME ZONE 'Asia\/Jakarta'/);
  assert.deepEqual(monthBounds('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(monthBounds('2026-10'), { from: '2026-10-01', to: '2026-10-31' });
});

test('history: the uploads API pages with the filters and returns coverage; the page no longer asks for 100 rows', async () => {
  const [route, store, page] = await Promise.all([
    readFile('src/app/api/monthly-report/uploads/route.ts', 'utf8'),
    readFile('src/lib/monthly-report/store.ts', 'utf8'),
    readFile('src/app/dashboard/monthly-report/uploads/page.tsx', 'utf8'),
  ]);
  assert.match(route, /parseUploadHistoryQuery\(request\.nextUrl\.searchParams\)/);
  assert.match(route, /listUploadsPage\(filter\)/);
  assert.match(route, /coverageOverview\(/);
  assert.doesNotMatch(route, /listUploads\(100\)/);
  assert.match(store, /ORDER BY created_at DESC, id DESC LIMIT \? OFFSET \?/);
  assert.match(page, /Choose type manually/);
  assert.match(page, /pageSize: String\(PAGE_SIZE\)/);
});
