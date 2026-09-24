import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EVENT_PLAN_PROGRESS, assertEnglishEventPlanProgress } from '../src/lib/event-plan-progress';
import {
  buildEventPricingFollowUpQueries,
  buildEventPricingQueries,
  eventPricingPackIsThin,
  type EventPricingHit,
} from '../src/lib/event-plan-pricing';
import { researchEventPricing, type EventPricingProgress } from '../src/lib/event-plan-pricing-research';

const root = process.cwd();

function hit(partial: Partial<EventPricingHit>): EventPricingHit {
  return {
    url: 'https://hotel.example/price',
    title: 'Hotel',
    snippet: 'Venue page',
    query: 'sewa venue',
    category: 'venue',
    amounts: [],
    phones: [],
    emails: [],
    ...partial,
  };
}

function response(body: string, status = 200, contentType = 'text/html', finalUrl = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    headers: new Headers({ 'content-type': contentType }),
    body: null,
    text: async () => body,
  } as Response;
}

test('Event Plan operator progress stays in English', async () => {
  const messages = [
    EVENT_PLAN_PROGRESS.searching(1),
    EVENT_PLAN_PROGRESS.searching(2),
    EVENT_PLAN_PROGRESS.reading(1),
    EVENT_PLAN_PROGRESS.reading(2),
    EVENT_PLAN_PROGRESS.drafting,
    EVENT_PLAN_PROGRESS.draftingStyle('Professional'),
    EVENT_PLAN_PROGRESS.partialFailure('Bold & Grand', 2),
    EVENT_PLAN_PROGRESS.drafted(3),
    EVENT_PLAN_PROGRESS.complete,
  ];
  for (const message of messages) assert.equal(assertEnglishEventPlanProgress(message), true);
  assert.match(EVENT_PLAN_PROGRESS.searching(1), /Searching public venue and vendor prices/);
  assert.match(EVENT_PLAN_PROGRESS.searching(2), /Searching again for venues and vendors/);
  assert.match(EVENT_PLAN_PROGRESS.reading(1), /Reading public price pages/);
  assert.match(EVENT_PLAN_PROGRESS.drafting, /Drafting 3 event plan styles/);

  const route = await readFile(resolve(root, 'src/app/api/event-plan/generate/route.ts'), 'utf8');
  const page = await readFile(resolve(root, 'src/app/dashboard/event-plan/page.tsx'), 'utf8');
  assert.match(route, /EVENT_PLAN_PROGRESS/);
  assert.doesNotMatch(route, /\b(Mencari|Membaca|gagal|menampilkan|berhasil|narasumber)\b/);
  assert.match(page, /Searching/);
  assert.match(page, /Reading/);
  assert.match(page, /Drafting/);
  assert.match(route, /TIMEOUT_MS = 300_000/);
  const research = await readFile(resolve(root, 'src/lib/event-plan-pricing-research.ts'), 'utf8');
  assert.match(research, /DEFAULT_TIMEOUT_MS = 8_000/);
  assert.match(research, /FOLLOW_UP_PAGE_FETCHES = 3/);
  assert.match(research, /MAX_PAGE_FETCHES = 5/);
});

test('a thin price pack gets two new venue and vendor queries and a priced venue pack does not', () => {
  assert.equal(eventPricingPackIsThin([]), true);
  assert.equal(eventPricingPackIsThin([hit({ amounts: [] })]), true);
  assert.equal(eventPricingPackIsThin([hit({ category: 'speaker', amounts: [15_000_000] })]), true);
  assert.equal(eventPricingPackIsThin([hit({ amounts: [40_000_000] })]), false);

  const existing = buildEventPricingQueries({ location: 'Jakarta', eventName: 'Seminar', theme: 'seminar' });
  const followUps = buildEventPricingFollowUpQueries({
    location: 'Jakarta',
    eventName: 'Seminar',
    theme: 'seminar',
    existingQueries: existing,
  });
  assert.equal(followUps.length, 2);
  assert.ok(followUps.every((query) => !existing.includes(query)));
  assert.match(followUps[0] || '', /daftar harga sewa ballroom/);
  assert.match(followUps[1] || '', /vendor event organizer/);
});

