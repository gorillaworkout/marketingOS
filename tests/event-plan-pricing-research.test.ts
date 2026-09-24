import test from 'node:test';
import assert from 'node:assert/strict';
import { groundEventPlanBudget } from '../src/lib/event-plan-budget';
import {
  buildEventPricingQueries,
  extractPublicContacts,
  extractPublicRupiahAmounts,
  NO_PUBLIC_PRICE_NOTE,
  redactUnsourcedPrices,
  type EventPricingHit,
} from '../src/lib/event-plan-pricing';
import { researchEventPricing, toEventPlanResearch } from '../src/lib/event-plan-pricing-research';

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

test('rupiah extraction keeps explicit public prices and ignores years, capacity, and phones', () => {
  assert.deepEqual(extractPublicRupiahAmounts('Sewa ballroom Rp 40.000.000 per hari'), [40_000_000]);
  assert.deepEqual(extractPublicRupiahAmounts('Fee narasumber mulai dari 15 juta'), [15_000_000]);
  assert.deepEqual(extractPublicRupiahAmounts('Paket Rp40jt termasuk panggung'), [40_000_000]);
  assert.deepEqual(extractPublicRupiahAmounts('IDR 25,000,000'), [25_000_000]);
  assert.deepEqual(extractPublicRupiahAmounts('Kapasitas 500 orang pada tahun 2026. Hubungi 021-55550101.'), []);
  assert.deepEqual(extractPublicContacts('Email events@ancol.example atau +62 21 5555 0101.'), {
    emails: ['events@ancol.example'],
    phones: ['+62 21 5555 0101'],
  });
});

test('narrative text keeps a sourced price and redacts an invented one', () => {
  const sourced = redactUnsourcedPrices('Sewa venue Rp 40.000.000 menurut halaman publik.', [40_000_000]);
  assert.match(sourced, /Rp 40\.000\.000/);
  const invented = redactUnsourcedPrices('Asumsikan sewa Ancol 40 juta dan catering Rp 12.000.000.', [40_000_000]);
  assert.match(invented, /40 juta/);
  assert.match(invented, new RegExp(NO_PUBLIC_PRICE_NOTE));
  assert.doesNotMatch(invented, /12\.000\.000/);
});

test('pricing queries follow the submitted venue and ask for speaker fee ranges', () => {
  const ancol = buildEventPricingQueries({ location: 'Ancol Beach City', eventName: 'Seminar Keuangan', theme: 'Financial seminar' });
  assert.ok(ancol.some((query) => query === 'Ancol Beach City sewa venue'));
  assert.ok(ancol.some((query) => /speaker fee financial seminar/i.test(query)));
  const jakarta = buildEventPricingQueries({ location: 'Jakarta', eventName: 'Market Outlook', theme: 'seminar' });
  assert.ok(jakarta.some((query) => /ballroom rental Jakarta|sewa ballroom Jakarta/i.test(query)));
});

test('grounded budget omits invented Rupiah when research hits have no numbers', () => {
  const hits: EventPricingHit[] = [{
    url: 'https://ancol.example/sewa',
    title: 'Ancol Beach City',
    snippet: 'Ancol Beach City tersedia untuk event perusahaan. Hubungi sales untuk penawaran.',
    query: 'Ancol Beach City sewa venue',
    category: 'venue',
    amounts: [],
    phones: [],
    emails: [],
  }];
  const budget = groundEventPlanBudget({
    location: 'Ancol Beach City',
    hits,
    budgetCeiling: 100_000_000,
    modelBudget: {
      currency: 'IDR',
      total: 100_000_000,
      items: [{ category: 'Venue', estimatedCost: 40_000_000, notes: 'AI estimate 40 juta' }],
    },
  });
  const serialized = JSON.stringify(budget);
  assert.equal(budget.publicPricesFound, false);
  assert.equal(budget.total, null);
  for (const item of budget.items as Array<Record<string, unknown>>) {
    assert.equal(item.estimatedCost, null);
    assert.match(String(item.notes), new RegExp(NO_PUBLIC_PRICE_NOTE));
    assert.match(String(item.notes), /How to request a quotation/);
  }
  assert.match(String((budget.items as Array<Record<string, unknown>>)[0].venue), /Ancol Beach City/);
  assert.match(String((budget.items as Array<Record<string, unknown>>)[0].suggestedVendor), /Ancol Beach City/);
  assert.doesNotMatch(serialized, /40000000|40\.000\.000|40 juta|100000000/);
  assert.doesNotMatch(serialized, /\+62\s*\d/);
  assert.doesNotMatch(serialized, /@[a-z0-9.-]+\.[a-z]{2,}/i);
});

