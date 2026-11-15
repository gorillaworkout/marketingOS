import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { extractText, getDocumentProxy } from 'unpdf';
import { buildProposalDocument, parseProposalInput, templateContent } from '../src/lib/partnership/proposal';
import { DEFAULT_PROPOSAL_SETTINGS } from '../src/lib/partnership/proposal-settings';
import { exportFileName, exportProposal } from '../src/lib/partnership/proposal-export';
import { slideGroups } from '../src/lib/partnership/proposal-slides';
import { accountFeatureFromPath, isDashboardNavItemVisible } from '../src/lib/authorization';

const read = (file: string) => readFileSync(file, 'utf8');

function sample(overrides: Record<string, unknown> = {}) {
  const parsed = parseProposalInput({
    partnerName: 'Tadakado Indonesia',
    exposures: ['ig-feed-collab', 'ig-story', 'article', 'media-coverage'].map(itemId => ({ itemId, units: 1 })),
    needs: [{ description: 'vouchers', quantity: 1000, unitValue: 30000 }],
    offline: [{ materialId: 'x-banner' }],
    language: 'en',
    year: '2026',
    ...overrides,
  }, DEFAULT_PROPOSAL_SETTINGS);
  assert.ok('value' in parsed);
  const content = templateContent(parsed.value);
  return buildProposalDocument(parsed.value, content, DEFAULT_PROPOSAL_SETTINGS, null);
}

async function pdfText(data: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text: String(text).replace(/\s+/g, ' '), totalPages };
}

test('slide PDF has the cover, contents, five numbered groups, and computed totals', async () => {
  const doc = sample();
  assert.deepEqual(slideGroups(doc).map(group => group.number), ['01', '02', '03', '04', '05']);
  const out = await exportProposal(doc, 'slide', 'pdf');
  assert.equal(out.mime, 'application/pdf');
  assert.equal(out.data.subarray(0, 5).toString(), '%PDF-');
  const { text, totalPages } = await pdfText(out.data);
  assert.equal(totalPages, out.pages);
  assert.ok(out.pages >= 19, `pages ${out.pages}`);
  assert.match(text, /Collaboration Proposal with Tadakado Indonesia/);
  assert.match(text, /423\/BAPPEBTI\/SI\/VII\/2004/);
  assert.match(text, /Rp 28\.000\.000,-/);
  assert.match(text, /Rp 58\.000\.000,-/);
  assert.match(text, /Top Futures Broker/);
});

test('turning sections off removes their slides and renumbers groups', async () => {
  const doc = sample();
  const full = await exportProposal(doc, 'slide', 'pdf');
  doc.content.include.collaborationScheme = false;
  doc.content.include.awards = false;
  assert.deepEqual(slideGroups(doc).map(group => `${group.number} ${group.title}`), ['01 Project Overview', '02 About Dupoin Futures Indonesia', '03 Digital Exposures', '04 Collaboration Package']);
  const trimmed = await exportProposal(doc, 'slide', 'pdf');
  assert.equal(trimmed.pages, full.pages - 4);
});

test('PPTX has one slide per PDF page, native tables, and the same totals', async () => {
  const doc = sample();
  const pdf = await exportProposal(doc, 'slide', 'pdf');
  const pptx = await exportProposal(doc, 'slide', 'pptx');
  assert.equal(pptx.mime, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  const zip = await JSZip.loadAsync(pptx.data);
  const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slides.length, pdf.pages);
  const xml = (await Promise.all(slides.map(name => zip.file(name)!.async('string')))).join('');
  assert.match(xml, /Rp 58\.000\.000,-/);
  assert.match(xml, /<a:tbl>/);
  await assert.rejects(exportProposal(doc, 'document', 'pptx'), /Slide 16:9 template only/);
});

