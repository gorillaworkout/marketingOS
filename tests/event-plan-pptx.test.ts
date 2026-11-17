import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { buildEventPlanDeck, eventPlanPptxFilename, liveDeckBudget, parseTimeline, stripEmoji } from '../src/lib/event-plan-deck';
import { exportEventPlanPptx } from '../src/lib/event-plan-pptx';
import { mergeQuotedBudget } from '../src/lib/event-plan-quotation';
import { DUPOIN_VERIFIED_AWARDS } from '../src/lib/brand-fact-guard';
import { SAMPLE_EVENT_PLAN } from './fixtures/event-plan-deck-sample';

const read = (file: string) => readFileSync(file, 'utf8');

async function slideTexts(data: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return Promise.all(names.map(async name => {
    const xml = await zip.file(name)!.async('string');
    return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(' ').replace(/&amp;/g, '&');
  }));
}

test('timeline text splits into milestones, rundown, KPIs, and risks without new content', () => {
  const parsed = parseTimeline(String(SAMPLE_EVENT_PLAN.option.timeline));
  assert.equal(parsed.timeline.length, 7);
  assert.deepEqual(parsed.timeline[0], { label: 'H-45', text: 'Konfirmasi venue dan tanda tangan quotation Kempinski' });
  assert.equal(parsed.rundown.length, 6);
  assert.deepEqual(parsed.rundown[0], { time: '17.30 – 18.30', activity: 'Registrasi peserta dan welcome drink' });
  assert.equal(parsed.kpis.length, 4);
  assert.equal(parsed.risks.length, 4);
  assert.deepEqual(parseTimeline(''), { rundown: [], timeline: [], kpis: [], risks: [] });
});

test('the deck budget follows the current quotation table, not the stored one', () => {
  const stored = mergeQuotedBudget({ items: [{ category: 'Speakers', estimatedCost: null, notes: 'x' }] }, [
    { vendor: 'Old', item: 'Old hall', category: 'Venue', qty: 1, unitPrice: 10_000_000, total: 10_000_000, currency: 'IDR', notes: '' },
  ], 10);
  const edited = liveDeckBudget(stored, [
    { vendor: 'New Hall', item: 'Ballroom', category: 'Venue', qty: 1, unitPrice: 20_000_000, total: 20_000_000, currency: 'IDR', notes: '' },
    { vendor: 'Caterer', item: 'Dinner', category: 'Catering', qty: 100, unitPrice: 100_000, total: 10_000_000, currency: 'IDR', notes: '' },
  ], 5)!;
  assert.deepEqual(edited.rows.map(row => `${row.source}:${row.vendor}`), ['quotation:New Hall', 'quotation:Caterer', 'estimate:']);
  assert.equal(edited.quotationSubtotal, 30_000_000);
  assert.equal(edited.contingency, 1_500_000);
  assert.equal(edited.total, 31_500_000);
  assert.equal(edited.unpricedCount, 1);

  // Removing every quotation drops its contingency and total.
  const cleared = liveDeckBudget(stored, [], 10)!;
  assert.equal(cleared.quotationSubtotal, null);
  assert.equal(cleared.contingency, null);
  assert.equal(cleared.total, null);
});

test('an unchanged quotation table reproduces the stored budget totals', () => {
  const lines = SAMPLE_EVENT_PLAN.quotations!;
  const stored = mergeQuotedBudget(SAMPLE_EVENT_PLAN.option.budget as Record<string, unknown>, lines, 10);
  const live = liveDeckBudget(stored, lines, 10)!;
  assert.equal(live.total, stored.total);
  assert.equal(live.contingency, stored.contingency);
});

test('sections without data are left out of the deck', async () => {
  const out = await exportEventPlanPptx({ eventName: 'Small meetup', option: { objective: 'Meet local traders.' } });
  const texts = await slideTexts(out.data);
  assert.equal(out.slides, texts.length);
  assert.equal(texts.length, 3, texts.join('\n---\n'));
  assert.match(texts[0], /Small meetup/);
  assert.match(texts[1], /Meet local traders\./);
  const all = texts.join(' ');
  for (const absent of ['Speakers', 'Rundown', 'Budget', 'Timeline', 'KPIs', 'Risks', 'Venue']) assert.doesNotMatch(all, new RegExp(absent));
});

