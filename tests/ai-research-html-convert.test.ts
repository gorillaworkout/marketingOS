import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { extractText, getDocumentProxy } from 'unpdf';
import { sanitizeHtml } from '../src/lib/ai-research-html';
import { htmlToBlocks, readImageSize } from '../src/lib/ai-research-html-blocks';
import { convertHtml, convertHtmlToDocx, convertHtmlToPdf, convertHtmlToXlsx, pdfSafeText } from '../src/lib/ai-research-html-convert';
import {
  HtmlFileError,
  convertUpload,
  convertedFilename,
  createHtmlUpload,
  readConvertBody,
  type HtmlFileDeps,
  type HtmlUploadRecord,
} from '../src/lib/ai-research-html-uploads';
import { createExcelExport, type ExcelExportDeps } from '../src/lib/ai-research-excel-export';
import { normalizeChatMessage, validateExportAttachments, type AiResearchChatMessage } from '../src/lib/ai-research';

// 1x1 transparent PNG.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const RICH = `<!doctype html><html><head><title>Desk Report</title><script>alert(1)</script></head><body>
<h1>Quarterly Desk Report</h1>
<p>Gold had a <strong>strong</strong> week and <em>oil</em> slipped. <a href="https://example.com/a">Source</a></p>
<h2>Highlights</h2>
<ul><li>Spreads tightened</li><li>Volume up <b>12%</b><ul><li>Mostly XAUUSD</li></ul></li></ul>
<ol><li>Review margins</li><li>Update limits</li></ol>
<img src="data:image/png;base64,${PNG_1PX}" alt="chart">
<img src="https://tracker.example.com/pixel.png" alt="remote">
<table><thead><tr><th>Product</th><th>Price</th></tr></thead>
<tbody><tr><td>Gold</td><td>Rp 15.000</td></tr><tr><td>Oil</td><td>82.5</td></tr></tbody></table>
<h2>Outlook</h2><p>Neutral into the Fed meeting.</p>
</body></html>`;

const NO_TABLES = `<html><head><title>Notes</title></head><body>
<h1>Morning Notes</h1><p>First paragraph.</p><h2>Risks</h2><p>Second paragraph.</p><ul><li>Bullet one</li></ul></body></html>`;

function dataUrl(html: string): string {
  return `data:text/html;base64,${Buffer.from(html).toString('base64')}`;
}

async function readWorkbook(data: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as ArrayBuffer);
  return workbook;
}

async function pdfText(data: Buffer): Promise<{ pages: number; text: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text: Array.isArray(text) ? text.join('\n') : text };
}

test('sanitizer keeps raster data-URI images but strips remote scripts and svg data URIs', () => {
  const out = sanitizeHtml(`<img src="data:image/png;base64,${PNG_1PX}"><img src="data:image/svg+xml;base64,PHN2Zz4="><script>x()</script>`);
  assert.match(out, /data:image\/png;base64/);
  assert.doesNotMatch(out, /svg\+xml/);
  assert.doesNotMatch(out, /<script/);
});

test('htmlToBlocks reads structure, embeds data images, and never fetches remote images', () => {
  const model = htmlToBlocks(sanitizeHtml(RICH));
  assert.equal(model.title, 'Desk Report');
  const types = model.blocks.map(block => block.type);
  assert.ok(types.includes('heading'));
  assert.ok(types.includes('list-item'));
  assert.ok(types.includes('table'));
  assert.ok(types.includes('image'));
  assert.ok(types.includes('image-placeholder'));
  const nested = model.blocks.find(block => block.type === 'list-item' && block.depth === 1);
  assert.ok(nested, 'nested list item keeps its depth');
  assert.deepEqual(readImageSize(Buffer.from(PNG_1PX, 'base64')), { format: 'png', width: 1, height: 1 });
});

test('Excel: one sheet per table, read back with exceljs', async () => {
  const result = await convertHtmlToXlsx(sanitizeHtml(RICH));
  assert.equal(result.sheetCount, 1);
  assert.ok(!result.textBlocks);
  const workbook = await readWorkbook(result.data);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getRow(1).getCell(1).value, 'Product');
  assert.equal(sheet.getRow(2).getCell(1).value, 'Gold');
  assert.equal(sheet.getRow(2).getCell(2).value, 15000);
  assert.equal(sheet.getRow(3).getCell(2).value, 82.5);
});

test('Excel: pages without tables become one sheet of headings and paragraphs, one per row', async () => {
  const result = await convertHtmlToXlsx(sanitizeHtml(NO_TABLES));
  assert.equal(result.textBlocks, true);
  assert.equal(result.sheetCount, 1);
  const workbook = await readWorkbook(result.data);
  assert.equal(workbook.worksheets.length, 1);
  const rows = workbook.worksheets[0].getSheetValues().filter(Boolean) as unknown[][];
  const pairs = rows.map(row => [row[1], row[2]]);
  assert.deepEqual(pairs[0], ['Type', 'Text']);
  assert.deepEqual(pairs[1], ['Heading 1', 'Morning Notes']);
  assert.deepEqual(pairs[2], ['Paragraph', 'First paragraph.']);
  assert.deepEqual(pairs[3], ['Heading 2', 'Risks']);
  assert.ok(pairs.some(pair => pair[0] === 'List item' && pair[1] === 'Bullet one'));
});

test('PDF: valid, non-empty, and contains headings, list text, and table cells', async () => {
  const result = await convertHtmlToPdf(sanitizeHtml(RICH), 'desk.html');
  assert.ok(result.data.length > 1_000);
  assert.equal(result.data.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.match(result.data.subarray(-32).toString('latin1'), /%%EOF\s*$/);
  const { pages, text } = await pdfText(result.data);
  assert.ok(pages >= 1);
  for (const expected of ['Quarterly Desk Report', 'Highlights', 'Spreads tightened', 'Review margins', 'Product', 'Gold', 'Outlook']) {
    assert.ok(text.includes(expected), `PDF text includes ${expected}`);
  }
  assert.ok(result.data.includes(Buffer.from('/Subtype /Image')), 'the data-URI image is embedded');
});

test('PDF: characters outside the standard fonts do not break rendering', async () => {
  assert.equal(pdfSafeText('“Quote” – €5 → done ≥ 3 🚀'), '“Quote” – €5 -> done >= 3 ');
  assert.equal(pdfSafeText('日本'), '??');
  const result = await convertHtmlToPdf('<h1>日本語 ✓ ok</h1><p>Emoji 🚀 text</p>');
  assert.equal(result.data.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('Word: docx contains headings, bold/italic runs, lists, tables, and the image', async () => {
  const result = await convertHtmlToDocx(sanitizeHtml(RICH), 'desk.html');
  assert.equal(result.data.subarray(0, 2).toString('latin1'), 'PK');
  const zip = await JSZip.loadAsync(result.data);
  const xml = await zip.file('word/document.xml')!.async('string');
  assert.match(xml, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(xml, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(xml, /Quarterly Desk Report/);
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /Product/);
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /<w:i\/>/);
  assert.match(xml, /<w:numPr>/);
  assert.ok(Object.keys(zip.files).some(name => name.startsWith('word/media/')), 'image is embedded');
});

test('convertHtml dispatches by format', async () => {
  for (const format of ['xlsx', 'pdf', 'docx'] as const) {
    const result = await convertHtml(sanitizeHtml(NO_TABLES), format, 'notes.html');
    assert.ok(result.data.length > 100, `${format} output is non-empty`);
  }
});

function fakeStore(conversations: Record<string, AiResearchChatMessage[]> = {}) {
  const uploads = new Map<string, HtmlUploadRecord>();
  const exports: Array<{ id: string; kind: string; conversationId: string; mimeType: string; filename: string; data: Buffer }> = [];
  const created: Array<{ id: string; projectId: string | null; messages: AiResearchChatMessage[] }> = [];
  const saved: Array<{ id: string; messages: AiResearchChatMessage[] }> = [];
  let counter = 0;
  const deps: HtmlFileDeps = {
    insertUpload: async row => { uploads.set(row.id, row); },
    loadUpload: async (userId, id) => {
      const row = uploads.get(id);
      return row && row.userId === userId ? row : null;
    },
    linkUpload: async (userId, id, conversationId) => {
      const row = uploads.get(id);
      if (row && row.userId === userId) row.conversationId = conversationId;
    },
    loadConversation: async (_userId, id) => (conversations[id] ? { messages: JSON.parse(JSON.stringify(conversations[id])) } : null),
    createConversation: async (_userId, id, messages, projectId) => {
      created.push({ id, projectId, messages });
      conversations[id] = messages;
    },
    saveConversationMessages: async (_userId, id, messages) => {
      saved.push({ id, messages });
      conversations[id] = messages;
    },
    saveExport: async row => { exports.push(row); },
    newId: () => `id-${String(++counter).padStart(8, '0')}`,
  };
  return { deps, uploads, exports, created, saved, conversations };
}

test('upload is sanitized and stored immediately, with tables and text', async () => {
  const store = fakeStore();
  const upload = await createHtmlUpload('user-1', { name: 'desk.html', dataUrl: dataUrl(RICH) }, store.deps);
  const stored = store.uploads.get(upload.id)!;
  assert.doesNotMatch(stored.sanitizedHtml, /<script/);
  assert.equal(stored.tables.length, 1);
  assert.match(stored.extractedText, /Quarterly Desk Report/);
  assert.equal(stored.title, 'Desk Report');
  await assert.rejects(
    createHtmlUpload('user-1', { name: 'notes.pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }, store.deps),
    HtmlFileError,
  );
});

test('Convert right after upload, with no conversation: creates one with the upload and the file card', async () => {
  const store = fakeStore();
  const upload = await createHtmlUpload('user-1', { name: 'desk.html', dataUrl: dataUrl(RICH) }, store.deps);
  const result = await convertUpload('user-1', { uploadId: upload.id, format: 'pdf', projectId: 'project-1' }, store.deps);
  assert.equal(result.created, true);
  assert.equal(store.created.length, 1);
  assert.equal(store.created[0].projectId, 'project-1');
  assert.equal(result.appended.length, 2);
  assert.equal(result.appended[0].role, 'user');
  assert.equal(result.appended[0].content, 'Uploaded desk.html');
  assert.equal(result.appended[0].files?.[0].uploadId, upload.id);
  assert.equal(result.appended[1].content, 'Converted desk.html to PDF.');
  assert.equal(result.attachment.kind, 'pdf');
  assert.equal(result.attachment.source, 'convert');
  assert.equal(result.attachment.filename, 'desk.pdf');
  assert.equal(store.exports[0].kind, 'convert-pdf');
  assert.equal(store.exports[0].mimeType, 'application/pdf');
  assert.equal(store.exports[0].conversationId, result.conversationId);
  assert.equal(store.uploads.get(upload.id)!.conversationId, result.conversationId);
});

test('Convert into an existing conversation appends; a second format does not repeat the upload message', async () => {
  const store = fakeStore({ 'conv-1': [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }] });
  const upload = await createHtmlUpload('user-1', { name: 'desk.html', dataUrl: dataUrl(RICH) }, store.deps);
  const first = await convertUpload('user-1', { uploadId: upload.id, format: 'docx', conversationId: 'conv-1' }, store.deps);
  assert.equal(first.created, false);
  assert.equal(first.conversationId, 'conv-1');
  assert.equal(first.appended.length, 2);
  const second = await convertUpload('user-1', { uploadId: upload.id, format: 'xlsx', conversationId: 'conv-1' }, store.deps);
  assert.equal(second.appended.length, 1);
  assert.match(second.appended[0].content, /to Excel\. 1 table, one sheet each\./);
  assert.equal(store.conversations['conv-1'].length, 5);
  assert.equal(store.created.length, 0);
});

test('another user cannot convert someone else\'s upload', async () => {
  const store = fakeStore();
  const upload = await createHtmlUpload('owner', { name: 'desk.html', dataUrl: dataUrl(RICH) }, store.deps);
  await assert.rejects(convertUpload('intruder', { uploadId: upload.id, format: 'pdf' }, store.deps), /not found/);
});

test('Export tables to Excel works by uploadId before any message is sent', async () => {
  const store = fakeStore();
  const upload = await createHtmlUpload('user-1', { name: 'desk.html', dataUrl: dataUrl(RICH) }, store.deps);
  const deps: ExcelExportDeps = { ...store.deps, generateJson: async () => ({ content: '{}' }) };
  const result = await createExcelExport('user-1', {
    conversationId: null,
    uploadId: upload.id,
    messageIndex: -1,
    fileIndex: 0,
    fileName: 'desk.html',
    mode: 'tables',
  }, deps);
  assert.equal(result.created, true);
  assert.equal(result.appended.length, 2);
  assert.equal(result.attachment.kind, 'xlsx');
  assert.equal(store.exports[0].kind, 'tables');
  assert.equal(store.exports[0].conversationId, result.conversationId);
});

test('convert request parsing and filenames', () => {
  assert.deepEqual(readConvertBody({ uploadId: 'abcd-1234-efgh', format: 'docx' }), {
    uploadId: 'abcd-1234-efgh', format: 'docx', conversationId: null, projectId: null,
  });
  assert.throws(() => readConvertBody({ format: 'pdf' }), /Re-upload/);
  assert.throws(() => readConvertBody({ uploadId: 'abcd-1234-efgh', format: 'rtf' }), /Excel, CSV, PDF, or Word/);
  assert.equal(convertedFilename('Desk Report (final).html', 'pdf'), 'Desk-Report-final.pdf');
  assert.equal(convertedFilename('.html', 'docx'), 'page.docx');
});

test('stored PDF/Word attachments and file uploadIds survive message normalization', () => {
  const attachments = validateExportAttachments([
    { kind: 'pdf', exportId: 'export-123456', filename: 'desk.pdf', source: 'convert', sheetCount: 0, rowCount: 0, byteSize: 2048 },
    { kind: 'docx', exportId: 'export-654321', filename: 'desk.docx', source: 'convert', sheetCount: 0, rowCount: 0 },
    { kind: 'exe', exportId: 'export-000000', filename: 'x.exe' },
  ]);
  assert.deepEqual(attachments.map(item => item.kind), ['pdf', 'docx']);
  assert.equal(attachments[0].byteSize, 2048);
  const message = normalizeChatMessage({
    role: 'user',
    content: 'Uploaded desk.html',
    files: [{ mimeType: 'text/html', name: 'desk.html', extractedText: 'Page title: Desk', uploadId: 'upload-12345678' }],
  }, { allowStoredFiles: true, allowStoredMeta: true });
  assert.equal(message.files?.[0].uploadId, 'upload-12345678');
});

test('UI: Convert menu is English, offered on pending and sent HTML files, and Excel buttons are enabled after upload', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  const menu = read('src/components/AiResearchHtmlConvertMenu.tsx');
  assert.match(menu, /'Excel \(\.xlsx\)'/);
  assert.match(menu, /'PDF'/);
  assert.match(menu, /'Word \(\.docx\)'/);
  assert.match(menu, /\/api\/ai-research\/convert/);
  assert.match(menu, />\s*\{busy \? 'Converting…' : 'Convert'\}/);
  const actions = read('src/components/AiResearchHtmlExcelActions.tsx');
  assert.match(actions, /<AiResearchHtmlConvertMenu/);
  assert.match(actions, /!uploadId && !conversationId/);
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(page, /\/api\/ai-research\/uploads/);
  assert.match(page, /data-testid="ai-research-pending-html-actions"/);
  assert.match(page, /onResult=\{result => applyHtmlFileResult\(result, item\.id\)\}/);
  assert.match(page, /uploadId: item\.uploadId/);
  const card = read('src/components/AiResearchExcelAttachment.tsx');
  assert.match(card, /PDF document/);
  assert.match(card, /Word document/);
  assert.match(card, /Copy link/);
});

test('migration 033 adds the uploads table and convert export kinds', () => {
  const sql = readFileSync('db/migrations/033_ai_research_html_uploads.sql', 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_research_uploads/);
  assert.match(sql, /'convert-xlsx', 'convert-pdf', 'convert-docx'/);
  const exportsRoute = readFileSync('src/app/api/ai-research/exports/[id]/route.ts', 'utf8');
  assert.match(exportsRoute, /user_id = \?/);
});
