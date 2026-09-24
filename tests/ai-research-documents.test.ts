import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { Document, HeadingLevel, Packer, Paragraph } from 'docx';
import {
  AI_RESEARCH_FILE_PICKER_ACCEPT,
  AI_RESEARCH_MAX_DOCUMENT_BYTES,
  AI_RESEARCH_MAX_DOCUMENTS,
  AI_RESEARCH_MAX_EXTRACTED_CHARS,
  AI_RESEARCH_MAX_FILE_BYTES,
  AI_RESEARCH_MAX_TOTAL_DOCUMENT_BYTES,
  AI_RESEARCH_SYSTEM_PROMPT,
  buildGatewayMessages,
  classifyResearchAttachment,
  parseChatRequest,
  parseStoredMessages,
  validateFileAttachments,
} from '../src/lib/ai-research';
import {
  hydrateMessageFiles,
  limitLabeledSections,
  truncateExtractedText,
} from '../src/lib/ai-research-files';

const read = (path: string) => readFileSync(path, 'utf8');

function dataUrl(bytes: Buffer, mimeType: string, name: string) {
  return {
    mimeType,
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    name,
  };
}

function buildSimplePdf(pageTexts: string[]): Buffer {
  const fontId = 3 + pageTexts.length * 2;
  const kids = pageTexts.map((_, index) => `${3 + index * 2} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>`,
  ];
  pageTexts.forEach((text) => {
    const safe = text.replace(/[()\\]/g, '');
    const stream = `BT /F1 18 Tf 72 720 Td (${safe}) Tj ET`;
    const contentId = objects.length + 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

async function buildDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Dupoin outlook', heading: HeadingLevel.HEADING_1 }),
        new Paragraph('Gold tetap menarik bagi investor.'),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function buildPptx(): Promise<Buffer> {
  const zip = new JSZip();
  const slide = (lines: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    ${lines.map(line => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join('')}
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
  zip.file('ppt/slides/slide2.xml', slide(['Slide dua &amp; minyak']));
  zip.file('ppt/slides/slide1.xml', slide(['Gold outlook', 'XAUUSD tetap kuat']));
  zip.file('ppt/notesSlides/notesSlide1.xml', slide(['ingat XAUUSD']));
  return zip.generateAsync({ type: 'nodebuffer' });
}

function paddedDataUrl(decodedBytes: number, mimeType: string, name: string) {
  const length = Math.ceil((decodedBytes * 4) / 3);
  const base64 = 'A'.repeat(length + (4 - (length % 4)) % 4);
  return { mimeType, dataUrl: `data:${mimeType};base64,${base64}`, name };
}

test('classifies PDF, DOCX, and PPTX separately from images and spreadsheets', () => {
  assert.equal(classifyResearchAttachment('image/png', 'chart.png'), 'image');
  assert.equal(classifyResearchAttachment('text/csv', 'rates.csv'), 'spreadsheet');
  assert.equal(classifyResearchAttachment('application/pdf', 'outlook.pdf'), 'document');
  assert.equal(classifyResearchAttachment('', 'brief.DOCX'), 'document');
  assert.equal(classifyResearchAttachment('application/octet-stream', 'deck.pptx'), 'document');
  assert.equal(classifyResearchAttachment('application/x-pdf', 'scan'), 'document');
  assert.equal(classifyResearchAttachment('application/msword', 'legacy.doc'), null);
  assert.match(AI_RESEARCH_FILE_PICKER_ACCEPT, /application\/pdf/);
  assert.match(AI_RESEARCH_FILE_PICKER_ACCEPT, /\.docx/);
  assert.match(AI_RESEARCH_FILE_PICKER_ACCEPT, /\.pptx/);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /PDF, Word document \(DOCX\), or PowerPoint presentation \(PPTX\)/);
});

test('extracts PDF, DOCX, and PPTX text into the research prompt', async () => {
  const pdf = dataUrl(buildSimplePdf(['Dupoin gold outlook', 'Halaman minyak']), 'application/pdf', 'outlook.pdf');
  const docx = dataUrl(await buildDocx(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'brief.docx');
  const pptx = dataUrl(await buildPptx(), 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'deck.pptx');
  const csv = {
    mimeType: 'text/csv',
    dataUrl: `data:text/csv;base64,${Buffer.from('pair,bid\nXAUUSD,2650\n', 'utf8').toString('base64')}`,
    name: 'rates.csv',
  };

  const parsed = parseChatRequest({
    messages: [{ role: 'user', content: '', files: [pdf, docx, pptx, csv] }],
  });
  assert.equal(parsed.messages[0].files?.[0].mimeType, 'application/pdf');
  const hydrated = await hydrateMessageFiles(parsed.messages);
  const [pdfText, docxText, pptxText, csvText] = hydrated[0].files?.map(file => file.extractedText || '') || [];
  assert.match(pdfText, /Page 1\nDupoin gold outlook/);
  assert.match(pdfText, /Page 2\nHalaman minyak/);
  assert.match(docxText, /# Dupoin outlook/);
  assert.match(docxText, /Gold tetap menarik bagi investor\./);
  assert.match(pptxText, /Slide 1\nGold outlook\nXAUUSD tetap kuat/);
  assert.match(pptxText, /Notes: ingat XAUUSD/);
  assert.match(pptxText, /Slide 2\nSlide dua & minyak/);
  assert.ok(pptxText.indexOf('Slide 1') < pptxText.indexOf('Slide 2'));
  assert.match(csvText, /XAUUSD/);
  for (const file of hydrated[0].files || []) assert.equal(file.dataUrl, undefined);

  const gateway = buildGatewayMessages('system', [], hydrated);
  const prompt = String(gateway[1].content);
  assert.match(prompt, /Attached document \(outlook\.pdf\)/);
  assert.match(prompt, /Attached document \(brief\.docx\)/);
  assert.match(prompt, /Attached document \(deck\.pptx\)/);
  assert.match(prompt, /Attached spreadsheet \(rates\.csv\)/);
  assert.match(prompt, /Dupoin gold outlook/);
  assert.match(prompt, /XAUUSD tetap kuat/);

  const pasted = parseChatRequest({
    messages: [{
      role: 'user',
      content: 'Ringkas',
      files: [{
        mimeType: 'application/octet-stream',
        dataUrl: `data:application/octet-stream;base64,${buildSimplePdf(['Dari clipboard']).toString('base64')}`,
        name: 'clipboard.pdf',
      }],
    }],
  });
  assert.equal(pasted.messages[0].files?.[0].mimeType, 'application/pdf');
  const pastedText = (await hydrateMessageFiles(pasted.messages))[0].files?.[0].extractedText || '';
  assert.match(pastedText, /Dari clipboard/);
});

test('limits document count and size without changing spreadsheet caps', () => {
  const pdf = dataUrl(Buffer.from('pdf'), 'application/pdf', 'note.pdf');
  assert.throws(
    () => validateFileAttachments(Array.from({ length: AI_RESEARCH_MAX_DOCUMENTS + 1 }, () => pdf)),
    /up to 4 documents/i,
  );
  assert.doesNotThrow(() => validateFileAttachments([
    ...Array.from({ length: 4 }, (_, index) => ({
      mimeType: 'text/csv',
      dataUrl: `data:text/csv;base64,${Buffer.from(`pair,bid\nXAUUSD,${index}\n`).toString('base64')}`,
      name: `rates-${index}.csv`,
    })),
    ...Array.from({ length: 4 }, (_, index) => dataUrl(Buffer.from(`pdf-${index}`), 'application/pdf', `note-${index}.pdf`)),
  ]));

  assert.throws(
    () => validateFileAttachments([paddedDataUrl(AI_RESEARCH_MAX_DOCUMENT_BYTES + 32, 'application/pdf', 'big.pdf')]),
    /8 MB/i,
  );
  assert.throws(
    () => validateFileAttachments([paddedDataUrl(AI_RESEARCH_MAX_FILE_BYTES + 32, 'text/csv', 'big.csv')]),
    /2 MB/i,
  );
  assert.throws(
    () => validateFileAttachments([
      paddedDataUrl(6 * 1024 * 1024, 'application/pdf', 'a.pdf'),
      paddedDataUrl(6 * 1024 * 1024, 'application/pdf', 'b.pdf'),
      paddedDataUrl(6 * 1024 * 1024, 'application/pdf', 'c.pdf'),
    ]),
    new RegExp(`exceed the ${AI_RESEARCH_MAX_TOTAL_DOCUMENT_BYTES / (1024 * 1024)} MB total limit`),
  );
});

test('notes truncated document text and rejects corrupt files', async () => {
  const marker = 'HEAD_MARKER';
  const tail = 'TAIL_MARKER_SHOULD_BE_CUT';
  const truncated = truncateExtractedText(`${marker}${'A'.repeat(AI_RESEARCH_MAX_EXTRACTED_CHARS)}${tail}`);
  assert.match(truncated, new RegExp(marker));
  assert.equal(truncated.includes(tail), false);
  assert.ok(truncated.length <= AI_RESEARCH_MAX_EXTRACTED_CHARS);
  assert.match(truncated, /extracted text truncated — only part of the file was sent to the model/);
  const reloaded = parseStoredMessages([{
    role: 'user',
    content: 'baca',
    files: [{ mimeType: 'application/pdf', name: 'long.pdf', extractedText: truncated }],
  }]);
  assert.match(reloaded[0].files?.[0].extractedText || '', /only part of the file was sent to the model/);

  const omitted = limitLabeledSections(['Page 1\nA', 'Page 2\nB', 'Page 3\nC'], 2, 'pages');
  assert.match(omitted, /Page 1/);
  assert.match(omitted, /Page 2/);
  assert.equal(omitted.includes('Page 3'), false);
  assert.match(omitted, /1 more pages omitted/);

  await assert.rejects(
    () => hydrateMessageFiles(parseChatRequest({
      messages: [{
        role: 'user',
        content: 'baca',
        files: [dataUrl(Buffer.from('%PDF-1.4 not a real pdf'), 'application/pdf', 'broken.pdf')],
      }],
    }).messages),
    /Could not read broken\.pdf\. Use a valid PDF, DOCX, or PPTX file/i,
  );
  await assert.rejects(
    () => hydrateMessageFiles(parseChatRequest({
      messages: [{
        role: 'user',
        content: 'baca',
        files: [dataUrl(Buffer.from('not a pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'broken.pptx')],
      }],
    }).messages),
    /Could not read broken\.pptx/i,
  );

  const stored = parseStoredMessages([{
    role: 'user',
    content: 'baca pdf',
    files: [{ mimeType: 'application/pdf', name: 'outlook.pdf', extractedText: 'Page 1\nDupoin gold outlook' }],
  }]);
  assert.match(String(buildGatewayMessages('system', [], stored)[1].content), /Attached document \(outlook\.pdf\)[\s\S]*Dupoin gold outlook/);
});

test('AI Research composer accepts documents from the picker, drop zone, and paste', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(page, /accept=\{AI_RESEARCH_FILE_PICKER_ACCEPT\}/);
  assert.match(page, /classifyResearchAttachment/);
  assert.match(page, /onDrop=\{handleAttachmentDrop\}/);
  assert.match(page, /onPaste=\{handleComposerPaste\}/);
  assert.match(page, /addAttachments\(files\)/);
  assert.match(page, /Images, Excel, CSV, PDF, Word, or PowerPoint/);
  assert.match(page, /PDF, Word, or PowerPoint file\.\.\./);
  assert.match(page, /PDF, Word, and PowerPoint \(max 4 of each\)/);
  assert.match(page, /AI_RESEARCH_MAX_DOCUMENTS/);
  assert.match(page, /AI_RESEARCH_MAX_DOCUMENT_BYTES/);
  assert.match(read('src/app/api/ai-research/chat/route.ts'), /await hydrateMessageFiles/);
});
