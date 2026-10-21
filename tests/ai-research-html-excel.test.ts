import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import {
  extractHtmlContent,
  extractHtmlTables,
  formatHtmlForResearch,
  sanitizeHtml,
} from '../src/lib/ai-research-html';
import {
  ExtractionValidationError,
  buildWorkbook,
  htmlTablesToSheets,
  parseNumericCell,
  sanitizeSheetName,
  validateExtractionJson,
} from '../src/lib/ai-research-excel';
import {
  ExcelExportError,
  createExcelExport,
  locateHtmlFile,
  parseExcelExportRequest,
  type ExcelExportDeps,
} from '../src/lib/ai-research-excel-export';
import {
  AI_RESEARCH_FILE_PICKER_ACCEPT,
  AI_RESEARCH_MAX_HTML_DOCUMENT_BYTES,
  classifyResearchAttachment,
  normalizeChatMessage,
  researchDocumentMaxBytes,
  validateFileAttachments,
  type AiResearchChatMessage,
} from '../src/lib/ai-research';
import { hydrateMessageFiles } from '../src/lib/ai-research-files';
import { htmlUploadKnowledgePayload, htmlUploadKnowledgeTaskId } from '../src/lib/ai-research-html-knowledge';

const read = (path: string) => readFileSync(path, 'utf8');

const SAMPLE = `<!doctype html><html><head><title>Gold Desk</title>
<style>body{color:red}</style><script>window.steal()</script>
<link rel="stylesheet" href="x.css"><meta http-equiv="refresh" content="0;url=evil"></head>
<body onload="boot()">
<h1 onclick="track()">Market update</h1>
<p style="display:none">Hello&nbsp;<b>traders</b><br>second line</p>
<a href="javascript:alert(1)" onmouseover="x()">bad link</a>
<a href="https://dupoin.co.id">good link</a>
<img src="x.png" onerror="pwn()">
<iframe src="https://evil.example"></iframe>
<h2>Products</h2>
<table>
  <thead><tr><th>Product</th><th>Price</th><th>Change</th><th>Date</th></tr></thead>
  <tbody>
    <tr><td>Gold</td><td>$1,234.50</td><td>1.5%</td><td>2026-10-01</td></tr>
    <tr><td>Silver</td><td>Rp 15.000</td><td>(2.25)</td><td>2026-10-02</td></tr>
    <tr><td>Phone</td><td>0812345678</td><td>n/a</td><td>2026-10-03</td></tr>
  </tbody>
</table>
<table><caption>Rates: Q3/Q4 [draft]</caption>
  <tr><th>Desk</th><th>Rate</th></tr>
  <tr><td colspan="2">Merged</td></tr>
  <tr><td>Jakarta</td><td>4</td></tr>
</table>
<table><tr><td>  </td></tr></table>
</body></html>`;

test('sanitizer strips script, style, embedded content, and every on* handler', () => {
  const clean = sanitizeHtml(SAMPLE);
  assert.doesNotMatch(clean, /<script|<style|<iframe|<link|<meta/i);
  assert.doesNotMatch(clean, /\son[a-z]+=/i);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.doesNotMatch(clean, /style=/i);
  assert.doesNotMatch(clean, /steal|boot\(\)|track\(\)|pwn\(\)/);
  assert.match(clean, /href="https:\/\/dupoin\.co\.id"/);
  assert.match(clean, /<table>/);
});

test('readable text keeps prose and renders tables as Markdown', () => {
  const extraction = extractHtmlContent(SAMPLE);
  assert.equal(extraction.title, 'Gold Desk');
  assert.match(extraction.text, /Market update/);
  assert.match(extraction.text, /Hello traders\nsecond line/);
  assert.match(extraction.text, /good link/);
  assert.match(extraction.text, /Table 1: Products\n\| Product \| Price \| Change \| Date \|\n\| --- \|/);
  assert.doesNotMatch(extraction.text, /steal|color:red/);
  const forModel = formatHtmlForResearch(extraction);
  assert.match(forModel, /^Page title: Gold Desk/);
  assert.match(forModel, /Tables detected: 2 \(Products; Rates: Q3\/Q4 \[draft\]\)/);
});

test('table extraction finds every non-empty table, names it, and expands colspan', () => {
  const tables = extractHtmlTables(SAMPLE);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].name, 'Products');
  assert.deepEqual(tables[0].rows[0], ['Product', 'Price', 'Change', 'Date']);
  assert.equal(tables[0].rows.length, 4);
  assert.equal(tables[1].name, 'Rates: Q3/Q4 [draft]');
  assert.deepEqual(tables[1].rows[1], ['Merged', '']);
});

