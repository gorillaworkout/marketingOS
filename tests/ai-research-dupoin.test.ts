import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import {
  AI_RESEARCH_ASSISTANT_NAME,
  AI_RESEARCH_FILE_ONLY_PROMPT,
  AI_RESEARCH_FILE_PICKER_ACCEPT,
  AI_RESEARCH_SYSTEM_PROMPT,
  buildGatewayMessages,
  conversationTitleFromMessages,
  parseChatRequest,
  parseStoredMessages,
  validateFileAttachments,
} from '../src/lib/ai-research';
import {
  extractCsvText,
  extractSpreadsheetText,
  hydrateMessageFiles,
  parseCsvRows,
  rowsToMarkdownTable,
} from '../src/lib/ai-research-files';
import {
  markdownContainsHtmlNode,
  parseMarkdown,
  sanitizeHref,
} from '../src/lib/ai-research-markdown';

const read = (path: string) => readFileSync(path, 'utf8');

function csvDataUrl(text: string, name = 'rates.csv'): { mimeType: string; dataUrl: string; name: string } {
  const dataUrl = `data:text/csv;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
  return { mimeType: 'text/csv', dataUrl, name };
}

function xlsxDataUrl(rows: unknown[][], sheet = 'Rates', name = 'rates.xlsx') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheet);
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const,
    dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString('base64')}`,
    name,
  };
}

test('AI Research user-facing brand is Dupoin AI, not GorillaWorkout AI', () => {
  assert.equal(AI_RESEARCH_ASSISTANT_NAME, 'Dupoin AI');
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /Dupoin AI Assistant/);
  assert.doesNotMatch(AI_RESEARCH_SYSTEM_PROMPT, /GorillaWorkout AI/);

  const page = read('src/app/dashboard/ai-research/page.tsx');
  const admin = read('src/app/dashboard/ai-research/admin/page.tsx');
  const route = read('src/app/api/ai-research/chat/route.ts');
  const lib = read('src/lib/ai-research.ts');
  assert.match(page, /AI_RESEARCH_ASSISTANT_NAME/);
  assert.match(admin, /AI_RESEARCH_ASSISTANT_NAME/);
  assert.match(lib, /Dupoin AI Assistant/);
  assert.match(route, /X-Title': 'Dupoin AI Research'/);
  for (const source of [page, admin, route, lib]) {
    assert.doesNotMatch(source, /GorillaWorkout AI/);
  }
});

test('assistant markdown contract renders bold, lists, links, and code without raw HTML', () => {
  const blocks = parseMarkdown([
    '**US dollar:** menguat',
    '',
    '- Gold',
    '- Oil',
    '',
    'See [Bappebti](https://bappebti.go.id) and `XAUUSD`.',
    '',
    '```',
    'pair,bid',
    '```',
    '',
    '| pair | bid |',
    '| --- | --- |',
    '| XAUUSD | 2650 |',
    '',
    '<script>alert(1)</script>',
    '',
    '[xss](javascript:alert(1))',
  ].join('\n'));

  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[0].type === 'paragraph' && blocks[0].children[0].type, 'strong');
  assert.equal(blocks[1].type, 'list');
  assert.equal(blocks[1].type === 'list' && blocks[1].items.length, 2);
  assert.ok(blocks.some(block => block.type === 'paragraph' && block.children.some(node => node.type === 'link' && node.href === 'https://bappebti.go.id')));
  assert.ok(blocks.some(block => block.type === 'paragraph' && block.children.some(node => node.type === 'code' && node.value === 'XAUUSD')));
  assert.ok(blocks.some(block => block.type === 'codeblock' && block.value.includes('pair,bid')));
  assert.ok(blocks.some(block => block.type === 'table' && block.rows.length === 1));
  assert.ok(blocks.some(block => block.type === 'paragraph' && block.children.some(node => node.type === 'text' && String(node.value).includes('<script>alert(1)</script>'))));
  assert.equal(sanitizeHref('javascript:alert(1)'), null);
  assert.equal(sanitizeHref('https://dupoin.co.id/about'), 'https://dupoin.co.id/about');
  assert.equal(markdownContainsHtmlNode(blocks), false);

  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(page, /AiResearchMarkdown/);
  assert.match(page, /msg\.role === 'assistant'/);
  assert.match(page, /<AiResearchMarkdown[\s\S]*text=\{streaming\}/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
  assert.match(read('src/components/AiResearchMarkdown.tsx'), /data-markdown="assistant"/);
});

