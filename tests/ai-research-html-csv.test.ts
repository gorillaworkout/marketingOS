import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { CSV_BOM, csvEntryName, csvField, rowsToCsv } from '../src/lib/ai-research-csv';
import { convertHtmlToCsv } from '../src/lib/ai-research-html-convert';
import { decodeHtmlBytes, sanitizeHtml } from '../src/lib/ai-research-html';
import {
  HtmlFileError,
  convertUpload,
  createHtmlUpload,
  prepareHtmlUpload,
  readConvertBody,
  readRawUploadName,
  type HtmlFileDeps,
  type HtmlUploadRecord,
} from '../src/lib/ai-research-html-uploads';
import { createExcelExport, parseExcelExportRequest } from '../src/lib/ai-research-excel-export';
import { hydrateMessageFiles } from '../src/lib/ai-research-files';
import { parseAiResearchChatBody } from '../src/lib/ai-research-request';
import { validateExportAttachments, validateFileAttachment, type AiResearchChatMessage } from '../src/lib/ai-research';

const TWO_TABLES = `<html><head><title>Desk</title></head><body>
<h1>Prices</h1>
<table><caption>Metals, "spot"</caption><tr><th>Product</th><th>Price</th></tr><tr><td>Gold</td><td>Rp 15.000</td></tr><tr><td>Silver, fine</td><td>=1+2</td></tr></table>
<table><caption>Energy</caption><tr><th>Product</th><th>Note</th></tr><tr><td>Oil</td><td>Line one
line two</td></tr></table>
</body></html>`;

const ONE_TABLE = `<table><tr><th>Name</th><th>Kota</th></tr><tr><td>Budi</td><td>Jakarta Selatan</td></tr><tr><td>Siti "Ani"</td><td>Bandung</td></tr></table>`;
const NO_TABLES = `<html><head><title>Notes</title></head><body><h1>Morning Notes</h1><p>First, paragraph.</p></body></html>`;

