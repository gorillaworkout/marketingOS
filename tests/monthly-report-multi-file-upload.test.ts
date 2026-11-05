import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MULTI_UPLOAD_FILES,
  MAX_UPLOAD_BYTES,
  selectUploadFiles,
  validItemsForImport,
} from '../src/lib/monthly-report/multi-file-upload';

function f(name: string, size = 1024) {
  return { name, size };
}

test('selectUploadFiles keeps every file under the cap (fixes files[0]-only drop)', () => {
  const result = selectUploadFiles([], [f('summary.xlsx'), f('user_approved.xlsx')]);
  assert.deepEqual(result.accepted.map(x => x.name), ['summary.xlsx', 'user_approved.xlsx']);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.hitFileCap, false);
});

test('selectUploadFiles appends and skips exact duplicates', () => {
  const existing = [f('a.xlsx', 10)];
  const result = selectUploadFiles(existing, [f('a.xlsx', 10), f('b.xlsx', 20)]);
  assert.deepEqual(result.accepted.map(x => x.name), ['a.xlsx', 'b.xlsx']);
  assert.deepEqual(result.rejected, [{ name: 'a.xlsx', reason: 'Already in the queue' }]);
});

test(`selectUploadFiles rejects files over ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`, () => {
  const result = selectUploadFiles([], [f('huge.xlsx', MAX_UPLOAD_BYTES + 1), f('ok.xlsx', 100)]);
  assert.deepEqual(result.accepted.map(x => x.name), ['ok.xlsx']);
  assert.deepEqual(result.rejected[0], { name: 'huge.xlsx', reason: 'Larger than 25 MB' });
});

test(`selectUploadFiles caps the queue at ${MAX_MULTI_UPLOAD_FILES} files`, () => {
  const existing = Array.from({ length: 9 }, (_, i) => f(`e${i}.xlsx`));
  const incoming = [f('ok.xlsx'), f('overflow.xlsx'), f('overflow2.xlsx')];
  const result = selectUploadFiles(existing, incoming);
  assert.equal(result.accepted.length, 10);
  assert.equal(result.accepted.at(-1)?.name, 'ok.xlsx');
  assert.equal(result.hitFileCap, true);
  assert.deepEqual(result.rejected.map(r => r.name), ['overflow.xlsx', 'overflow2.xlsx']);
  assert.match(result.rejected[0].reason, /Limit is 10/);
});

test('selectUploadFiles honours a custom maxFiles option', () => {
  const result = selectUploadFiles([], [f('a.xlsx'), f('b.xlsx'), f('c.xlsx')], { maxFiles: 2 });
  assert.deepEqual(result.accepted.map(x => x.name), ['a.xlsx', 'b.xlsx']);
  assert.equal(result.hitFileCap, true);
});

test('validItemsForImport returns only ok items without an error', () => {
  const items = [
    { id: '1', ok: true, error: null as string | null },
    { id: '2', ok: false, error: 'bad' },
    { id: '3', ok: true, error: 'weird' },
    { id: '4', ok: true, error: null },
  ];
  assert.deepEqual(validItemsForImport(items).map(i => i.id), ['1', '4']);
});
