import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { buildResearchDocx } from '../src/lib/ai-research-docx';
import {
  buildResearchHtmlExport,
  buildResearchMarkdownExport,
  buildResearchPdf,
  buildResearchSourcesMarkdown,
  buildResearchZip,
  researchAnswerToPlainText,
  researchExportFilename,
} from '../src/lib/ai-research-export';

const read = (path: string) => readFileSync(path, 'utf8');

async function wordPackageText(zip: JSZip): Promise<string> {
  const names = Object.keys(zip.files).filter(name => name.endsWith('.xml') || name.endsWith('.rels'));
  const parts = await Promise.all(names.map(name => zip.file(name)?.async('string') || Promise.resolve('')));
  return parts.join('\n');
}

test('markdown export includes the query, answer, and source URLs', () => {
  const exportedAt = new Date('2026-09-23T00:00:00.000Z');
  const markdown = buildResearchMarkdownExport({
    title: 'Harga emas Indonesia',
    answer: 'Emas menguat. [Bappebti](https://bappebti.go.id/emas)',
    mode: 'deep',
    exportedAt,
    sources: [
      { title: 'Bappebti ] emas', url: 'https://bappebti.go.id/emas' },
      { title: 'dup', url: 'https://bappebti.go.id/emas/' },
      { title: 'blocked', url: 'javascript:alert(1)' },
    ],
  });
  assert.match(markdown, /^# Harga emas Indonesia/);
  assert.equal(markdown.split('Harga emas Indonesia').length - 1, 1);
  assert.doesNotMatch(markdown, /Dupoin AI Research/);
  assert.doesNotMatch(markdown, /Research question/);
  assert.match(markdown, /Deep research · 23 September 2026/);
  assert.doesNotMatch(markdown, /Assistant:/);
  assert.doesNotMatch(markdown, /Mode: Deep/);
  assert.match(markdown, /## Answer/);
  const answerPart = markdown.split('## Answer')[1]?.split('## Sources')[0] || '';
  assert.match(answerPart, /Emas menguat/);
  assert.doesNotMatch(answerPart, /Harga emas Indonesia/);
  assert.match(markdown, /## Sources/);
  assert.match(markdown, /\[Bappebti emas\]\(https:\/\/bappebti\.go\.id\/emas\)/);
  assert.equal(markdown.match(/bappebti\.go\.id\/emas/g)?.length, 2);
  assert.doesNotMatch(markdown, /javascript:/);
  assert.equal(
    researchExportFilename('Harga emas / Indonesia?', 'pdf', exportedAt),
    'dupoin-ai-research-Harga-emas-Indonesia-2026-09-23.pdf',
  );
  assert.equal(researchAnswerToPlainText('Lihat [Bappebti](https://bappebti.go.id/emas).'), 'Lihat Bappebti (https://bappebti.go.id/emas).');
});

test('pdf export is a multi-page Dupoin document with the answer and sources', () => {
  const pdf = Buffer.from(buildResearchPdf({
    title: 'Harga emas café',
    answer: `${'Emas menguat karena permintaan fisik. '.repeat(400)}\n\n## Kesenjangan dan keterbatasan\n\nSumber belum menyebut volume transaksi.`,
    mode: 'fast',
    exportedAt: new Date('2026-09-23T00:00:00.000Z'),
    sources: [{ title: 'Bank Indonesia', url: 'https://www.bi.go.id/emas' }],
  }));
  const text = pdf.toString('latin1');
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /%%EOF$/);
  assert.ok((text.match(/\/Type \/Page\b/g) || []).length >= 2);
  assert.match(text, /Harga emas caf/);
  assert.match(text, /\\351/);
  assert.match(text, /Fast research/);
  assert.match(text, /23 September 2026/);
  assert.match(text, /Kesenjangan dan keterbatasan/);
  assert.match(text, /https:\/\/www\.bi\.go\.id\/emas/);
  assert.doesNotMatch(text, /Dupoin AI Research/);
  assert.match(text, /Check the facts against the sources/);
  assert.match(text, /Page 1 of /);
  assert.doesNotMatch(text, /Assistant:/);
  assert.doesNotMatch(text, /Copy Markdown|Download Word|Open PDF|Research PDF/);
  assert.doesNotMatch(text, /Halaman/);
  assert.doesNotMatch(text, /official brand/i);
});

test('docx export is a Word file with the question, answer, and separated sources', async () => {
  const exportedAt = new Date('2026-09-30T00:00:00.000Z');
  const bytes = await buildResearchDocx({
    title: 'Who is Sella Susriana at Dupoin?',
    answer: [
      'Official role first.',
      '',
      '## Other public traces',
      '',
      'A different profile may exist. [Bappebti](https://bappebti.go.id/wakil)',
      '',
      '| Trace | Note |',
      '| --- | --- |',
      '| Roster | Official |',
    ].join('\n'),
    mode: 'deep',
    exportedAt,
    sources: [
      {
        title: 'Bappebti roster',
        url: 'https://bappebti.go.id/wakil',
        official: true,
        traceKind: 'person_fact',
        originChip: 'official',
        snippet: 'Nama: Sella Susriana',
      },
      {
        title: 'Other profile',
        url: 'https://example.com/sella',
        official: false,
        traceKind: 'other_public_trace',
        originChip: 'international',
        snippet: 'Freelancer listing',
      },
    ],
  });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('string');
  assert.ok(xml);
  assert.match(xml, /Who is Sella Susriana at Dupoin\?/);
  assert.equal(xml.split('Who is Sella Susriana at Dupoin?').length - 1, 1);
  assert.match(xml, /Deep research/);
  assert.match(xml, /30 September 2026/);
  assert.doesNotMatch(xml, /Assistant:/);
  assert.doesNotMatch(xml, /Copy Markdown|Download Word|Open PDF|Research PDF|Follow-up questions/);
  assert.match(xml, /Official role first/);
  assert.match(xml, /Other public traces/);
  assert.match(xml, /Official Dupoin \/ Bappebti/);
  assert.match(xml, /Other sources/);
  assert.match(xml, /Bappebti roster/);
  assert.match(xml, /Official Dupoin\/Bappebti roster/);
  assert.match(xml, /Nama: Sella Susriana/);
  assert.match(xml, /Freelancer listing/);
  assert.match(xml, /Other public trace/);
  assert.match(xml, /Check the facts against the sources/);
  const rels = await zip.file('word/_rels/document.xml.rels')?.async('string') || '';
  assert.match(rels, /https:\/\/bappebti\.go\.id\/wakil/);
  assert.match(rels, /https:\/\/example\.com\/sella/);
  const header = await zip.file('word/header1.xml')?.async('string') || '';
  assert.doesNotMatch(header, /Dupoin AI Research/);
  const footer = await zip.file('word/footer1.xml')?.async('string') || '';
  assert.match(footer, /Page /);
  assert.doesNotMatch(footer, /Dupoin AI Research/);
  const packaged = await wordPackageText(zip);
  assert.doesNotMatch(packaged, /Dupoin AI Research/);
  assert.equal(
    researchExportFilename('Who is Sella?', 'docx', exportedAt),
    'dupoin-ai-research-Who-is-Sella-2026-09-30.docx',
  );
});

test('export brief uses the question once as the subject and drops chat chrome', async () => {
  const question = 'Who is Sella Susriana at Dupoin?';
  const exportedAt = new Date('2026-09-30T00:00:00.000Z');
  const title = [
    'Compare the two items below in a balanced way.',
    'A: Antam gold',
    'B: Pegadaian gold',
    'Focus: retail prices',
    'Use only evidence from the sources that were found. Do not invent prices or facts.',
  ].join('\n');
  const compare = buildResearchMarkdownExport({
    title,
    answer: 'Antam lists a retail price.',
    mode: 'fast',
    exportedAt,
    sources: [],
  });
  assert.match(compare, /Antam gold vs Pegadaian gold — retail prices/);
  assert.doesNotMatch(compare, /Compare the two items below/);
  assert.doesNotMatch(compare, /Do not invent prices/);
  assert.match(compare, /Fast research · 30 September 2026/);

  const echoed = {
    title: question,
    answer: [
      `# ${question}`,
      '',
      'Copy Markdown',
      '',
      `${question} She is listed on the Bappebti roster.`,
      '',
      'Download Word',
      '',
      'Download HTML',
      '',
      'Research ZIP',
      '',
      '## Other public traces',
      '',
      'A different profile may exist.',
    ].join('\n'),
    mode: 'deep' as const,
    exportedAt,
    sources: [{ title: 'Bappebti roster', url: 'https://bappebti.go.id/wakil', official: true }],
  };
  const markdown = buildResearchMarkdownExport(echoed);
  assert.equal(markdown.split(question).length - 1, 1);
  const echoedAnswer = markdown.split('## Answer')[1]?.split('## Sources')[0] || '';
  assert.match(echoedAnswer, /She is listed on the Bappebti roster/);
  assert.match(echoedAnswer, /### Other public traces/);
  assert.doesNotMatch(echoedAnswer, /^## /m);
  assert.doesNotMatch(echoedAnswer, /Who is Sella/);
  assert.doesNotMatch(markdown, /Copy Markdown|Download Word|Download HTML|Research ZIP|Open PDF|Research Word/);
  assert.doesNotMatch(markdown, /Dupoin AI Research/);

  const pdf = Buffer.from(buildResearchPdf(echoed)).toString('latin1');
  assert.equal(pdf.split(question).length - 1, 1);
  assert.match(pdf, /She is listed on the Bappebti roster/);
  assert.match(pdf, /Official Dupoin \/ Bappebti/);
  assert.doesNotMatch(pdf, /Copy Markdown|Download Word/);

  const bytes = await buildResearchDocx(echoed);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('string') || '';
  assert.equal(xml.split(question).length - 1, 1);
  assert.match(xml, /She is listed on the Bappebti roster/);
  assert.match(xml, /Other public traces/);
  assert.doesNotMatch(xml, /Copy Markdown|Download Word|Open PDF/);
});

test('html export is a self-contained brief without a letterhead', () => {
  const html = buildResearchHtmlExport({
    title: 'Who is Sella Susriana at Dupoin?',
    answer: [
      'Official role first.',
      '',
      '## Other public traces',
      '',
      'A different profile may exist. [Bappebti](https://bappebti.go.id/wakil)',
      '',
      '<script>alert(1)</script>',
      '',
      '| Trace | Note |',
      '| --- | --- |',
      '| Roster | Official |',
    ].join('\n'),
    mode: 'deep',
    exportedAt: new Date('2026-09-30T00:00:00.000Z'),
    sources: [
      {
        title: 'Bappebti roster',
        url: 'https://bappebti.go.id/wakil',
        official: true,
        traceKind: 'person_fact',
        snippet: 'Nama: Sella Susriana',
      },
      {
        title: 'Other profile',
        url: 'https://example.com/sella',
        official: false,
        traceKind: 'other_public_trace',
        snippet: 'Freelancer listing',
      },
    ],
  });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Who is Sella Susriana at Dupoin\?<\/title>/);
  assert.equal(html.split('Who is Sella Susriana at Dupoin?').length - 1, 2);
  assert.match(html, /<h1>Who is Sella Susriana at Dupoin\?<\/h1>/);
  assert.match(html, /<p class="meta">Deep research · 30 September 2026<\/p>/);
  assert.match(html, /<h2>Answer<\/h2>/);
  assert.match(html, /<p>Official role first\.<\/p>/);
  assert.match(html, /<h4>Other public traces<\/h4>/);
  assert.match(html, /<a href="https:\/\/bappebti\.go\.id\/wakil">Bappebti<\/a>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th scope="col">Trace<\/th>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<h2>Sources<\/h2>/);
  assert.match(html, /<h3>Official Dupoin \/ Bappebti<\/h3>/);
  assert.match(html, /<h3>Other sources<\/h3>/);
  assert.match(html, /<a href="https:\/\/bappebti\.go\.id\/wakil">Bappebti roster<\/a>/);
  assert.match(html, /Official Dupoin\/Bappebti roster/);
  assert.match(html, /Nama: Sella Susriana/);
  assert.match(html, /Freelancer listing/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<link /);
  assert.match(html, /Check the facts against the sources/);
  assert.doesNotMatch(html, /Dupoin AI Research/);
  assert.doesNotMatch(html, /Download HTML|Open PDF|Copy Markdown|Research ZIP/);
  assert.equal(
    researchExportFilename('Who is Sella?', 'html', new Date('2026-09-30T00:00:00.000Z')),
    'dupoin-ai-research-Who-is-Sella-2026-09-30.html',
  );
});

test('zip export contains the markdown brief, html brief, and sources list', async () => {
  const exportedAt = new Date('2026-09-30T00:00:00.000Z');
  const input = {
    title: 'Who is Sella Susriana at Dupoin?',
    answer: 'Official role first.',
    mode: 'deep' as const,
    exportedAt,
    sources: [
      {
        title: 'Bappebti roster',
        url: 'https://bappebti.go.id/wakil',
        official: true,
        snippet: 'Nama: Sella Susriana',
      },
      {
        title: 'Other profile',
        url: 'https://example.com/sella',
        official: false,
      },
    ],
  };
  const bytes = await buildResearchZip(input);
  const zip = await JSZip.loadAsync(bytes);
  assert.deepEqual(Object.keys(zip.files).sort(), ['research.html', 'research.md', 'sources.md']);
  const markdown = await zip.file('research.md')?.async('string') || '';
  const html = await zip.file('research.html')?.async('string') || '';
  const sources = await zip.file('sources.md')?.async('string') || '';
  assert.equal(markdown, buildResearchMarkdownExport(input));
  assert.equal(html, buildResearchHtmlExport(input));
  assert.equal(sources, buildResearchSourcesMarkdown(input));
  assert.match(markdown, /^# Who is Sella Susriana at Dupoin\?/);
  assert.match(markdown, /Official role first/);
  assert.match(html, /<h1>Who is Sella Susriana at Dupoin\?<\/h1>/);
  assert.match(html, /<h2>Answer<\/h2>/);
  assert.match(sources, /^# Sources/);
  assert.match(sources, /### Official Dupoin \/ Bappebti/);
  assert.match(sources, /### Other sources/);
  assert.match(sources, /\[Bappebti roster\]\(https:\/\/bappebti\.go\.id\/wakil\)/);
  assert.match(sources, /Nama: Sella Susriana/);
  assert.doesNotMatch(sources, /Official role first/);
  assert.doesNotMatch(`${markdown}\n${html}\n${sources}`, /Dupoin AI Research/);
  assert.equal(
    researchExportFilename(input.title, 'zip', exportedAt),
    'dupoin-ai-research-Who-is-Sella-Susriana-at-Dupoin-2026-09-30.zip',
  );
});

test('AI Research answer actions expose markdown copy and PDF and Word downloads', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const actions = read('src/components/AiResearchExportActions.tsx');
  const chatFiles = read('src/components/AiResearchChatFiles.tsx');
  const download = read('src/lib/ai-research-client-download.ts');
  assert.match(page, /AiResearchChatFiles/);
  assert.match(page, /AiResearchExportActions/);
  assert.match(page, /answerDeliverable\(messages, i, inspectorSources\)/);
  assert.match(page, /index === messages\.length - 1 && inspectorSources\.length \? inspectorSources : message\.sources/);
  assert.match(actions, /Copy Markdown/);
  assert.match(actions, /Download \.md/);
  assert.match(actions, /Download PDF/);
  assert.match(actions, /Download Word/);
  assert.match(actions, /Download HTML/);
  assert.match(actions, /Download ZIP/);
  assert.match(actions, /deliverResearchFile/);
  assert.match(actions, /data-testid="ai-research-export"/);
  assert.match(actions, /data-testid="ai-research-download-pdf"/);
  assert.match(actions, /data-testid="ai-research-download-word"/);
  assert.match(actions, /data-testid="ai-research-download-html"/);
  assert.match(actions, /data-testid="ai-research-download-zip"/);
  assert.match(chatFiles, /Research PDF/);
  assert.match(chatFiles, /Open PDF/);
  assert.match(chatFiles, /Download PDF/);
  assert.match(chatFiles, /Research Word/);
  assert.match(chatFiles, /Download Word/);
  assert.match(chatFiles, /Research HTML/);
  assert.match(chatFiles, /Open HTML/);
  assert.match(chatFiles, /Download HTML/);
  assert.match(chatFiles, /Research ZIP/);
  assert.match(chatFiles, /Download ZIP/);
  assert.match(chatFiles, /data-testid="ai-research-chat-files"/);
  assert.match(chatFiles, /data-testid="ai-research-open-pdf"/);
  assert.match(chatFiles, /data-testid="ai-research-open-html"/);
  assert.match(chatFiles, /data-testid="ai-research-chat-download-zip"/);
  assert.doesNotMatch(chatFiles, /Unduh|Buka PDF|melalui chat/);
  assert.match(download, /buildResearchPdf/);
  assert.match(download, /buildResearchHtmlExport/);
  assert.match(download, /buildResearchZip/);
  assert.match(download, /buildResearchDocxBlob/);
  assert.match(download, /target = '_blank'/);
});