/** Minimal RFC 4180 parser for reading the output back. */
function parseCsv(text: string): string[][] {
  assert.ok(text.startsWith(CSV_BOM), 'CSV starts with a UTF-8 BOM');
  const body = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quoted) {
      if (char === '"' && body[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\r' && body[index + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; index += 1; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test('csvField quotes commas, quotes, line breaks, and edge spaces, and neutralizes formulas', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line\nbreak'), '"line\nbreak"');
  assert.equal(csvField(' padded'), '" padded"');
  assert.equal(csvField('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(csvField('@cmd'), "'@cmd");
  assert.equal(csvField('-5'), '-5');
  assert.equal(csvField('-1.234,5'), '"-1.234,5"');
  assert.equal(csvField('-cmd'), "'-cmd");
  assert.equal(csvField(null), '');
  const csv = rowsToCsv([['a', 'b'], ['1']]);
  assert.equal(csv, `${CSV_BOM}a,b\r\n1,\r\n`);
  const used = new Set<string>();
  assert.equal(csvEntryName('Metals, "spot"', used), 'Metals spot.csv');
  assert.equal(csvEntryName('Metals spot', used), 'Metals spot (2).csv');
  assert.equal(csvEntryName('../../etc', used), '.. .. etc.csv');
});

test('CSV: one table becomes a single UTF-8 .csv with proper quoting', async () => {
  const result = await convertHtmlToCsv(sanitizeHtml(ONE_TABLE));
  assert.equal(result.extension, undefined);
  assert.equal(result.sheetCount, 1);
  assert.equal(result.rowCount, 2);
  const rows = parseCsv(result.data.toString('utf8'));
  assert.deepEqual(rows, [['Name', 'Kota'], ['Budi', 'Jakarta Selatan'], ['Siti "Ani"', 'Bandung']]);
});

test('CSV: several tables become a .zip with one CSV per table, named after the sheets', async () => {
  const result = await convertHtmlToCsv(sanitizeHtml(TWO_TABLES));
  assert.equal(result.extension, 'zip');
  assert.equal(result.mimeType, 'application/zip');
  assert.equal(result.sheetCount, 2);
  const zip = await JSZip.loadAsync(result.data);
  const names = Object.keys(zip.files).sort();
  assert.equal(names.length, 2);
  assert.ok(names.every(name => name.endsWith('.csv') && !name.includes('/')));
  const metals = names.find(name => name.startsWith('Metals'))!;
  const energy = names.find(name => name.startsWith('Energy'))!;
  const metalsRows = parseCsv(await zip.file(metals)!.async('string'));
  assert.deepEqual(metalsRows[0], ['Product', 'Price']);
  assert.deepEqual(metalsRows[2], ['Silver, fine', "'=1+2"]);
  const energyRows = parseCsv(await zip.file(energy)!.async('string'));
  assert.match(energyRows[1][1], /Line one\s+line two/);
});

test('CSV: a chosen table gives a single CSV; an unknown table is rejected', async () => {
  const result = await convertHtmlToCsv(sanitizeHtml(TWO_TABLES), { tableIndex: 1 });
  assert.equal(result.extension, undefined);
  assert.match(result.tableName || '', /^Energy/);
  assert.equal(parseCsv(result.data.toString('utf8'))[0][1], 'Note');
  await assert.rejects(convertHtmlToCsv(sanitizeHtml(TWO_TABLES), { tableIndex: 5 }), RangeError);
});

test('CSV: no tables gives a two-column Type,Text CSV', async () => {
  const result = await convertHtmlToCsv(sanitizeHtml(NO_TABLES));
  assert.equal(result.textBlocks, true);
  const rows = parseCsv(result.data.toString('utf8'));
  assert.deepEqual(rows[0], ['Type', 'Text']);
  assert.deepEqual(rows[1], ['Heading 1', 'Morning Notes']);
  assert.deepEqual(rows[2], ['Paragraph', 'First, paragraph.']);
});

function fakeStore(conversations: Record<string, AiResearchChatMessage[]> = {}) {
  const uploads = new Map<string, HtmlUploadRecord>();
  const exports: Array<{ kind: string; mimeType: string; filename: string; data: Buffer }> = [];
  let counter = 0;
  const deps: HtmlFileDeps = {
    insertUpload: async row => { uploads.set(row.id, row); },
    loadUpload: async (userId, id) => {
      const row = uploads.get(id);
      return row && row.userId === userId ? row : null;
    },
    linkUpload: async () => {},
    loadConversation: async (_userId, id) => (conversations[id] ? { messages: conversations[id] } : null),
    createConversation: async (_userId, id, messages) => { conversations[id] = messages; },
    saveConversationMessages: async (_userId, id, messages) => { conversations[id] = messages; },
    saveExport: async row => { exports.push(row); },
    newId: () => `id-${String(++counter).padStart(8, '0')}`,
  };
  return { deps, uploads, exports, conversations };
}

const dataUrl = (html: string) => `data:text/html;base64,${Buffer.from(html).toString('base64')}`;

test('Convert to CSV delivers a card: .csv for one table, .zip for several, chosen table by index', async () => {
  const store = fakeStore();
  const one = await createHtmlUpload('u1', { name: 'people.html', dataUrl: dataUrl(ONE_TABLE) }, store.deps);
  const single = await convertUpload('u1', { uploadId: one.id, format: 'csv' }, store.deps);
  assert.equal(single.attachment.kind, 'csv');
  assert.equal(single.attachment.filename, 'people.csv');
  assert.equal(store.exports[0].kind, 'convert-csv');
  assert.equal(store.exports[0].mimeType, 'text/csv; charset=utf-8');
  assert.match(single.appended.at(-1)?.content || '', /^Converted people\.html to CSV\./);

  const two = await createHtmlUpload('u1', { name: 'desk.html', dataUrl: dataUrl(TWO_TABLES) }, store.deps);
  const zipped = await convertUpload('u1', { uploadId: two.id, format: 'csv' }, store.deps);
  assert.equal(zipped.attachment.kind, 'zip');
  assert.equal(zipped.attachment.filename, 'desk.zip');
  assert.equal(store.exports[1].mimeType, 'application/zip');
  assert.equal(store.exports[1].kind, 'convert-csv');
  assert.match(zipped.appended.at(-1)?.content || '', /2 tables, one CSV file each in a \.zip/);

  const chosen = await convertUpload('u1', { uploadId: two.id, format: 'csv', tableIndex: 1 }, store.deps);
  assert.equal(chosen.attachment.kind, 'csv');
  assert.match(chosen.attachment.filename, /^desk-Energy.*\.csv$/);
  await assert.rejects(convertUpload('u1', { uploadId: two.id, format: 'csv', tableIndex: 9 }, store.deps), HtmlFileError);
});

test('convert request accepts csv and a table index', () => {
  assert.deepEqual(readConvertBody({ uploadId: 'abcd-1234-efgh', format: 'csv', tableIndex: 2 }), {
    uploadId: 'abcd-1234-efgh', format: 'csv', conversationId: null, projectId: null, tableIndex: 2,
  });
  assert.equal(readConvertBody({ uploadId: 'abcd-1234-efgh', format: 'pdf', tableIndex: 2 }).tableIndex, undefined);
  assert.throws(() => readConvertBody({ uploadId: 'abcd-1234-efgh', format: 'csv', tableIndex: -1 }), /table was not found/);
  assert.throws(() => readConvertBody({ uploadId: 'abcd-1234-efgh', format: 'rtf' }), /Excel, CSV, PDF, or Word/);
});

test('Extract can write CSV instead of Excel', async () => {
  const store = fakeStore();
  const upload = await createHtmlUpload('u1', { name: 'desk.html', dataUrl: dataUrl(TWO_TABLES) }, store.deps);
  const request = parseExcelExportRequest({ uploadId: upload.id, mode: 'extract', instruction: 'product and price', output: 'csv' });
  assert.equal(request.output, 'csv');
  const result = await createExcelExport('u1', request, {
    ...store.deps,
    generateJson: async () => ({ content: JSON.stringify({ sheetName: 'Products', columns: ['Product', 'Price'], rows: [['Gold', '15000'], ['Silver, fine', '300']] }) }),
  });
  assert.equal(result.attachment.kind, 'csv');
  assert.match(result.attachment.filename, /\.csv$/);
  assert.equal(store.exports[0].kind, 'extract-csv');
  assert.match(result.message.content, /to CSV\.$/);
  assert.deepEqual(parseCsv(store.exports[0].data.toString('utf8')), [['Product', 'Price'], ['Gold', '15000'], ['Silver, fine', '300']]);
  assert.equal(parseExcelExportRequest({ uploadId: upload.id, mode: 'tables', output: 'csv' }).output, 'xlsx');
});

test('decodeHtmlBytes handles UTF-16 (with and without BOM) and windows-1252 pages from Office "Save as Web Page"', () => {
  const html = '<html><body><p>Harga “emas” naik – €5 café</p></body></html>';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(html, 'utf16le')]);
  assert.match(decodeHtmlBytes(le), /“emas” naik – €5 café/);
  assert.match(decodeHtmlBytes(Buffer.from(html, 'utf16le')), /“emas” naik/);
  const be = Buffer.from(html, 'utf16le').swap16();
  assert.match(decodeHtmlBytes(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), /café/);
  const cp1252 = Buffer.from([
    ...Buffer.from('<html><head><meta http-equiv=Content-Type content="text/html; charset=windows-1252"></head><body><p>'),
    0x93, ...Buffer.from('emas'), 0x94, 0x20, 0x96, 0x20, 0x80, ...Buffer.from('5 caf'), 0xe9,
    ...Buffer.from('</p></body></html>'),
  ]);
  assert.match(decodeHtmlBytes(cp1252), /“emas” – €5 café/);
  // Valid UTF-8 wins over a wrong declared charset.
  const utf8 = Buffer.from('<meta charset="iso-8859-1"><p>café “ok”</p>');
  assert.match(decodeHtmlBytes(utf8), /café “ok”/);
  assert.match(decodeHtmlBytes(Buffer.from('\uFEFF<p>bom</p>')), /^<p>bom/);
});