test('nested tables and unnamed tables', () => {
  const tables = extractHtmlTables('<table><tr><td>Outer</td><td><table><tr><td>Inner</td></tr></table></td></tr></table><table><tr><td>x</td></tr></table>');
  assert.equal(tables.length, 3);
  assert.deepEqual(tables[0].rows, [['Outer', 'Inner']]);
  assert.equal(tables[2].name, 'Table 3');
});

test('numeric parsing types clear numbers and keeps identifiers and dates as text', () => {
  assert.deepEqual(parseNumericCell('1,234.56'), { value: 1234.56, percent: false });
  assert.deepEqual(parseNumericCell('$1,234'), { value: 1234, percent: false });
  assert.deepEqual(parseNumericCell('Rp 15.000'), { value: 15000, percent: false });
  assert.deepEqual(parseNumericCell('1.234,56'), { value: 1234.56, percent: false });
  assert.deepEqual(parseNumericCell('(2.25)'), { value: -2.25, percent: false });
  assert.deepEqual(parseNumericCell('12.5%'), { value: 0.125, percent: true });
  assert.equal(parseNumericCell('0812345678'), null);
  assert.equal(parseNumericCell('2026-10-01'), null);
  assert.equal(parseNumericCell('1234567890123456'), null);
  assert.equal(parseNumericCell('n/a'), null);
});

test('sheet names are Excel-safe, at most 31 characters, and unique', () => {
  const used = new Set<string>();
  assert.equal(sanitizeSheetName('Rates: Q3/Q4 [draft]', used), 'Rates Q3 Q4 draft');
  assert.equal(sanitizeSheetName('rates q3 q4 draft', used), 'rates q3 q4 draft (2)');
  assert.equal(sanitizeSheetName('A'.repeat(40), used).length, 31);
  assert.equal(sanitizeSheetName('', used, 'Table 4'), 'Table 4');
  assert.equal(sanitizeSheetName('History', used, 'Table 5'), 'Table 5');
});

test('tables export to xlsx: one sheet per table, frozen bold header, numbers typed', async () => {
  const buffer = await buildWorkbook(htmlTablesToSheets(extractHtmlTables(SAMPLE)));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Products', 'Rates Q3 Q4 draft']);

  const products = workbook.getWorksheet('Products')!;
  assert.equal(products.views[0]?.state, 'frozen');
  assert.equal((products.views[0] as { ySplit?: number }).ySplit, 1);
  assert.equal(products.getRow(1).getCell(1).value, 'Product');
  assert.equal(products.getRow(1).font?.bold, true);
  assert.equal(products.getCell('B2').value, 1234.5);
  assert.equal(typeof products.getCell('B2').value, 'number');
  assert.equal(products.getCell('B3').value, 15000);
  assert.equal(products.getCell('C2').value, 0.015);
  assert.equal(products.getCell('C2').numFmt, '0.00%');
  assert.equal(products.getCell('C3').value, -2.25);
  assert.equal(products.getCell('B4').value, '0812345678');
  assert.equal(products.getCell('D2').value, '2026-10-01');
  assert.equal(products.rowCount, 4);

  const rates = workbook.getWorksheet('Rates Q3 Q4 draft')!;
  assert.equal(rates.getCell('B3').value, 4);
  assert.equal((rates.views[0] as { ySplit?: number }).ySplit, 1);
});

test('AI extraction JSON: array rows, object rows, fences, and padding are validated', () => {
  const fromArrays = validateExtractionJson('```json\n{"sheetName":"Products","columns":["Product name","Price","Date"],"rows":[["Gold",1234.5,"2026-10-01"],["Silver","15000"],[null,null,null]]}\n```');
  assert.equal(fromArrays.sheetName, 'Products');
  assert.deepEqual(fromArrays.columns, ['Product name', 'Price', 'Date']);
  assert.deepEqual(fromArrays.rows, [['Gold', 1234.5, '2026-10-01'], ['Silver', '15000', null]]);

  const fromObjects = validateExtractionJson({ columns: ['Name', 'Name', ''], rows: [{ name: 'A', 'Column 3': 'x' }, 'junk'] });
  assert.deepEqual(fromObjects.columns, ['Name', 'Name (2)', 'Column 3']);
  assert.deepEqual(fromObjects.rows, [['A', 'A', 'x']]);
  assert.equal(fromObjects.sheetName, 'Extraction');
});

test('AI extraction JSON rejects malformed or empty results with English errors', () => {
  const cases: Array<[unknown, RegExp]> = [
    ['not json', /not valid JSON/],
    ['[1,2]', /JSON object/],
    [{ rows: [] }, /no columns/],
    [{ columns: ['A'] }, /no rows array/],
    [{ columns: ['A'], rows: [[null], ['']] }, /no rows that match/],
    [{ columns: Array.from({ length: 51 }, (_, index) => `C${index}`), rows: [] }, /more than 50 columns/],
  ];
  for (const [input, message] of cases) {
    assert.throws(() => validateExtractionJson(input), (error: unknown) => {
      assert.ok(error instanceof ExtractionValidationError);
      assert.match((error as Error).message, message);
      return true;
    });
  }
});

