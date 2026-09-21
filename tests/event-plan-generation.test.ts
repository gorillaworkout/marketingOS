import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getSmartSystemPrompt, getSystemPrompt } from '../src/lib/openai';
import {
  AI_ESTIMATE_DISCLAIMER,
  EVENT_PLAN_ACTIONABLE_ESTIMATE_RULES,
  buildPreliminaryBudget,
  ensureActionableEstimateNotes,
  formatVenueLine,
  normalizeGeneratedBudget,
  resolveEventLocation,
  resolvePlanVenue,
} from '../src/lib/event-plan-budget';

const root = process.cwd();

function assertActionableEstimate(item: { category?: unknown; notes?: unknown; suggestedVendor?: unknown; venue?: unknown }, city: string) {
  assert.equal(typeof item.suggestedVendor, 'string');
  assert.ok(String(item.suggestedVendor).length > 3, 'suggested vendor must be a concrete name, not blank');
  assert.doesNotMatch(String(item.suggestedVendor), /^vendor$/i);
  assert.match(String(item.notes), new RegExp(AI_ESTIMATE_DISCLAIMER));
  assert.match(String(item.notes), /Suggested vendor/i);
  assert.match(String(item.notes), /Venue\/location/i);
  assert.match(String(item.venue), new RegExp(city, 'i'));
  assert.doesNotMatch(String(item.notes), /\+62\s*\d/);
  assert.doesNotMatch(String(item.notes), /@[a-z0-9.-]+\.[a-z]{2,}/i);
}

test('Event Plan client consumes its SSE generator and exposes structured IDR/date inputs', async () => {
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
  assert.doesNotMatch(page, /\{result\.venue &&/);
});

test('Event Plan generator requires a Rupiah budget breakdown contract', async () => {
  const route = await readFile(resolve(root, 'src/app/api/event-plan/generate/route.ts'), 'utf8');
  assert.match(route, /"currency": "IDR"/);
  assert.match(route, /"items": \[/);
  assert.match(route, /"estimatedCost"/);
  assert.match(route, /Budget ceiling/);
  assert.match(route, /extractBalancedJsonObject/);
  assert.match(route, /normalizeGeneratedBudget/);
  assert.match(route, /buildPreliminaryBudget|EVENT_PLAN_ACTIONABLE_ESTIMATE_RULES/);
  assert.doesNotMatch(route, /const budgetMatch =/);
});

test('Event Plan prompts require named vendors and venue/location on every AI estimate', async () => {
  const route = await readFile(resolve(root, 'src/app/api/event-plan/generate/route.ts'), 'utf8');
  const systemPrompt = getSystemPrompt('event-plan');
  const smartPrompt = getSmartSystemPrompt('event-plan');

  for (const source of [route, systemPrompt, smartPrompt, EVENT_PLAN_ACTIONABLE_ESTIMATE_RULES]) {
    assert.match(source, /suggestedVendor/);
    assert.match(source, /AI estimate — verify with vendor quotation/);
    assert.match(source, /venue\/location/i);
  }
  assert.match(route, /EVENT_PLAN_ACTIONABLE_ESTIMATE_RULES/);
  assert.match(route, /resolvePlanVenue\(planData\.venue, eventLocation\)/);
  assert.match(route, /suggested vendor and venue\/location/);
  assert.match(route, /Never invent a vendor rate, phone number/i);
  assert.equal(systemPrompt.includes(EVENT_PLAN_ACTIONABLE_ESTIMATE_RULES), true);
  assert.match(EVENT_PLAN_ACTIONABLE_ESTIMATE_RULES, /Do not invent phone numbers/i);
  assert.match(EVENT_PLAN_ACTIONABLE_ESTIMATE_RULES, /fake quotation amounts/);
});

test('fallback budget names a vendor and venue for each AI estimate line', () => {
  const jakarta = buildPreliminaryBudget(100_000_000, '');
  assert.equal(resolveEventLocation(''), 'Jakarta');
  assert.match(formatVenueLine(''), /Jakarta/);
  assert.equal(jakarta.preliminary, true);
  assert.equal(jakarta.total, 100_000_000);
  const items = jakarta.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 5);
  for (const item of items) assertActionableEstimate(item, 'Jakarta');
  assert.match(String(items[0].suggestedVendor), /Kempinski|Shangri-La|JCC|Convention/i);
  assert.match(String(items[1].suggestedVendor), /Dyandra|Sound of Music/i);
  assert.match(String(items[2].suggestedVendor), /Plataran|in-house/i);
  assert.match(String(items[3].suggestedVendor), /Blue Bird|Silver Bird/i);

  const surabaya = buildPreliminaryBudget(50_000_000, 'Surabaya');
  const surabayaItems = surabaya.items as Array<Record<string, unknown>>;
  for (const item of surabayaItems) assertActionableEstimate(item, 'Surabaya');
  assert.match(String(surabayaItems[0].venue), /JW Marriott Surabaya|Shangri-La Surabaya/);
});

test('normalizeGeneratedBudget enriches anonymous AI estimates with vendor + venue', () => {
  const normalized = normalizeGeneratedBudget({
    currency: 'IDR',
    total: 'Rp 1.000.000',
    items: [{ category: 'Venue', estimatedCost: 900000, notes: 'ballroom split' }],
  }, 1_000_000, 'Bandung');
  const item = (normalized.items as Array<Record<string, unknown>>)[0];
  assertActionableEstimate(item, 'Bandung');
  assert.match(String(item.notes), /ballroom split/);
  assert.match(String(item.suggestedVendor), /Hilton Bandung|Trans Convention/i);

  const alreadyGood = normalizeGeneratedBudget({
    total: 1000,
    items: [{
      category: 'Venue',
      estimatedCost: 900,
      suggestedVendor: 'Hilton Bandung',
      venue: 'Hilton Bandung, Bandung',
      notes: `${AI_ESTIMATE_DISCLAIMER}. Suggested vendor (AI proposal — not a verified contact; verify quotation): Hilton Bandung. Venue/location: Hilton Bandung, Bandung.`,
    }],
  }, 1000, 'Bandung');
  const goodNotes = String((alreadyGood.items as Array<Record<string, unknown>>)[0].notes);
  assert.equal(goodNotes.match(new RegExp(AI_ESTIMATE_DISCLAIMER, 'g'))?.length, 1);

  assert.deepEqual(normalizeGeneratedBudget({}, undefined), {});
  const fallback = normalizeGeneratedBudget({}, 2_000_000, 'Medan');
  assert.equal(fallback.preliminary, true);
  assertActionableEstimate((fallback.items as Array<Record<string, unknown>>)[0], 'Medan');
});

test('plan venue always resolves to city + venue shortlist when the model omits it', () => {
  assert.equal(resolvePlanVenue('Custom Hall, Surabaya', 'Jakarta'), 'Custom Hall, Surabaya');
  assert.match(resolvePlanVenue('', ''), /Jakarta/);
  assert.match(resolvePlanVenue(undefined, 'Medan'), /Medan/);
  const notes = ensureActionableEstimateNotes('rough split', 'Hilton Bandung', formatVenueLine('Bandung'), 'Venue');
  assert.match(notes, new RegExp(AI_ESTIMATE_DISCLAIMER));
  assert.match(notes, /Hilton Bandung/);
  assert.match(notes, /Venue\/location/);
});
