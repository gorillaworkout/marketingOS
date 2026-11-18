import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { readSheetRows, readWorkbook, SHEETJS_ZIP_DESCRIPTOR_WARNING } from '../src/lib/monthly-report/xlsx-read';

/** Re-packs a workbook as deflated entries (local-header sizes 0) whose data descriptors carry 8-byte (ZIP64) sizes,
 *  like the back-office exports that trigger SheetJS's `Bad uncompressed size: N != 0`. */
async function zip64DescriptorWorkbook(): Promise<Buffer> {
  const sheet = XLSX.utils.aoa_to_sheet([['User ID', 'Status'], ['u-1', 'approved'], ['u-2', 'pending']]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Data');
  const source = await JSZip.loadAsync(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const name of Object.keys(source.files)) {
    if (source.files[name].dir) continue;
    const data = await source.files[name].async('nodebuffer');
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const packed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(45, 4); local.writeUInt16LE(8, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(nameBytes.length, 26);
    const descriptor = Buffer.alloc(24);
    descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4);
    descriptor.writeBigUInt64LE(BigInt(packed.length), 8); descriptor.writeBigUInt64LE(BigInt(data.length), 16);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(45, 4); central.writeUInt16LE(45, 6);
    central.writeUInt16LE(8, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    const entry = Buffer.concat([local, nameBytes, packed, descriptor]);
    locals.push(entry);
    centrals.push(Buffer.concat([central, nameBytes]));
    offset += entry.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function captureConsoleError<T>(fn: () => T): { result: T; lines: string[] } {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: fn(), lines };
  } finally {
    console.error = original;
  }
}

test('raw SheetJS logs the ZIP64 descriptor warning but still parses the rows', async () => {
  const buffer = await zip64DescriptorWorkbook();
  const { result, lines } = captureConsoleError(() => XLSX.read(buffer, { type: 'buffer' }));
  assert.ok(lines.length > 0, 'fixture should reproduce the prod warning');
  assert.ok(lines.every((line) => SHEETJS_ZIP_DESCRIPTOR_WARNING.test(line)), lines.join('\n'));
  assert.deepEqual(XLSX.utils.sheet_to_json(result.Sheets.Data, { header: 1 }), [['User ID', 'Status'], ['u-1', 'approved'], ['u-2', 'pending']]);
});

test('readSheetRows mutes only that warning and returns the same rows', async () => {
  const buffer = await zip64DescriptorWorkbook();
  const { result, lines } = captureConsoleError(() => readSheetRows(buffer));
  assert.deepEqual(lines, []);
  assert.equal(result.sheetName, 'Data');
  assert.deepEqual(result.rows, [['User ID', 'Status'], ['u-1', 'approved'], ['u-2', 'pending']]);
});

test('readWorkbook keeps other console.error output and restores console.error after a throw', () => {
  const before = console.error;
  const { lines } = captureConsoleError(() => {
    const inner = console.error;
    assert.throws(() => readWorkbook(Buffer.from('PK\u0003\u0004 not a zip'), { type: 'buffer' }));
    assert.equal(console.error, inner);
    console.error('Bad uncompressed size: 10 != 0');
    console.error('something else');
  });
  assert.equal(console.error, before);
  assert.deepEqual(lines, ['Bad uncompressed size: 10 != 0', 'something else']);
  assert.equal(SHEETJS_ZIP_DESCRIPTOR_WARNING.test('Bad uncompressed size: 10 != 9'), false);
});