test('raw-body uploads accept .html/.htm with an empty, generic, or wrong browser MIME type', () => {
  const bytes = Buffer.from('<h1>Report</h1><p>Body text here.</p>');
  for (const [name, mimeType] of [
    ['a.html', 'text/html'], ['a.htm', ''], ['a.HTM', 'application/octet-stream'], ['a.html', 'text/plain'], ['page', 'text/html; charset=utf-8'],
  ] as const) {
    const prepared = prepareHtmlUpload({ name, bytes, mimeType });
    assert.match(prepared.extractedText, /Report/, `${name} (${mimeType || 'no type'})`);
  }
  assert.throws(() => prepareHtmlUpload({ name: 'notes.txt', bytes, mimeType: 'text/plain' }), /Only \.html and \.htm/);
  assert.throws(() => prepareHtmlUpload({ name: 'a.html', bytes: Buffer.alloc(0), mimeType: 'text/html' }), /empty/);
  assert.equal(readRawUploadName('/api/ai-research/uploads?name=Laporan%20Q3.htm'), 'Laporan Q3.htm');
  assert.equal(readRawUploadName('/api/ai-research/uploads?name=..%2F..%2Fx.html'), '.. .. x.html');
});

test('a stored HTML upload can be sent by reference and is hydrated from the upload', async () => {
  const store = fakeStore();
  const upload = await createHtmlUpload('u1', { name: 'desk.html', dataUrl: dataUrl(TWO_TABLES) }, store.deps);
  const file = validateFileAttachment({ mimeType: 'text/html', name: 'desk.html', uploadId: upload.id });
  assert.deepEqual(file, { mimeType: 'text/html', name: 'desk.html', uploadId: upload.id });
  const body = parseAiResearchChatBody({ messages: [{ role: 'user', content: 'Summarize', files: [{ mimeType: 'text/html', name: 'desk.html', uploadId: upload.id }] }] });
  const loadUpload = async (id: string) => {
    const row = await store.deps.loadUpload('u1', id);
    return row ? { extractedText: row.extractedText, tables: row.tables } : null;
  };
  const [message] = await hydrateMessageFiles(body.messages, { loadUpload });
  assert.match(message.files?.[0].extractedText || '', /Prices/);
  assert.equal(message.files?.[0].tables?.length, 2);
  assert.equal(message.files?.[0].uploadId, upload.id);
  await assert.rejects(
    hydrateMessageFiles([{ role: 'user', content: 'x', files: [{ mimeType: 'text/html', name: 'gone.html', uploadId: 'missing-123456' }] }], { loadUpload }),
    /no longer available/,
  );
  assert.throws(() => validateFileAttachment({ mimeType: 'application/pdf', name: 'a.pdf', uploadId: upload.id }), /missing file data/);
});