test('a single public price is copied onto the matching budget line with its citation', () => {
  const hits: EventPricingHit[] = [
    {
      url: 'https://ancol.example/sewa',
      title: 'Ancol Beach City sewa venue',
      snippet: 'Sewa ballroom Ancol Beach City Rp 40.000.000 per hari.',
      query: 'Ancol Beach City sewa venue',
      category: 'venue',
      amounts: [40_000_000],
      phones: [],
      emails: ['events@ancol.example'],
    },
    {
      url: 'https://speakers.example/fee',
      title: 'Fee narasumber seminar keuangan',
      snippet: 'Fee narasumber seminar keuangan Rp 15.000.000 per sesi.',
      query: 'speaker fee financial seminar Indonesia',
      category: 'speaker',
      amounts: [15_000_000],
      phones: [],
      emails: [],
    },
  ];
  const budget = groundEventPlanBudget({
    location: 'Ancol Beach City',
    hits,
    modelBudget: { items: [{ category: 'Venue', estimatedCost: 99_000_000 }] },
  });
  const items = budget.items as Array<Record<string, unknown>>;
  const venue = items[0];
  const speaker = items.find((item) => String(item.category).includes('Speaker'));
  const catering = items.find((item) => String(item.category).includes('Catering'));
  assert.equal(venue.estimatedCost, 40_000_000);
  assert.equal(venue.sourceUrl, 'https://ancol.example/sewa');
  assert.match(String(venue.notes), /https:\/\/ancol\.example\/sewa/);
  assert.match(String(venue.notes), /events@ancol\.example/);
  assert.match(String(venue.notes), /not a verified quotation/);
  assert.equal(speaker?.estimatedCost, 15_000_000);
  assert.equal(speaker?.sourceUrl, 'https://speakers.example/fee');
  assert.equal(catering?.estimatedCost, null);
  assert.match(String(catering?.notes), new RegExp(NO_PUBLIC_PRICE_NOTE));
  assert.equal(budget.total, 55_000_000);
  assert.doesNotMatch(JSON.stringify(budget), /99000000|99\.000\.000/);
});

test('researchEventPricing browses public pages and does not keep an invented price', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('127.0.0.1') || url.includes('169.254.169.254')) {
      throw new Error(`SSRF fetch attempted: ${url}`);
    }
    if (url.includes('google.serper.dev/search')) {
      const query = String(init?.body || '');
      if (/speaker|narasumber/i.test(query)) {
        return response(JSON.stringify({
          organic: [{ title: 'Fee narasumber', link: 'https://speakers.example/fee', snippet: 'Hubungi pembicara untuk penawaran.' }],
        }), 200, 'application/json');
      }
      return response(JSON.stringify({
        organic: [{ title: 'Ancol Beach City', link: 'https://ancol.example/sewa', snippet: 'Informasi venue tanpa harga.' }],
      }), 200, 'application/json');
    }
    if (url === 'https://ancol.example/sewa') {
      return response('<html><title>Sewa Ancol</title><body>Ancol Beach City menerima event perusahaan. Silakan hubungi sales untuk penawaran tertulis dan ketersediaan ballroom.</body></html>');
    }
    if (url === 'https://speakers.example/fee') {
      return response('<html><title>Narasumber</title><body>Pembicara seminar keuangan tersedia. Fee disampaikan setelah brief acara dan tidak dipublikasikan di halaman ini.</body></html>');
    }
    return response('missing', 404, 'text/plain');
  };

  const research = await researchEventPricing({
    eventName: 'Seminar Keuangan',
    theme: 'Financial seminar',
    location: 'Ancol Beach City',
    researchUrls: ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data', 'https://user:pass@ancol.example/secret'],
    fetchImpl,
    serperApiKey: 'test-key',
  });
  assert.ok(calls.some((url) => url.includes('google.serper.dev/search')));
  assert.ok(calls.includes('https://ancol.example/sewa'));
  assert.equal(calls.some((url) => /127\.0\.0\.1|169\.254\.169\.254|user:pass/.test(url)), false);
  const budget = groundEventPlanBudget({
    location: 'Ancol Beach City',
    hits: research.hits,
    modelBudget: { total: 40_000_000, items: [{ category: 'Venue', estimatedCost: 40_000_000 }] },
  });
  assert.equal((budget.items as Array<{ estimatedCost: unknown }>)[0].estimatedCost, null);
  assert.match(JSON.stringify(budget), new RegExp(NO_PUBLIC_PRICE_NOTE));
  assert.doesNotMatch(JSON.stringify(budget), /40000000|40\.000\.000/);
  const report = toEventPlanResearch(research);
  assert.equal(report.status, 'researched');
  assert.ok(report.sources.some((source) => source.url === 'https://ancol.example/sewa' && source.snippet));
  assert.equal(report.contacts.length, 0);
});

