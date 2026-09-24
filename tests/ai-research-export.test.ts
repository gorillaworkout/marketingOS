import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.doesNotMatch(text, /official brand/i);
});

test('AI Research answer actions expose markdown copy and both downloads', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const actions = read('src/components/AiResearchExportActions.tsx');
  assert.match(page, /AiResearchExportActions/);
  assert.match(actions, /Copy Markdown/);
  assert.match(actions, /Download \.md/);
  assert.match(actions, /Download PDF/);
  assert.match(actions, /buildResearchMarkdownExport/);
  assert.match(actions, /buildResearchPdf/);
  assert.match(actions, /data-testid="ai-research-export"/);
});