test('CSV and ZIP attachment cards survive normalization', () => {
  const attachments = validateExportAttachments([
    { kind: 'csv', exportId: 'export-123456', filename: 'a.csv', source: 'convert', sheetCount: 1, rowCount: 3 },
    { kind: 'zip', exportId: 'export-654321', filename: 'a.zip', source: 'convert', sheetCount: 2, rowCount: 5 },
  ]);
  assert.deepEqual(attachments.map(item => item.kind), ['csv', 'zip']);
});

test('UI: CSV in the Convert menu, table choice, extract output, and send-flow fixes', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  const menu = read('src/components/AiResearchHtmlConvertMenu.tsx');
  assert.match(menu, /'CSV \(\.csv\)'/);
  assert.match(menu, /All tables \(\.zip\)/);
  assert.match(menu, /tableIndex/);
  const actions = read('src/components/AiResearchHtmlExcelActions.tsx');
  assert.match(actions, /<option value="csv">CSV<\/option>/);
  assert.match(actions, /output: mode === 'extract' \? extractOutput : undefined/);
  assert.match(actions, /Retry/);
  const card = read('src/components/AiResearchExcelAttachment.tsx');
  assert.match(card, /CSV file/);
  assert.match(card, /ZIP of CSV files/);
  const page = read('src/app/dashboard/ai-research/page.tsx');
  // Ids no longer repeat when the same file is attached again.
  assert.doesNotMatch(page, /id: `\$\{file\.name\}-\$\{file\.size\}-\$\{file\.lastModified\}-\$\{next\.length\}`/);
  assert.match(page, /id: nextPendingAttachmentId\(file\)/);
  assert.match(page, /HTML_UPLOAD_TIMEOUT_MS/);
  assert.match(page, /controller\.abort\(\)/);
  assert.match(page, /body: file,/);
  assert.match(page, /'X-AI-Research-Upload': '1'/);
  assert.match(read('src/app/api/ai-research/uploads/route.ts'), /x-ai-research-upload/);
  assert.match(page, /uploadId: item\.uploadId,/);
  assert.match(page, /requestErrorMessage\(res\.status/);
  assert.match(page, /PowerPoint, and HTML/);
});

test('migration 034 widens the export kinds for CSV', () => {
  const sql = readFileSync('db/migrations/034_ai_research_exports_csv.sql', 'utf8');
  assert.match(sql, /'extract-csv'/);
  assert.match(sql, /'convert-csv'/);
  assert.match(sql, /'convert-xlsx', 'convert-pdf', 'convert-docx'/);
});