test('A4 document PDF follows the Kopi Kenangan structure with exposure, offline, and value package tables', async () => {
  const doc = sample({ partnerName: 'Kopi Kenangan', language: 'id', template: 'document', needs: [], exposures: ['ig-feed-collab', 'ig-story', 'article', 'media-coverage', 'home-banner'].map(itemId => ({ itemId, units: 1 })) });
  const out = await exportProposal(doc, 'document', 'pdf');
  const { text, totalPages } = await pdfText(out.data);
  assert.equal(totalPages, out.pages);
  assert.ok(out.pages >= 4 && out.pages <= 8, `pages ${out.pages}`);
  for (const phrase of ['Dupoin Futures Indonesia x Kopi Kenangan', 'Gambaran Proyek', 'Tentang Dupoin Indonesia', 'JFX, KBI, dan ASPEBTINDO', 'Eksposur Digital', 'Materi Promosi Offline', 'Nilai Paket Kolaborasi', 'Total nilai eksposur digital: Rp 78.000.000,-', '(TBD)', '70+']) {
    assert.ok(text.includes(phrase), phrase);
  }
  assert.equal(exportFileName('Kopi Kenangan!', 'document', 'pdf'), 'Dupoin-x-Kopi-Kenangan-A4.pdf');
});

test('Proposal Builder sits under Partnership in the sidebar, gated by the partnership feature', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /href: '\/dashboard\/partnership\/proposal-builder', label: 'Proposal Builder', icon: '[a-z]+', feature: 'partnership'/);
  assert.ok(existsSync('src/app/dashboard/partnership/proposal-builder/page.tsx'));
  assert.equal(accountFeatureFromPath('/dashboard/partnership/proposal-builder'), 'partnership');
  const item = { href: '/dashboard/partnership/proposal-builder', feature: 'partnership' as const };
  assert.equal(isDashboardNavItemVisible(item, { role: 'member', features: ['seo'] }), false);
  assert.equal(isDashboardNavItemVisible(item, { role: 'member', features: ['partnership'] }), true);
});

test('every proposal API handler requires the partnership feature; settings writes are admin-only', () => {
  const routes = [
    'src/app/api/partnership/proposals/route.ts',
    'src/app/api/partnership/proposals/[id]/route.ts',
    'src/app/api/partnership/proposals/[id]/draft/route.ts',
    'src/app/api/partnership/proposals/[id]/export/route.ts',
    'src/app/api/partnership/proposals/[id]/versions/[versionId]/route.ts',
    'src/app/api/partnership/proposal-settings/route.ts',
  ];
  for (const route of routes) {
    const source = read(route);
    const handlers = [...source.matchAll(/export async function (GET|POST|PUT|DELETE)\b[\s\S]*?\n}/g)];
    assert.ok(handlers.length > 0, route);
    for (const handler of handlers) assert.match(handler[0], /requireFeature\(request, 'partnership'\)/, `${route} ${handler[1]}`);
  }
  const settings = read('src/app/api/partnership/proposal-settings/route.ts');
  for (const method of ['PUT', 'DELETE']) {
    const handler = settings.match(new RegExp(`export async function ${method}\\b[\\s\\S]*?\\n}`))?.[0] ?? '';
    assert.match(handler, /auth\.role !== 'admin'/, method);
  }
  assert.match(read('src/lib/partnership/proposal-draft.ts'), /generateContent\(/);
});

test('migration 058 is additive with a rollback', () => {
  const sql = read('db/migrations/058_partnership_proposals.sql');
  assert.match(sql, /^\s*(--[^\n]*\n\s*)*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /DROP |DELETE FROM|TRUNCATE|ALTER TABLE/i);
  for (const table of ['partnership_proposals', 'partnership_proposal_versions', 'partnership_settings']) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), table);
  const rollback = read('db/rollbacks/058_partnership_proposals_down.sql');
  for (const table of ['partnership_proposal_versions', 'partnership_proposals', 'partnership_settings']) assert.match(rollback, new RegExp(`DROP TABLE IF EXISTS ${table}`), table);
  assert.match(rollback, /DELETE FROM schema_migrations WHERE name = '058_partnership_proposals.sql'/);
});
