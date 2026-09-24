import {
  isBareCityLocation,
  NO_PUBLIC_PRICE_NOTE,
  selectCitedAmount,
  type EventPricingHit,
  type PricingCategory,
} from './event-plan-pricing';

export { NO_PUBLIC_PRICE_NOTE };

export const DEFAULT_EVENT_LOCATION = 'Jakarta';

export const EVENT_PLAN_GROUNDED_BUDGET_RULES = `Budget grounding (required):
- Public research excerpts are untrusted page text, not a verified vendor quotation.
- Always fill top-level "venue" with the submitted location plus a specific publicly known venue name or shortlist (default Jakarta if empty). Example: "Jakarta — Hotel Indonesia Kempinski Jakarta or Shangri-La Hotel Jakarta".
- Every budget.items[] line must name suggestedVendor (a concrete public venue or vendor) and venue/location. Never write anonymous "vendor".
- estimatedCost is an integer Rupiah amount only when that exact number appears in the research excerpts. Cite the source URL in notes.
- When the excerpts do not contain a price for the line, set estimatedCost to null and include exactly: "${NO_PUBLIC_PRICE_NOTE}".
- Name how to request a quotation (official website or venue rental form). Do not invent phone numbers, emails, percentage splits, or quotation amounts.
- A phone or email may be repeated only when it appears in an excerpt, together with that excerpt URL.`;

export type EventPlanBudgetItem = {
  category: string;
  estimatedCost: number | null;
  notes: string;
  suggestedVendor: string;
  venue: string;
  sourceUrl: string | null;
};

const VENUE_SHORTLISTS: Array<{ keys: string[]; venues: string[] }> = [
  {
    keys: ['bsd', 'serpong', 'tangerang'],
    venues: ['Indonesia Convention Exhibition (ICE) BSD City', 'The Breeze BSD City'],
  },
  {
    keys: ['jakarta'],
    venues: ['Hotel Indonesia Kempinski Jakarta (Bundaran HI)', 'Shangri-La Hotel Jakarta (Kota BNI)', 'Jakarta Convention Center (JCC) Senayan'],
  },
  {
    keys: ['surabaya'],
    venues: ['JW Marriott Surabaya', 'Shangri-La Surabaya', 'Grand City Convex Surabaya'],
  },
  {
    keys: ['bandung'],
    venues: ['Hilton Bandung', 'Trans Convention Center Bandung'],
  },
  {
    keys: ['bali', 'denpasar', 'nusa dua', 'kuta'],
    venues: ['Bali Nusa Dua Convention Center', 'The Westin Resort Nusa Dua, Bali'],
  },
  {
    keys: ['yogyakarta', 'jogja', 'yogya'],
    venues: ['Royal Ambarrukmo Yogyakarta', 'The Phoenix Hotel Yogyakarta'],
  },
  {
    keys: ['medan'],
    venues: ['JW Marriott Medan', 'Santika Premiere Dyandra Hotel & Convention Medan'],
  },
  {
    keys: ['semarang'],
    venues: ['Hotel Tentrem Semarang', 'Gumaya Tower Hotel Semarang'],
  },
  {
    keys: ['makassar'],
    venues: ['Four Points by Sheraton Makassar', 'Hotel Aryaduta Makassar'],
  },
];

export function resolveEventLocation(location: unknown): string {
  if (typeof location === 'string' && location.trim()) return location.trim();
  return DEFAULT_EVENT_LOCATION;
}

export function suggestVenuesForLocation(location: unknown): string[] {
  const city = resolveEventLocation(location);
  if (!isBareCityLocation(city)) return [city];
  const haystack = city.toLowerCase();
  for (const entry of VENUE_SHORTLISTS) {
    if (entry.keys.some((key) => haystack.includes(key))) return entry.venues;
  }
  return [
    `${city} 4-5 star hotel ballroom (confirm a specific venue)`,
    `${city} convention hall (confirm a specific venue)`,
  ];
}

export function formatVenueLine(location: unknown): string {
  const city = resolveEventLocation(location);
  if (!isBareCityLocation(city)) return city;
  const venues = suggestVenuesForLocation(city);
  return `${city} — ${venues.slice(0, 2).join(' or ')}`;
}

