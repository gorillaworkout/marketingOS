import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getSmartSystemPrompt, getSystemPrompt } from '../src/lib/openai';
import {
  EVENT_PLAN_GROUNDED_BUDGET_RULES,
  NO_PUBLIC_PRICE_NOTE,
  buildPreliminaryBudget,
  formatVenueLine,
  normalizeGeneratedBudget,
  quoteRequestPath,
  resolveEventLocation,
  resolvePlanVenue,
} from '../src/lib/event-plan-budget';
import type { EventPricingHit } from '../src/lib/event-plan-pricing';

const root = process.cwd();

function assertQuotePath(item: { notes?: unknown; suggestedVendor?: unknown; venue?: unknown }, city: string) {
  assert.equal(typeof item.suggestedVendor, 'string');
  assert.ok(String(item.suggestedVendor).length > 3, 'suggested vendor must be a concrete name, not blank');
  assert.doesNotMatch(String(item.suggestedVendor), /^vendor$/i);
  assert.match(String(item.notes), new RegExp(NO_PUBLIC_PRICE_NOTE));
  assert.match(String(item.notes), /How to request a quotation/i);
  assert.match(String(item.notes), /Venue\/location/i);
  assert.match(String(item.venue), new RegExp(city, 'i'));
  assert.equal((item as { estimatedCost?: unknown }).estimatedCost, null);
  assert.doesNotMatch(String(item.notes), /\+62\s*\d/);
  assert.doesNotMatch(String(item.notes), /@[a-z0-9.-]+\.[a-z]{2,}/i);
}