test('accepts CSV and XLSX attachments, extracts tables, and includes them in the chat request', () => {
  const csv = csvDataUrl('pair,bid,ask\nXAUUSD,2650.1,2650.4\n');
  assert.deepEqual(parseCsvRows('pair;bid\nXAUUSD;2650'), [['pair', 'bid'], ['XAUUSD', '2650']]);
  assert.match(rowsToMarkdownTable([['pair', 'bid'], ['XAUUSD', '2650']]), /XAUUSD/);
  assert.match(extractCsvText(Buffer.from('pair,bid\nEURUSD,1.08\n')), /EURUSD/);

  const parsedCsv = parseChatRequest({
    messages: [{ role: 'user', content: 'Ringkas file ini', files: [csv] }],
  });
  assert.equal(parsedCsv.messages[0].files?.[0].name, 'rates.csv');
  const hydratedCsv = hydrateMessageFiles(parsedCsv.messages);
  assert.match(hydratedCsv[0].files?.[0].extractedText || '', /XAUUSD/);
  assert.equal(hydratedCsv[0].files?.[0].dataUrl, undefined);

  const xlsx = xlsxDataUrl([['pair', 'change'], ['USOIL', '-0.4']]);
  const parsedXlsx = parseChatRequest({
    messages: [{ role: 'user', content: '', files: [xlsx] }],
  });
  assert.equal(parsedXlsx.messages[0].content, AI_RESEARCH_FILE_ONLY_PROMPT);
  const hydratedXlsx = hydrateMessageFiles(parsedXlsx.messages);
  assert.match(hydratedXlsx[0].files?.[0].extractedText || '', /USOIL/);

  const xlsWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(xlsWorkbook, XLSX.utils.aoa_to_sheet([['pair'], ['GBPUSD']]), 'FX');
  const xlsBuffer = XLSX.write(xlsWorkbook, { type: 'buffer', bookType: 'xls' }) as Buffer;
  const parsedXls = parseChatRequest({
    messages: [{
      role: 'user',
      content: 'Baca xls',
      files: [{
        mimeType: 'application/vnd.ms-excel',
        dataUrl: `data:application/vnd.ms-excel;base64,${xlsBuffer.toString('base64')}`,
        name: 'fx.xls',
      }],
    }],
  });
  assert.match(hydrateMessageFiles(parsedXls.messages)[0].files?.[0].extractedText || '', /GBPUSD/);
  assert.match(extractSpreadsheetText(
    Buffer.from(xlsx.dataUrl.slice(xlsx.dataUrl.indexOf(',') + 1), 'base64'),
    xlsx.mimeType,
    xlsx.name,
  ), /USOIL/);

  const gateway = buildGatewayMessages('system', [], hydratedXlsx);
  assert.match(String(gateway[1].content), /Attached spreadsheet \(rates.xlsx\)/);
  assert.match(String(gateway[1].content), /USOIL/);
  assert.equal(conversationTitleFromMessages(hydratedXlsx), 'File analysis (1)');

  const stored = parseStoredMessages([{
    role: 'user',
    content: 'legacy file',
    files: [{ mimeType: 'text/csv', name: 'old.csv', extractedText: '| pair | bid |\n| XAUUSD | 1 |' }],
  }]);
  assert.equal(stored[0].files?.[0].name, 'old.csv');
  assert.match(stored[0].files?.[0].extractedText || '', /XAUUSD/);

  assert.throws(
    () => validateFileAttachments([{ mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA', name: 'note.pdf' }]),
    /Unsupported file type/i,
  );
  assert.throws(
    () => validateFileAttachments(Array.from({ length: 5 }, () => csv)),
    /up to 4 spreadsheets/i,
  );

  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(page, /AI_RESEARCH_FILE_PICKER_ACCEPT/);
  assert.match(AI_RESEARCH_FILE_PICKER_ACCEPT, /\.xlsx/);
  assert.match(AI_RESEARCH_FILE_PICKER_ACCEPT, /\.csv/);
  assert.match(page, /AiResearchFileChip/);
  assert.match(read('src/app/api/ai-research/chat/route.ts'), /hydrateMessageFiles/);
});