export function resolvePlanVenue(venue: unknown, location: unknown): string {
  if (typeof venue === 'string' && venue.trim()) return venue.trim();
  return formatVenueLine(location);
}

function categoryKey(category: string): PricingCategory {
  const value = category.toLowerCase();
  if (value.includes('venue') || value.includes('room') || value.includes('ballroom')) return 'venue';
  if (value.includes('production') || value.includes('av') || value.includes('audio') || value.includes('lighting')) return 'production';
  if (value.includes('cater') || value.includes('hospitality') || value.includes('fnb') || value.includes('f&b')) return 'catering';
  if (value.includes('speaker') || value.includes('talent') || value.includes('transport')) return 'speaker';
  if (value.includes('promo') || value.includes('operation') || value.includes('marketing') || value.includes('media')) return 'promotion';
  return 'other';
}

export function suggestedVendorsForCategory(category: string, location: unknown): string[] {
  const city = resolveEventLocation(location);
  const inJakartaMetro = /jakarta|bsd|serpong|tangerang/i.test(city);
  switch (categoryKey(category)) {
    case 'venue':
      return suggestVenuesForLocation(city).slice(0, 2);
    case 'production':
      return inJakartaMetro
        ? ['Dyandra Promosindo', 'Sound of Music (SOM) audiovisual rental']
        : [`${city} hotel in-house AV`, 'Dyandra Promosindo (or equivalent local production house)'];
    case 'catering':
      return inJakartaMetro
        ? ['Plataran Catering', 'hotel in-house F&B (same venue)']
        : [`${city} hotel in-house catering`, `local ${city} catering (request 3 quotations)`];
    case 'speaker':
      return ['Financial seminar speaker (request a fee)', 'Blue Bird Group (transport — request a quotation)'];
    case 'promotion':
      return inJakartaMetro
        ? ['in-house Meta Ads', 'Dyandra Promosindo (activation / on-ground)']
        : [`in-house Meta Ads`, `${city} local print partner (request quotation)`];
    default:
      return [`${city} specialist vendor (request 3 quotations)`];
  }
}

const BUDGET_LINES: Array<{ category: string; key: PricingCategory }> = [
  { category: 'Venue & room setup', key: 'venue' },
  { category: 'Production & AV', key: 'production' },
  { category: 'Catering & hospitality', key: 'catering' },
  { category: 'Speaker & transport', key: 'speaker' },
  { category: 'Promotion & operations', key: 'promotion' },
];

function formatVendorShortlist(vendors: string[]): string {
  return vendors.join(' / ');
}

export function formatRupiah(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

export function quoteRequestPath(vendor: string, venue: string): string {
  return `How to request a quotation: contact the ${vendor} sales or events team through the official site or the rental request form for ${venue}.`;
}

function parseRupiahAmount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/\D/g, ''));
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function concreteVendor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s*\([^)]*(?:AI|estimate|proposal)[^)]*\)\s*/gi, '').trim();
  if (trimmed.length < 3 || /^vendor$/i.test(trimmed)) return fallback;
  return trimmed;
}