test('HTML uploads are accepted up to 10 MB and classified as documents', () => {
  assert.match(AI_RESEARCH_FILE_PICKER_ACCEPT, /\.html/);
  assert.match(AI_RESEARCH_FILE_PICKER_ACCEPT, /\.htm(,|$)/);
  assert.match(AI_RESEARCH_FILE_PICKER_ACCEPT, /text\/html/);
  assert.equal(classifyResearchAttachment('text/html', 'page.html'), 'document');
  assert.equal(classifyResearchAttachment('', 'page.htm'), 'document');
  assert.equal(AI_RESEARCH_MAX_HTML_DOCUMENT_BYTES, 10 * 1024 * 1024);
  assert.equal(researchDocumentMaxBytes({ name: 'a.html' }), 10 * 1024 * 1024);
  assert.equal(researchDocumentMaxBytes({ name: 'a.pdf' }), 8 * 1024 * 1024);

  const nineMb = Buffer.alloc(9 * 1024 * 1024, 'a').toString('base64');
  const [ok] = validateFileAttachments([{ name: 'big.html', mimeType: 'text/html', dataUrl: `data:text/html;base64,${nineMb}` }]);
  assert.equal(ok.mimeType, 'text/html');
  const elevenMb = Buffer.alloc(11 * 1024 * 1024, 'a').toString('base64');
  assert.throws(
    () => validateFileAttachments([{ name: 'huge.html', mimeType: 'text/html', dataUrl: `data:text/html;base64,${elevenMb}` }]),
    /Each HTML file must be 10 MB or smaller/,
  );
});

test('server hydration sanitizes HTML into research text and keeps tables for export', async () => {
  const dataUrl = `data:text/html;base64,${Buffer.from(SAMPLE).toString('base64')}`;
  const [message] = await hydrateMessageFiles([{ role: 'user', content: 'Summarize', files: [{ mimeType: 'text/html', name: 'desk.html', dataUrl }] }]);
  const file = message.files![0];
  assert.equal(file.dataUrl, undefined);
  assert.equal(file.mimeType, 'text/html');
  assert.match(file.extractedText!, /Page title: Gold Desk/);
  assert.doesNotMatch(file.extractedText!, /steal/);
  assert.equal(file.tables?.length, 2);

  const stored = normalizeChatMessage(JSON.parse(JSON.stringify(message)), { allowStoredFiles: true, allowStoredMeta: true });
  assert.equal(stored.files?.[0].tables?.[0].name, 'Products');
});

function fakeDeps(messages: AiResearchChatMessage[], json = '{}'): ExcelExportDeps & { saved: AiResearchChatMessage[][]; exports: Array<{ filename: string; data: Buffer; kind: string }>; prompts: string[] } {
  const saved: AiResearchChatMessage[][] = [];
  const exports: Array<{ filename: string; data: Buffer; kind: string }> = [];
  const prompts: string[] = [];
  return {
    saved,
    exports,
    prompts,
    loadConversation: async () => ({ messages: JSON.parse(JSON.stringify(messages)) }),
    saveConversationMessages: async (_userId, _id, next) => { saved.push(next); },
    saveExport: async row => { exports.push({ filename: row.filename, data: row.data, kind: row.kind }); },
    generateJson: async ({ user }) => { prompts.push(user); return { content: json, fallbackLabel: null }; },
    newId: () => 'export-0001-abcd',
  };
}

async function hydratedConversation(): Promise<AiResearchChatMessage[]> {
  const dataUrl = `data:text/html;base64,${Buffer.from(SAMPLE).toString('base64')}`;
  const [user] = await hydrateMessageFiles([{ role: 'user', content: 'Read this', files: [{ mimeType: 'text/html', name: 'desk.html', dataUrl }] }]);
  return [user, { role: 'assistant', content: 'Here is the summary.' }];
}

test('"Export tables to Excel" appends an xlsx attachment message to the thread', async () => {
  const deps = fakeDeps(await hydratedConversation());
  const request = parseExcelExportRequest({ conversationId: 'c1', messageIndex: 0, fileIndex: 0, fileName: 'desk.html', mode: 'tables' });
  const result = await createExcelExport('u1', request, deps);
  assert.equal(result.attachment.filename, 'desk-tables.xlsx');
  assert.equal(result.attachment.sheetCount, 2);
  assert.equal(result.attachment.rowCount, 5);
  assert.match(result.message.content, /Exported 2 tables from desk\.html to Excel/);
  assert.equal(deps.saved[0].length, 3);
  assert.deepEqual(deps.saved[0][2].attachments?.[0].exportId, 'export-0001-abcd');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(deps.exports[0].data as unknown as ArrayBuffer);
  assert.equal(workbook.worksheets.length, 2);
  const stored = normalizeChatMessage(JSON.parse(JSON.stringify(result.message)), { allowStoredMeta: true });
  assert.equal(stored.attachments?.[0].filename, 'desk-tables.xlsx');
});