test('the sample plan exports every section with IDR totals and no extra awards', async () => {
  const out = await exportEventPlanPptx(SAMPLE_EVENT_PLAN, new Date('2026-11-17T00:00:00Z'));
  assert.equal(out.fileName, 'DUPOIN_Dupoin_Market_Outlook_2027_Gold_Forex_Strategy_Night_EventPlan_2026-11-17.pptx');
  assert.equal(out.data.subarray(0, 2).toString(), 'PK');
  const texts = await slideTexts(out.data);
  assert.equal(texts.length, out.slides);
  const all = texts.join(' ');
  for (const title of ['Objective & concept', 'Event at a glance', 'Speakers', 'Rundown & agenda', 'Venue & logistics', 'Budget summary (IDR)', 'Budget breakdown (IDR)', 'Timeline & checklist', 'KPIs & success metrics', 'Risks & mitigation', 'Terima kasih']) {
    assert.ok(all.includes(title), `missing ${title}`);
  }
  // 228.750.000 quotation + 10% contingency 22.875.000 + the 3.500.000 priced estimate.
  // The 15.000.000 Promotion estimate is dropped because the quotation covers Promotion.
  assert.match(all, /Rp 228\.750\.000/);
  assert.match(all, /Rp 22\.875\.000/);
  assert.match(all, /TOTAL Rp 255\.125\.000/);
  assert.doesNotMatch(all, /Rp 15\.000\.000/);
  assert.match(all, /To be quoted/);
  assert.match(all, /Andreas Wijaya/);
  assert.match(all, /423\/BAPPEBTI\/SI\/VII\/2004/);
  assert.doesNotMatch(all, /💼/);
  // Awards are not part of an event plan deck; none may appear.
  for (const award of DUPOIN_VERIFIED_AWARDS) assert.ok(!all.includes(award.fact), `unexpected award ${award.fact}`);
  assert.doesNotMatch(all, /award/i);
  assert.doesNotMatch(all, /FCSI/);
});

test('long tables and lists continue on extra slides', async () => {
  const quotations = Array.from({ length: 36 }, (_, i) => ({ vendor: `Vendor ${i + 1}`, item: `Item ${i + 1} with a longer description of what is delivered`, category: 'Production', qty: 1, unitPrice: 1_000_000, total: 1_000_000, currency: 'IDR', notes: '' }));
  const speakers = Array.from({ length: 12 }, (_, i) => `Speaker ${i + 1}`);
  const out = await exportEventPlanPptx({ ...SAMPLE_EVENT_PLAN, quotations, speakers });
  const texts = await slideTexts(out.data);
  const tableSlides = texts.filter(t => t.includes('Budget breakdown (IDR)'));
  assert.ok(tableSlides.length >= 3, `table slides ${tableSlides.length}`);
  assert.ok(texts.some(t => t.includes('Budget breakdown (IDR) (cont.)')));
  assert.equal(texts.filter(t => /Speakers( \(cont\.\))?/.test(t) && t.includes('Speaker 1')).length >= 1, true);
  assert.ok(texts.some(t => t.includes('Speakers (cont.)')));
  for (let i = 1; i <= 36; i += 1) assert.ok(tableSlides.some(t => t.includes(`Vendor ${i} `) || t.endsWith(`Vendor ${i}`)), `row ${i} missing`);
  // Totals appear once, on the last table slide.
  assert.match(tableSlides[tableSlides.length - 1], /TOTAL/);
});

test('deck model ignores bad input and strips emoji', () => {
  assert.equal(stripEmoji('✨ Creative'), 'Creative');
  const deck = buildEventPlanDeck({ eventName: '  ', participants: -5, targetDate: 'tomorrow', option: { speakers: 'not a list', budget: 'nope' } as Record<string, unknown> });
  assert.equal(deck.eventName, 'Event plan');
  assert.equal(deck.participants, null);
  assert.equal(deck.targetDate, '');
  assert.equal(deck.budget, null);
  assert.equal(eventPlanPptxFilename('Gala / Night!', new Date('2026-01-02T00:00:00Z')), 'DUPOIN_Gala_Night_EventPlan_2026-01-02.pptx');
});

test('Event Plan and History pages offer Download PPT through the export route', () => {
  const page = read('src/app/dashboard/event-plan/page.tsx');
  assert.match(page, /Download PPT/);
  assert.match(page, /quotations, contingencyPercent/);
  const history = read('src/app/dashboard/history/page.tsx');
  assert.match(history, /selected\.type === 'event-plan' &&/);
  assert.match(history, /deckInputFromHistory/);
  const route = read('src/app/api/event-plan/export/route.ts');
  assert.match(route, /requireFeature\(request, 'event-plan'\)/);
});