test('Event Plan client consumes its SSE generator and shows grounded budget sources', async () => {
  const page = await readFile(resolve(root, 'src/app/dashboard/event-plan/page.tsx'), 'utf8');
  assert.match(page, /getReader\(\)/);
  assert.match(page, /data: /);
  assert.doesNotMatch(page, /const data = await res\.json\(\);/);
  assert.match(page, /type="date"/);
  assert.match(page, /formatIDR/);
  assert.match(page, /Budget breakdown/i);
  assert.match(page, /Suggested vendor/);
  assert.match(page, /Venue \/ location/);
  assert.match(page, /item\.suggestedVendor/);
  assert.match(page, /NO_PUBLIC_PRICE_NOTE/);
  assert.match(page, /Budget research sources/);
  assert.match(page, /source\.title/);
  assert.match(page, /source\.snippet/);
  assert.match(page, /Not known yet/);
  assert.doesNotMatch(page, /\{result\.venue &&/);
  assert.doesNotMatch(page, /Harga di bawah adalah estimasi AI/);
});

test('Event Plan generator researches public prices before writing the budget', async () => {
  const route = await readFile(resolve(root, 'src/app/api/event-plan/generate/route.ts'), 'utf8');
  assert.match(route, /"currency": "IDR"/);
  assert.match(route, /"items": \[/);
  assert.match(route, /"estimatedCost"/);
  assert.match(route, /Budget ceiling/);
  assert.match(route, /extractBalancedJsonObject/);
  assert.match(route, /normalizeGeneratedBudget/);
  assert.match(route, /researchEventPricing/);
  assert.match(route, /formatEventPricingPrompt/);
  assert.match(route, /EVENT_PLAN_GROUNDED_BUDGET_RULES/);
  assert.match(route, /NO_PUBLIC_PRICE_NOTE/);
  assert.doesNotMatch(route, /const budgetMatch =/);
  assert.doesNotMatch(route, /AI estimate — verify with vendor quotation/);
  assert.doesNotMatch(route, /available \* 0\./);
  const researchAt = route.indexOf('await researchEventPricing');
  const generateAt = route.lastIndexOf('await generateContent');
  assert.ok(researchAt > 0 && generateAt > researchAt);
});

test('Event Plan prompts require cited public prices and omit invented Rupiah', async () => {
  const route = await readFile(resolve(root, 'src/app/api/event-plan/generate/route.ts'), 'utf8');
  const systemPrompt = getSystemPrompt('event-plan');
  const smartPrompt = getSmartSystemPrompt('event-plan');

  for (const source of [route, systemPrompt, smartPrompt, EVENT_PLAN_GROUNDED_BUDGET_RULES]) {
    assert.match(source, /suggestedVendor/);
    assert.match(source, /venue\/location/i);
  }
  assert.match(systemPrompt, new RegExp(NO_PUBLIC_PRICE_NOTE));
  assert.match(smartPrompt, new RegExp(NO_PUBLIC_PRICE_NOTE));
  assert.match(EVENT_PLAN_GROUNDED_BUDGET_RULES, new RegExp(NO_PUBLIC_PRICE_NOTE));
  assert.equal(systemPrompt.includes(EVENT_PLAN_GROUNDED_BUDGET_RULES), true);
  assert.match(route, /Never invent a vendor rate, phone number/i);
  assert.match(EVENT_PLAN_GROUNDED_BUDGET_RULES, /Do not invent phone numbers/i);
  assert.match(EVENT_PLAN_GROUNDED_BUDGET_RULES, /quotation amounts/);
  assert.doesNotMatch(systemPrompt, /AI estimate — verify with vendor quotation/);
});

test('fallback budget names a vendor and venue without inventing Rupiah', () => {
  const jakarta = buildPreliminaryBudget(100_000_000, '');
  assert.equal(resolveEventLocation(''), 'Jakarta');
  assert.match(formatVenueLine(''), /Jakarta/);
  assert.equal(jakarta.grounded, true);
  assert.equal(jakarta.publicPricesFound, false);
  assert.equal(jakarta.total, null);
  const items = jakarta.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 5);
  for (const item of items) assertQuotePath(item, 'Jakarta');
  assert.match(String(items[0].suggestedVendor), /Kempinski|Shangri-La|JCC|Convention/i);
  assert.match(String(items[1].suggestedVendor), /Dyandra|Sound of Music/i);
  assert.match(String(items[2].suggestedVendor), /Plataran|in-house/i);
  assert.match(String(items[3].suggestedVendor), /Blue Bird|Financial seminar speaker/i);
  assert.doesNotMatch(JSON.stringify(jakarta), /30\.000\.000|20\.000\.000|12\.000\.000|40000000/);

  const surabaya = buildPreliminaryBudget(50_000_000, 'Surabaya');
  const surabayaItems = surabaya.items as Array<Record<string, unknown>>;
  for (const item of surabayaItems) assertQuotePath(item, 'Surabaya');
  assert.match(String(surabayaItems[0].venue), /JW Marriott Surabaya|Shangri-La Surabaya/);
  assert.equal(formatVenueLine('Ancol Beach City'), 'Ancol Beach City');
});

test('normalizeGeneratedBudget drops invented prices and keeps a sourced price with its URL', () => {
  const invented = normalizeGeneratedBudget({
    currency: 'IDR',
    total: 'Rp 1.000.000',
    items: [{ category: 'Venue', estimatedCost: 900000, notes: 'ballroom split 40 juta' }],
  }, 1_000_000, 'Bandung');
  const inventedVenue = (invented.items as Array<Record<string, unknown>>)[0];
  assertQuotePath(inventedVenue, 'Bandung');
  assert.match(String(inventedVenue.suggestedVendor), /Hilton Bandung|Trans Convention/i);
  assert.doesNotMatch(JSON.stringify(invented), /900000|900\.000|40\.000\.000|40000000/);

  const hit: EventPricingHit = {
    url: 'https://hilton.example/bandung',
    title: 'Hilton Bandung ballroom',
    snippet: 'Sewa ballroom Hilton Bandung Rp 25.000.000 per hari.',
    query: 'sewa ballroom Bandung harga',
    category: 'venue',
    amounts: [25_000_000],
    phones: [],
    emails: [],
  };
  const sourced = normalizeGeneratedBudget({
    total: 1000,
    items: [{ category: 'Venue', estimatedCost: 900000, suggestedVendor: 'Hilton Bandung', venue: 'Hilton Bandung, Bandung', notes: 'invented' }],
  }, 1_000_000, 'Bandung', [hit]);
  const venue = (sourced.items as Array<Record<string, unknown>>)[0];
  assert.equal(venue.estimatedCost, 25_000_000);
  assert.equal(venue.sourceUrl, 'https://hilton.example/bandung');
  assert.match(String(venue.notes), /https:\/\/hilton\.example\/bandung/);
  assert.match(String(venue.notes), /not a verified quotation/);
  assert.doesNotMatch(String(venue.notes), new RegExp(NO_PUBLIC_PRICE_NOTE));
  assert.equal(sourced.total, 25_000_000);
  const speaker = (sourced.items as Array<Record<string, unknown>>).find((item) => String(item.category).includes('Speaker'));
  assert.ok(speaker);
  assert.equal(speaker.estimatedCost, null);
  assert.match(String(speaker.notes), new RegExp(NO_PUBLIC_PRICE_NOTE));

  const empty = normalizeGeneratedBudget({}, undefined, 'Medan');
  assert.equal(empty.grounded, true);
  assertQuotePath((empty.items as Array<Record<string, unknown>>)[0], 'Medan');
});

test('plan venue names the submitted place and the quotation path', () => {
  assert.equal(resolvePlanVenue('Custom Hall, Surabaya', 'Jakarta'), 'Custom Hall, Surabaya');
  assert.match(resolvePlanVenue('', ''), /Jakarta/);
  assert.match(resolvePlanVenue(undefined, 'Medan'), /Medan/);
  assert.equal(resolvePlanVenue('', 'Ancol Beach City'), 'Ancol Beach City');
  const notes = quoteRequestPath('Hilton Bandung', formatVenueLine('Bandung'));
  assert.match(notes, /Hilton Bandung/);
  assert.match(notes, /How to request a quotation/);
  assert.match(notes, /official site/);
});