test('AI extraction writes validated rows to a single-sheet workbook', async () => {
  const deps = fakeDeps(await hydratedConversation(), '{"sheetName":"Prices","columns":["Product","Price","Date"],"rows":[["Gold","$1,234.50","2026-10-01"],["Silver",15000,"2026-10-02"]]}');
  const request = parseExcelExportRequest({ conversationId: 'c1', messageIndex: 9, fileIndex: 0, fileName: 'desk.html', mode: 'extract', instruction: 'extract product name, price, date' });
  const result = await createExcelExport('u1', request, deps);
  assert.match(deps.prompts[0], /Instruction: extract product name, price, date/);
  assert.match(deps.prompts[0], /Gold Desk/);
  assert.match(result.message.content, /Extracted 2 rows \(Product, Price, Date\) from desk\.html/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(deps.exports[0].data as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet('Prices')!;
  assert.equal(sheet.getCell('A1').value, 'Product');
  assert.equal(sheet.getCell('B2').value, 1234.5);
  assert.equal(sheet.getCell('B3').value, 15000);
  assert.equal((sheet.views[0] as { ySplit?: number }).ySplit, 1);
});

test('export errors: no tables, invalid AI JSON, missing instruction, unknown file', async () => {
  const noTables: AiResearchChatMessage[] = [{ role: 'user', content: 'x', files: [{ mimeType: 'text/html', name: 'plain.html', extractedText: 'Just text here' }] }];
  await assert.rejects(
    createExcelExport('u1', parseExcelExportRequest({ conversationId: 'c', messageIndex: 0, fileIndex: 0, mode: 'tables' }), fakeDeps(noTables)),
    (error: unknown) => error instanceof ExcelExportError && error.status === 422 && /No tables were found in plain\.html/.test(error.message),
  );
  await assert.rejects(
    createExcelExport('u1', parseExcelExportRequest({ conversationId: 'c', messageIndex: 0, fileIndex: 0, mode: 'extract', instruction: 'prices' }), fakeDeps(noTables, 'nope')),
    (error: unknown) => error instanceof ExcelExportError && /not valid JSON/.test(error.message),
  );
  assert.throws(() => parseExcelExportRequest({ conversationId: 'c', mode: 'extract', instruction: '' }), /Describe what to extract/);
  assert.throws(() => parseExcelExportRequest({ mode: 'tables' }), /Send the message first/);
  assert.equal(locateHtmlFile(noTables, { messageIndex: 0, fileIndex: 0, fileName: 'other.html' }), null);
});

test('uploaded HTML is saved to the Knowledge Graph like other uploads', () => {
  const text = 'Page title: Gold Desk\n\nMarket update with prices';
  const payload = htmlUploadKnowledgePayload({ userId: 'u1', name: 'desk.html', text, conversationId: 'c1' });
  assert.ok(payload);
  assert.equal(payload!.taskType, 'ai-research');
  assert.equal(payload!.brief, 'Uploaded HTML: Gold Desk');
  assert.equal(payload!.taskId, htmlUploadKnowledgeTaskId(text));
  assert.match(payload!.taskId!, /^html-[a-f0-9]{40}$/);
  assert.equal(payload!.upsertTask, true);
  assert.equal(payload!.updateStylePreferences, false);
  assert.equal(htmlUploadKnowledgePayload({ userId: 'u1', text: ' ' }), null);
  assert.match(read('src/app/api/ai-research/chat/route.ts'), /persistHtmlUploadsToKnowledge\(\{/);
});

test('UI wiring is English and delivers the xlsx as an attachment message', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(page, /<AiResearchHtmlExcelActions/);
  assert.match(page, /<AiResearchExcelAttachment/);
  const actions = read('src/components/AiResearchHtmlExcelActions.tsx');
  assert.match(actions, /Export tables to Excel/);
  assert.match(actions, /e\.g\. extract product name, price, date/);
  assert.match(read('src/components/AiResearchExcelAttachment.tsx'), /\/api\/ai-research\/exports\//);
  const migration = read('db/migrations/032_ai_research_exports.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_research_exports/);
  assert.match(read('src/app/api/ai-research/exports/[id]/route.ts'), /user_id = \?/);
});