test('researchEventPricing cites a page price and a Jina fallback without calling private hosts', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('google.serper.dev/search')) {
      const query = String(init?.body || '');
      if (/speaker|narasumber/i.test(query)) {
        return response(JSON.stringify({
          organic: [{ title: 'Speaker fee', link: 'https://speakers.example/fee', snippet: 'Daftar pembicara seminar.' }],
        }), 200, 'application/json');
      }
      return response(JSON.stringify({
        organic: [{ title: 'Ancol Beach City sewa venue', link: 'https://ancol.example/sewa', snippet: 'Halaman venue.' }],
      }), 200, 'application/json');
    }
    if (url === 'https://ancol.example/sewa') return response('blocked', 403, 'text/plain');
    if (url.startsWith('https://r.jina.ai/https://ancol.example/sewa')) {
      return response('Title: Sewa Ancol Beach City\n\nSewa ballroom Ancol Beach City Rp 40.000.000 per hari untuk seminar perusahaan. Hubungi events@ancol.example atau +62 21 5555 0101.', 200, 'text/plain');
    }
    if (url === 'https://redirect.example/price') {
      return response('Sewa ballroom Rp 99.000.000 per hari untuk acara internal yang sangat panjang supaya halaman terlihat seperti konten.', 200, 'text/html', 'http://127.0.0.1/secret');
    }
    if (url === 'https://speakers.example/fee') {
      return response('<html><title>Fee</title><body>Fee narasumber seminar keuangan Rp 15.000.000 per sesi untuk seminar finansial.</body></html>');
    }
    return response('missing', 404, 'text/plain');
  };

  const research = await researchEventPricing({
    eventName: 'Seminar Keuangan',
    location: 'Ancol Beach City',
    researchUrls: ['https://redirect.example/price'],
    fetchImpl,
    serperApiKey: 'test-key',
  });
  assert.ok(calls.some((url) => url.startsWith('https://r.jina.ai/https://ancol.example/sewa')));
  assert.equal(calls.some((url) => url.includes('127.0.0.1')), false);
  assert.equal(calls.filter((url) => url.includes('google.serper.dev/search')).length, 4);
  const venueHit = research.hits.find((hit) => hit.url === 'https://ancol.example/sewa' && hit.amounts.includes(40_000_000));
  assert.ok(venueHit);
  assert.equal(venueHit?.category, 'venue');
  assert.deepEqual(venueHit?.emails, ['events@ancol.example']);
  const budget = groundEventPlanBudget({ location: 'Ancol Beach City', hits: research.hits });
  const venue = (budget.items as Array<Record<string, unknown>>)[0];
  assert.equal(venue.estimatedCost, 40_000_000);
  assert.equal(venue.sourceUrl, 'https://ancol.example/sewa');
  assert.match(String(venue.notes), /events@ancol\.example/);
  assert.match(String(venue.notes), /\+62 21 5555 0101/);
  assert.doesNotMatch(JSON.stringify(budget), /99000000|99\.000\.000/);
  const report = toEventPlanResearch(research, ['https://redirect.example/price']);
  assert.equal(report.contacts[0]?.verified, false);
  assert.equal(report.contacts[0]?.sourceUrl, 'https://ancol.example/sewa');
  assert.ok(report.sources.every((source) => !source.claim.toLowerCase().replace(/not a verified quotation/g, '').includes('verified quotation')));
});
