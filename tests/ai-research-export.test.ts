import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { buildResearchDocx } from '../src/lib/ai-research-docx';
import {
  buildResearchMarkdownExport,
  buildResearchPdf,
  researchAnswerToPlainText,
  researchExportFilename,
} from '../src/lib/ai-research-export';

const read = (path: string) => readFileSync(path, 'utf8');

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
  assert.match(markdown, /Mode: Deep/);
  assert.match(markdown, /2026-09-23/);
  assert.match(markdown, /## Answer/);
  assert.match(markdown, /Emas menguat/);
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
  assert.match(text, /Kesenjangan dan keterbatasan/);
  assert.match(text, /https:\/\/www\.bi\.go\.id\/emas/);
  assert.match(text, /Dupoin AI Research/);
  assert.match(text, /Check the facts against the sources/);
  assert.match(text, /Page 1 of /);
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
  assert.match(xml, /Mode/);
  assert.match(xml, /Deep/);
  assert.match(xml, /2026-09-30/);
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
  assert.equal(
    researchExportFilename('Who is Sella?', 'docx', exportedAt),
    'dupoin-ai-research-Who-is-Sella-2026-09-30.docx',
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
  assert.match(actions, /deliverResearchFile/);
  assert.match(actions, /data-testid="ai-research-export"/);
  assert.match(actions, /data-testid="ai-research-download-pdf"/);
  assert.match(actions, /data-testid="ai-research-download-word"/);
  assert.match(chatFiles, /Research PDF/);
  assert.match(chatFiles, /Open PDF/);
  assert.match(chatFiles, /Download PDF/);
  assert.match(chatFiles, /Research Word/);
  assert.match(chatFiles, /Download Word/);
  assert.match(chatFiles, /data-testid="ai-research-chat-files"/);
  assert.match(chatFiles, /data-testid="ai-research-open-pdf"/);
  assert.doesNotMatch(chatFiles, /Unduh|Buka PDF|melalui chat/);
  assert.match(download, /buildResearchPdf/);
  assert.match(download, /buildResearchDocxBlob/);
  assert.match(download, /target = '_blank'/);
});