test('researchEventPricing searches again only when the first pack has no public venue price', async () => {
  const progress: EventPricingProgress[] = [];
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('google.serper.dev/search')) {
      const query = String(init?.body || '');
      bodies.push(query);
      if (/daftar harga sewa ballroom|vendor event organizer/i.test(query)) {
        return response(JSON.stringify({
          organic: [{ title: 'Hotel Ballroom Price', link: 'https://hotel.example/price', snippet: 'Sewa ballroom Hotel Example Rp 30.000.000 per hari.' }],
        }), 200, 'application/json');
      }
      return response(JSON.stringify({
        organic: [{ title: 'Ancol Beach City', link: 'https://ancol.example/sewa', snippet: 'Informasi venue tanpa harga.' }],
      }), 200, 'application/json');
    }
    if (url === 'https://ancol.example/sewa') {
      return response('<html><title>Sewa Ancol</title><body>Ancol Beach City menerima event perusahaan. Silakan hubungi sales untuk penawaran tertulis dan ketersediaan ballroom.</body></html>');
    }
    if (url === 'https://hotel.example/price') {
      return response('<html><title>Price</title><body>Sewa ballroom Hotel Example Rp 30.000.000 per hari untuk seminar.</body></html>');
    }
    return response('missing', 404, 'text/plain');
  };

  const research = await researchEventPricing({
    eventName: 'Seminar Keuangan',
    theme: 'Financial seminar',
    location: 'Ancol Beach City',
    fetchImpl,
    serperApiKey: 'test-key',
    onProgress: (event) => { progress.push(event); },
  });

  assert.equal(research.rounds, 2);
  assert.ok(research.hits.some((item) => item.amounts.includes(30_000_000) && item.url === 'https://hotel.example/price'));
  assert.ok(progress.some((event) => event.round === 1 && event.phase === 'searching' && /Searching public venue and vendor prices/.test(event.message)));
  assert.ok(progress.some((event) => event.round === 1 && event.phase === 'reading' && /Reading public price pages/.test(event.message)));
  assert.ok(progress.some((event) => event.round === 2 && event.phase === 'searching' && /Searching again/.test(event.message)));
  assert.ok(progress.some((event) => event.round === 2 && event.phase === 'reading' && /Reading additional public price pages/.test(event.message)));
  assert.ok(progress.every((event) => assertEnglishEventPlanProgress(event.message)));
  assert.ok(bodies.some((body) => /daftar harga sewa ballroom/.test(body)));

  const pricedBodies: string[] = [];
  const pricedFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('google.serper.dev/search')) {
      pricedBodies.push(String(init?.body || ''));
      return response(JSON.stringify({
        organic: [{ title: 'Ancol Beach City sewa venue', link: 'https://ancol.example/sewa', snippet: 'Sewa ballroom Rp 40.000.000 per hari.' }],
      }), 200, 'application/json');
    }
    if (url === 'https://ancol.example/sewa') {
      return response('<html><title>Sewa</title><body>Sewa ballroom Ancol Beach City Rp 40.000.000 per hari untuk seminar perusahaan.</body></html>');
    }
    return response('missing', 404, 'text/plain');
  };
  const priced = await researchEventPricing({
    eventName: 'Seminar Keuangan',
    location: 'Ancol Beach City',
    fetchImpl: pricedFetch,
    serperApiKey: 'test-key',
  });
  assert.equal(priced.rounds, 1);
  assert.equal(pricedBodies.some((body) => /daftar harga sewa ballroom|vendor event organizer/.test(body)), false);
  assert.ok(priced.hits.some((item) => item.amounts.includes(40_000_000)));
});
