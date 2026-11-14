import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  eventPlanInputBlock,
  mergeQuotedBudget,
  parseParticipantCount,
  parseQuotationLines,
  parseSpeakerNames,
  quotationGrandTotal,
} from '../src/lib/event-plan-quotation';
import { quotationExtension } from '../src/lib/event-plan-quotation-file';

test('confirmed quotation totals stay in IDR and keep a contingency', () => {
  const lines = parseQuotationLines([
    { vendor: 'Kempinski', item: 'Ballroom', category: 'Venue', qty: 1, unitPrice: 25_000_000, currency: 'idr' },
    { vendor: 'Catering Co', item: 'Lunch', category: 'Catering', qty: 100, unitPrice: 150_000 },
    { vendor: 'Foreign AV', item: 'Lights', category: 'Production', qty: 1, unitPrice: 100, total: 100, currency: 'USD' },
    { item: '' },
  ]);
  assert.equal(lines[0].total, 25_000_000);
  assert.equal(lines[1].total, 15_000_000);
  const totals = quotationGrandTotal(lines, 10);
  assert.equal(totals.subtotal, 40_000_000);
  assert.equal(totals.contingency, 4_000_000);
  assert.equal(totals.total, 44_000_000);
  const merged = mergeQuotedBudget({ currency: 'IDR', total: null, items: [{ category: 'Promotion', estimatedCost: null, notes: 'No public price' }] }, lines, 10);
  const items = merged.items as Array<{ source: string; category: string }>;
  assert.equal(items.filter(item => item.source === 'quotation').length, 3);
  assert.equal(items.find(item => item.category === 'Promotion')?.source, 'estimate');
});

test('speakers, participants, and the venue reach the plan brief', () => {
  assert.deepEqual(parseSpeakerNames([' Rina ', 'Rina', 'Bayu']), ['Rina', 'Bayu']);
  assert.equal(parseParticipantCount('0'), null);
  assert.equal(parseParticipantCount('120'), 120);
  const block = eventPlanInputBlock({
    venueName: 'Grand Ballroom',
    participants: 120,
    speakers: ['Rina'],
    quotations: parseQuotationLines([{ vendor: 'Kempinski', item: 'Ballroom', category: 'Venue', qty: 1, unitPrice: 1000, total: 1000 }]),
    contingencyPercent: 10,
  });
  assert.match(block, /Grand Ballroom/);
  assert.match(block, /120/);
  assert.match(block, /Rina/);
  assert.match(block, /CONFIRMED_QUOTATIONS/);
  assert.match(block, /AI estimate/);
});

test('quotation uploads accept documents and images and reject other files', () => {
  assert.equal(quotationExtension('quote.PDF', 'application/octet-stream'), 'pdf');
  assert.equal(quotationExtension('sheet.xlsx', ''), 'xlsx');
  assert.equal(quotationExtension('photo.PNG', 'image/png'), 'png');
  assert.equal(quotationExtension('macro.exe', 'application/octet-stream'), null);
  const route = readFileSync('src/app/api/event-plan/generate/route.ts', 'utf8');
  const page = readFileSync('src/app/dashboard/event-plan/page.tsx', 'utf8');
  assert.match(route, /mergeQuotedBudget/);
  assert.match(route, /Named venue|planInputs/);
  assert.match(page, /Venue name/);
  assert.match(page, /Target participants/);
  assert.match(page, /EventQuotationTable/);
});