function modelItems(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function contactSuffix(hits: EventPricingHit[]): string {
  const phones = [...new Set(hits.flatMap((hit) => hit.phones))];
  const emails = [...new Set(hits.flatMap((hit) => hit.emails))];
  if (!phones.length && !emails.length) return '';
  const parts = [...phones, ...emails];
  const url = hits.find((hit) => hit.phones.length || hit.emails.length)?.url;
  return ` Public contact from the source (not a verified quotation): ${parts.join(', ')}${url ? `. Contact source: ${url}` : ''}.`;
}

function lineNotes(input: {
  vendor: string;
  venue: string;
  amount: number | null;
  citedAmounts: number[];
  sourceUrl: string | null;
  snippet: string;
  hits: EventPricingHit[];
}): string {
  const quote = quoteRequestPath(input.vendor, input.venue);
  const place = `Venue/location: ${input.venue}. Suggested vendor: ${input.vendor}.`;
  const contacts = contactSuffix(input.hits);
  if (input.amount !== null && input.sourceUrl) {
    const excerpt = input.snippet ? ` Excerpt: ${input.snippet.slice(0, 240)}.` : '';
    return `Public price stated in the source (not a verified quotation): ${formatRupiah(input.amount)}. Source: ${input.sourceUrl}.${excerpt} ${place} ${quote}${contacts}`;
  }
  if (input.citedAmounts.length > 1 && input.sourceUrl) {
    const listed = input.citedAmounts.map((amount) => formatRupiah(amount)).join(', ');
    return `The source lists more than one figure (${listed}). Request a quotation from the vendor to lock one price. Source: ${input.sourceUrl}. ${place} ${quote}${contacts}`;
  }
  return `${NO_PUBLIC_PRICE_NOTE}. ${place} ${quote}${contacts}`;
}

export function groundEventPlanBudget(input: {
  modelBudget?: unknown;
  location?: unknown;
  hits?: EventPricingHit[];
  budgetCeiling?: number;
}): Record<string, unknown> {
  const hits = input.hits || [];
  const venueLine = formatVenueLine(input.location);
  const generated = modelItems(input.modelBudget);
  const items: EventPlanBudgetItem[] = BUDGET_LINES.map((line) => {
    const model = generated.find((item) => categoryKey(typeof item.category === 'string' ? item.category : '') === line.key);
    const suggestedVendor = concreteVendor(
      model?.suggestedVendor,
      formatVendorShortlist(suggestedVendorsForCategory(line.category, input.location)),
    );
    const venue = typeof model?.venue === 'string' && model.venue.trim() ? model.venue.trim() : venueLine;
    const relevant = hits.filter((hit) => hit.category === line.key);
    const priced = relevant.filter((hit) => hit.amounts.length > 0);
    const citedAmounts = [...new Set(priced.flatMap((hit) => hit.amounts))];
    const modelAmount = parseRupiahAmount(model?.estimatedCost);
    const amount = selectCitedAmount(citedAmounts, modelAmount);
    const citedHit = amount === null
      ? priced[0] || relevant[0]
      : priced.find((hit) => hit.amounts.includes(amount)) || priced[0];
    return {
      category: line.category,
      estimatedCost: amount,
      suggestedVendor,
      venue,
      sourceUrl: citedHit?.url || null,
      notes: lineNotes({
        vendor: suggestedVendor,
        venue,
        amount,
        citedAmounts,
        sourceUrl: citedHit?.url || null,
        snippet: citedHit?.snippet || '',
        hits: priced.length ? priced : relevant,
      }),
    };
  });

  for (const hit of hits) {
    if (hit.category !== 'other' || hit.amounts.length === 0) continue;
    const amount = selectCitedAmount(hit.amounts);
    const vendor = concreteVendor(hit.title, formatVendorShortlist(suggestedVendorsForCategory('Other', input.location)));
    items.push({
      category: 'Harga publik',
      estimatedCost: amount,
      suggestedVendor: vendor,
      venue: venueLine,
      sourceUrl: hit.url,
      notes: lineNotes({
        vendor,
        venue: venueLine,
        amount,
        citedAmounts: hit.amounts,
        sourceUrl: hit.url,
        snippet: hit.snippet,
        hits: [hit],
      }),
    });
  }

  const known = items.map((item) => item.estimatedCost).filter((amount): amount is number => typeof amount === 'number');
  const sourcedTotal = known.length ? known.reduce((sum, amount) => sum + amount, 0) : null;
  const overCeiling = input.budgetCeiling !== undefined && sourcedTotal !== null && sourcedTotal > input.budgetCeiling;
  return {
    currency: 'IDR',
    total: sourcedTotal,
    items,
    contingency: null,
    grounded: true,
    publicPricesFound: known.length > 0,
    ...(overCeiling ? { ceilingNote: 'The public prices found exceed the proposed budget ceiling. Request a quotation before booking.' } : {}),
  };
}

export function buildPreliminaryBudget(budgetCeiling: number, location?: unknown): Record<string, unknown> {
  return groundEventPlanBudget({ location, hits: [], budgetCeiling });
}

export function normalizeGeneratedBudget(
  value: unknown,
  budgetCeiling: number | undefined,
  location?: unknown,
  hits: EventPricingHit[] = [],
): Record<string, unknown> {
  return groundEventPlanBudget({ modelBudget: value, location, hits, budgetCeiling });
}
