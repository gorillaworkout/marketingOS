import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuideReader } from '../src/app/dashboard/internal-docs/GuideReader';
import { docxPreviewHtml, extractInternalDocText } from '../src/lib/internal-docs-extract';
import { citationDocumentHref } from '../src/app/dashboard/internal-docs/FaqAskPanel';
import {
  guideHighlightNeedle,
  internalDocFilePath,
  internalDocImagePath,
  isInternalDocImagePath,
  parseMarkdownDocument,
  parsePlainDocument,
  safeDocumentUrl,
  sanitizeDocumentHtml,
} from '../src/lib/internal-docs-reader';
import { contentDispositionFor, inlineDocumentRequested } from '../src/lib/internal-docs-storage';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

const documentId = '11111111-1111-4111-8111-111111111111';

function guide(overrides: Partial<Parameters<typeof GuideReader>[0]['document']> = {}) {
  return {
    id: documentId,
    title: 'LED Management',
    originalName: 'LED_Management_Dupoin_Centennial_Tower_FL_27.docx',
    extension: '.docx',
    fileSize: 48_000,
    accessLevel: 'company' as const,
    status: 'indexed' as const,
    errorMessage: null,
    extractedText: 'See https://manual.example/book for the book.',
    previewHtml: '<p>Read <a href="https://manual.example/led">the manual</a>.</p><p>Also https://manual.example/book.</p>',
    ...overrides,
  };
}

async function docxWithLink(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://manual.example/led" TargetMode="External"/>
</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>LED management guide.</w:t></w:r></w:p>
    <w:p>
      <w:hyperlink r:id="rId2"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>Open the manual</w:t></w:r></w:hyperlink>
    </w:p>
    <w:p><w:r><w:t>See https://manual.example/book for the book.</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return new Uint8Array(buffer);
}

test('document links stay on http(s) and file paths can open inline', () => {
  assert.equal(safeDocumentUrl('https://manual.example/led'), 'https://manual.example/led');
  assert.equal(safeDocumentUrl('  http://manual.example/book  '), 'http://manual.example/book');
  assert.equal(safeDocumentUrl('javascript:alert(1)'), null);
  assert.equal(safeDocumentUrl('data:text/html,hi'), null);
  assert.equal(safeDocumentUrl('https://user:pass@manual.example/secret'), null);
  assert.equal(safeDocumentUrl('//manual.example/led'), null);
  assert.equal(internalDocFilePath(documentId, true), `/api/internal-docs/${documentId}/file?inline=1`);
  assert.equal(internalDocFilePath(documentId, false), `/api/internal-docs/${documentId}/file`);
  assert.equal(contentDispositionFor('LED Management.docx', false), 'attachment; filename="LED Management.docx"');
  assert.equal(contentDispositionFor('LED"\n.pdf', true), 'inline; filename="LED.pdf"');
  assert.equal(inlineDocumentRequested('1'), true);
  assert.equal(inlineDocumentRequested('true'), true);
  assert.equal(inlineDocumentRequested(null), false);
});

test('markdown and plain text render manual links, and unsafe urls stay text', () => {
  const markdown = parseMarkdownDocument([
    '# LED Management',
    '',
    'See https://manual.example/book.',
    '',
    'Open [the manual](https://manual.example/led) or [bad](javascript:alert(1)).',
    '',
    '- Badge printer',
    '- Wifi',
  ].join('\n'));
  assert.equal(markdown[0]?.type, 'heading');
  assert.equal(markdown[1]?.type, 'paragraph');
  if (markdown[1]?.type !== 'paragraph') return;
  const link = markdown[1].children.find(node => node.type === 'link');
  assert.equal(link && link.type === 'link' ? link.href : '', 'https://manual.example/book');
  assert.equal(link && link.type === 'link' ? link.text : '', 'https://manual.example/book');
  const manual = markdown[2];
  assert.equal(manual?.type, 'paragraph');
  if (manual?.type !== 'paragraph') return;
  assert.equal(manual.children.some(node => node.type === 'link' && node.href === 'https://manual.example/led'), true);
  assert.equal(manual.children.some(node => node.type === 'link' && node.href.startsWith('javascript:')), false);
  assert.equal(markdown.some(block => block.type === 'list' && !block.ordered), true);

  const plain = parsePlainDocument('Line one\nhttps://manual.example/policy\n\nLine two');
  assert.equal(plain.length, 2);
  assert.equal(plain[0]?.type === 'paragraph' && plain[0].children.some(node => node.type === 'link'), true);
  assert.equal(plain[0]?.type === 'paragraph' && plain[0].children.some(node => node.type === 'break'), true);
});

