export const AI_ESTIMATE_DISCLAIMER = 'AI estimate — verify with vendor quotation';
export const DEFAULT_EVENT_LOCATION = 'Jakarta';

export const EVENT_PLAN_ACTIONABLE_ESTIMATE_RULES = `Budget actionability (required):
- Always fill top-level "venue" with the city plus a specific publicly known venue name or shortlist, tied to the submitted Location (default Jakarta if empty). Example: "Jakarta — Hotel Indonesia Kempinski Jakarta or Shangri-La Hotel Jakarta".
- Every budget.items[] line must answer what / who / where — not only cost math or % splits.
- Include suggestedVendor: a concrete public/known vendor name or shortlist. Label it as an AI suggestion the user must verify. Never write anonymous "vendor".
- Include venue on each line (same city + venue name or shortlist).
- Every unverified price line's notes must include exactly: "${AI_ESTIMATE_DISCLAIMER}" PLUS suggested vendor name(s), venue/location, and what to verify (written quotation, inclusions, availability).
- Do not invent phone numbers, emails, fake quotation amounts, or fake "verified" contacts.
- Only use price/contact facts explicitly present in source text; otherwise omit them and keep the AI-estimate label.`;

export type EventPlanBudgetItem = {
  category: string;
  estimatedCost: number;
  notes: string;
  suggestedVendor: string;
  venue: string;
};

type CategoryKey = 'venue' | 'production' | 'catering' | 'speaker' | 'promotion' | 'other';

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
  const venues = suggestVenuesForLocation(city);
  return `${city} — ${venues.slice(0, 2).join(' or ')}`;
}

export function resolvePlanVenue(venue: unknown, location: unknown): string {
  if (typeof venue === 'string' && venue.trim()) return venue.trim();
  return formatVenueLine(location);
}

function categoryKey(category: string): CategoryKey {
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
      return ['Blue Bird Group (executive / bus charter)', 'Silver Bird'];
    case 'promotion':
      return inJakartaMetro
        ? ['in-house Meta Ads', 'Dyandra Promosindo (activation / on-ground)']
        : [`in-house Meta Ads`, `${city} local print partner (request quotation)`];
    default:
      return [`${city} specialist vendor (request 3 quotations)`];
  }
}

function verifyHintForCategory(category: string): string {
  switch (categoryKey(category)) {
    case 'venue':
      return 'Confirm ballroom package, capacity, parking, and availability in a written quotation.';
    case 'production':
      return 'Confirm LED/stage/AV inclusions and crew hours in a written quotation.';
    case 'catering':
      return 'Confirm menu, pax, service staff, and dietary options in a written quotation.';
    case 'speaker':
      return 'Confirm speaker fee (if any), vehicle type, and wait-time charges in a written quotation.';
    case 'promotion':
      return 'Confirm media plan, print specs, and actual insertion costs in a written quotation.';
    default:
      return 'Confirm 2026 package rate, inclusions, and availability in writing before booking.';
  }
}

function formatVendorShortlist(vendors: string[]): string {
  return vendors.join(' / ');
}

export function buildEstimateNotes(input: {
  category: string;
  suggestedVendor: string;
  venue: string;
}): string {
  return [
    AI_ESTIMATE_DISCLAIMER + '.',
    `Suggested vendor (AI proposal — not a verified contact; verify quotation): ${input.suggestedVendor}.`,
    `Venue/location: ${input.venue}.`,
    verifyHintForCategory(input.category),
  ].join(' ');
}

export function ensureActionableEstimateNotes(notes: string, suggestedVendor: string, venue: string, category = 'Other'): string {
  const trimmed = notes.trim();
  const withDisclaimer = trimmed.includes(AI_ESTIMATE_DISCLAIMER)
    ? trimmed
    : `${trimmed ? `${trimmed} — ` : ''}${AI_ESTIMATE_DISCLAIMER}`;
  const extras: string[] = [];
  if (!/suggested vendor/i.test(withDisclaimer) && !withDisclaimer.includes(suggestedVendor)) {
    extras.push(`Suggested vendor (AI proposal — not a verified contact; verify quotation): ${suggestedVendor}.`);
  }
  if (!/venue\/location/i.test(withDisclaimer) && !/\bvenue\b/i.test(withDisclaimer)) {
    extras.push(`Venue/location: ${venue}.`);
  }
  if (!/written quotation|verify quotation|confirm /i.test(withDisclaimer) || extras.length > 0) {
    const hint = verifyHintForCategory(category);
    if (!withDisclaimer.includes(hint) && extras.length > 0) extras.push(hint);
  }
  return extras.length ? `${withDisclaimer} ${extras.join(' ')}` : withDisclaimer;
}

function parseRupiahAmount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/\D/g, ''));
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function asBudgetItem(source: Record<string, unknown>, location: unknown): EventPlanBudgetItem {
  const category = typeof source.category === 'string' && source.category.trim() ? source.category.trim() : 'Other';
  const suggestedVendor = typeof source.suggestedVendor === 'string' && source.suggestedVendor.trim()
    ? source.suggestedVendor.trim()
    : formatVendorShortlist(suggestedVendorsForCategory(category, location));
  const venue = typeof source.venue === 'string' && source.venue.trim()
    ? source.venue.trim()
    : formatVenueLine(location);
  const notes = ensureActionableEstimateNotes(
    typeof source.notes === 'string' ? source.notes : '',
    suggestedVendor,
    venue,
    category,
  );
  return {
    ...source,
    category,
    estimatedCost: parseRupiahAmount(source.estimatedCost) ?? 0,
    suggestedVendor,
    venue,
    notes,
  };
}

export function buildPreliminaryBudget(budgetCeiling: number, location?: unknown): Record<string, unknown> {
  const city = resolveEventLocation(location);
  const venue = formatVenueLine(city);
  const contingency = Math.floor(budgetCeiling * 0.1);
  const available = budgetCeiling - contingency;
  const categories = [
    { category: 'Venue & room setup', estimatedCost: Math.floor(available * 0.30) },
    { category: 'Production & AV', estimatedCost: Math.floor(available * 0.20) },
    { category: 'Catering & hospitality', estimatedCost: Math.floor(available * 0.20) },
    { category: 'Speaker & transport', estimatedCost: Math.floor(available * 0.12) },
  ];
  const allocated = categories.reduce((sum, item) => sum + item.estimatedCost, 0);
  const items = [
    ...categories,
    { category: 'Promotion & operations', estimatedCost: available - allocated },
  ].map((item) => {
    const suggestedVendor = formatVendorShortlist(suggestedVendorsForCategory(item.category, city));
    return {
      ...item,
      suggestedVendor,
      venue,
      notes: buildEstimateNotes({ category: item.category, suggestedVendor, venue }),
    };
  });
  return {
    currency: 'IDR',
    total: budgetCeiling,
    items,
    contingency,
    preliminary: true,
  };
}

export function normalizeGeneratedBudget(value: unknown, budgetCeiling: number | undefined, location?: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    const items = Array.isArray(source.items)
      ? source.items.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      : [];
    const total = parseRupiahAmount(source.total);
    if (items.length > 0 && total !== undefined) {
      return {
        ...source,
        currency: 'IDR',
        total,
        items: items.map((item) => asBudgetItem(item as Record<string, unknown>, location)),
      };
    }
  }
  return budgetCeiling === undefined ? {} : buildPreliminaryBudget(budgetCeiling, location);
}
