import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as XLSX from 'xlsx';
import {
  SHEETJS_ZIP_SIZE_NOISE,
  readSheetRows,
  withSilencedSheetJsZipNoise,
} from '../src/lib/monthly-report/xlsx-read';

describe('SheetJS ZIP size noise', () => {
  it('matches the known SheetJS warn_or_throw messages', () => {
    assert.equal(SHEETJS_ZIP_SIZE_NOISE.test('Bad uncompressed size: 33414625 != 0'), true);
    assert.equal(SHEETJS_ZIP_SIZE_NOISE.test('Bad compressed size: 123 != 0'), true);
    assert.equal(SHEETJS_ZIP_SIZE_NOISE.test('Bad CRC32 checksum: 1 != 2'), false);
    assert.equal(SHEETJS_ZIP_SIZE_NOISE.test('something else'), false);
  });

  it('withSilencedSheetJsZipNoise drops size warnings and keeps other errors', () => {
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      seen.push(args.map(String).join(' '));
    };
    try {
      withSilencedSheetJsZipNoise(() => {
        console.error('Bad uncompressed size: 33414625 != 0');
        console.error('Bad compressed size: 9 != 0');
        console.error('keep me');
      });
    } finally {
      console.error = original;
    }
    assert.deepEqual(seen, ['keep me']);
  });

  it('readSheetRows still returns rows for a normal workbook', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['A', 'B'], [1, 2]]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const { rows } = readSheetRows(buffer);
    assert.deepEqual(rows, [['A', 'B'], [1, 2]]);
  });

  it('readSheetRows on a Metabase-style export does not emit Bad uncompressed size', () => {
    // Sep user_approved (~3.3 MB) is known to trigger SheetJS size noise; keep the
    // fixture optional so CI without the local monthly-report dump still passes.
    const path = '/workspace/monthly-report/daily-2026-11-05/01M6MXP9531QVY6GER3JXKNV86.xlsx';
    let buffer: Buffer;
    try {
      buffer = readFileSync(path);
    } catch {
      return;
    }
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      seen.push(args.map(String).join(' '));
    };
    try {
      const { rows } = readSheetRows(buffer, undefined, { maxRows: 5 });
      assert.ok(rows.length >= 1);
    } finally {
      console.error = original;
    }
    assert.equal(
      seen.some((m) => /Bad (?:un)?compressed size/i.test(m)),
      false,
      `unexpected size noise: ${seen.join(' | ')}`,
    );
  });
});