test('word html keeps safe links and drops scripts and event handlers', () => {
  const html = sanitizeDocumentHtml([
    '<p>Read <a href="https://manual.example/led" onclick="alert(1)">the manual</a>.</p>',
    '<p>Bare https://manual.example/book.</p>',
    '<script>alert(1)</script>',
    '<a href="javascript:alert(1)">bad</a>',
    '<img src="x" onerror="alert(1)">',
    '<svg/onload=alert(1)>',
  ].join(''));
  assert.match(html, /href="https:\/\/manual\.example\/led"/);
  assert.match(html, /href="https:\/\/manual\.example\/book"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /the manual/);
  assert.match(html, /bad/);
  assert.match(html, /&lt;svg\/onload=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script|onclick=|onerror=|<img|<svg|href="javascript:/i);

  const image = sanitizeDocumentHtml(`<p><img src="${internalDocImagePath(documentId, 0)}" alt="LED diagram" onerror="alert(1)"></p>`);
  assert.equal(isInternalDocImagePath(internalDocImagePath(documentId, 0)), true);
  assert.match(image, new RegExp(`src="${internalDocImagePath(documentId, 0)}"`));
  assert.match(image, /alt="LED diagram"/);
  assert.doesNotMatch(image, /onerror/);
  assert.doesNotMatch(sanitizeDocumentHtml('<img src="https://evil.example/a.png" alt="x">'), /<img/);
  assert.doesNotMatch(sanitizeDocumentHtml('<img src="data:image/png;base64,aaaa" alt="x">'), /<img/);
});

test('docx preview keeps the manual hyperlink and indexed text keeps the url', async () => {
  const bytes = await docxWithLink();
  const html = await docxPreviewHtml(bytes);
  assert.match(html, /Open the manual/);
  assert.match(html, /href="https:\/\/manual\.example\/led"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /https:\/\/manual\.example\/book/);
  const text = await extractInternalDocText(bytes, '.docx');
  assert.match(text, /LED management guide/);
  assert.match(text, /https:\/\/manual\.example\/led/);
  assert.match(text, /https:\/\/manual\.example\/book/);
});

function renderGuide(document: ReturnType<typeof guide>, canManage: boolean) {
  return renderToStaticMarkup(createElement(GuideReader, {
    document,
    canManage,
    onAccessChange: () => undefined,
    onReindex: () => undefined,
    onDelete: () => undefined,
  }));
}

test('reader shows a document page, a clickable filename, and keeps manage actions secondary', () => {
  const docx = renderGuide(guide(), true);
  assert.match(docx, /data-testid="guide-reader"/);
  assert.match(docx, /data-testid="guide-body"/);
  assert.match(docx, /LED Management/);
  assert.match(docx, /LED_Management_Dupoin_Centennial_Tower_FL_27\.docx/);
  assert.match(docx, new RegExp(`href="/api/internal-docs/${documentId}/file"`));
  assert.doesNotMatch(docx, /file\?inline=1/);
  assert.match(docx, /Open file/);
  assert.match(docx, /Download/);
  assert.match(docx, /href="https:\/\/manual\.example\/led"/);
  assert.match(docx, /rel="noopener noreferrer"/);
  assert.match(docx, /target="_blank"/);
  assert.match(docx, /Reindex/);
  assert.match(docx, /Delete/);
  assert.match(docx, /Change access level/);
  assert.doesNotMatch(docx, /<iframe/);

  const pdf = renderGuide(guide({
    extension: '.pdf',
    originalName: 'visitor-wifi.pdf',
    previewHtml: null,
    extractedText: 'Page 1\nThe password is at reception. https://manual.example/wifi',
  }), false);
  assert.match(pdf, /data-testid="guide-pdf"/);
  assert.match(pdf, /<iframe/);
  assert.match(pdf, new RegExp(`src="/api/internal-docs/${documentId}/file\\?inline=1"`));
  assert.match(pdf, /visitor-wifi\.pdf/);
  assert.match(pdf, /Open file/);
  assert.doesNotMatch(pdf, /Reindex/);
  assert.doesNotMatch(pdf, />Delete</);

  const markdown = renderGuide(guide({
    extension: '.md',
    originalName: 'leave.md',
    previewHtml: '<script>alert(1)</script>',
    extractedText: '# Leave policy\n\nRequest leave at https://hr.example/leave.',
  }), false);
  assert.match(markdown, /<h1><span>Leave policy<\/span><\/h1>/);
  assert.match(markdown, /href="https:\/\/hr\.example\/leave"/);
  assert.doesNotMatch(markdown, /<script|alert\(1\)/);

  const workspace = read('src/app/dashboard/internal-docs/InternalDocsWorkspace.tsx');
  const askPanel = read('src/app/dashboard/internal-docs/FaqAskPanel.tsx');
  const fileRoute = read('src/app/api/internal-docs/[id]/file/route.ts');
  const detailRoute = read('src/app/api/internal-docs/[id]/route.ts');
  const imageRoute = read('src/app/api/internal-docs/[id]/images/[index]/route.ts');
  assert.match(workspace, /<GuideReader/);
  assert.match(workspace, /<FaqAskPanel/);
  assert.match(askPanel, /aria-label="Ask FAQ & Guides"/);
  assert.match(askPanel, /Ask anything about company guides/);
  assert.match(askPanel, /data-testid="faq-answer-pdf"/);
  assert.match(askPanel, /data-testid="faq-answer-image"/);
  assert.match(askPanel, /Open PDF/);
  assert.ok(workspace.indexOf('<FaqAskPanel') < workspace.indexOf('data-testid="internal-docs-dropzone"'));
  assert.ok(workspace.indexOf('data-testid="internal-docs-dropzone"') < workspace.indexOf('<GuideReader'));
  assert.match(workspace, /data-testid="internal-docs-dropzone"/);
  assert.match(workspace, /multiple/);
  assert.match(workspace, /highlight=\{highlight\}/);
  const href = citationDocumentHref({
    documentId,
    excerpt: 'The visitor wifi password is printed at reception.',
  });
  assert.match(href, /highlight=/);
  assert.match(decodeURIComponent(href), /visitor wifi password/);
  assert.equal(guideHighlightNeedle('  wifi   password  '), 'wifi password');
  assert.match(imageRoute, /collectDocxImages/);
  assert.match(imageRoute, /requireInternalDocsUser/);
  assert.match(imageRoute, /nosniff/);
  assert.match(detailRoute, /docxPreviewHtml\(await readFile\(stored\), row\.id\)/);
  assert.match(fileRoute, /contentDispositionFor/);
  assert.match(fileRoute, /inlineDocumentRequested/);
  assert.doesNotMatch(fileRoute, /public\//);
  assert.match(detailRoute, /docxPreviewHtml/);
  assert.match(detailRoute, /previewHtml/);
});
