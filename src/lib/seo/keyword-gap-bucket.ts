/** Keyword Gap buckets. Free mode never invents a competitor position or a search volume. */

export const GAP_BUCKETS = ['missing', 'weak', 'almost', 'shared', 'strength'] as const;
export type GapBucket = (typeof GAP_BUCKETS)[number];

export interface OurKeyword {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

export interface CompetitorKeyword {
  keyword: string;
  domain: string;
  /** Null in Free mode. A number only when a ranking provider returned it. */
  position: number | null;
  volume: number | null;
}

export interface GapKeyword {
  keyword: string;
  bucket: GapBucket;
  intent: 'informational' | 'navigational' | 'commercial' | 'transactional' | null;
  ourPosition: number | null;
  ourClicks: number | null;
  ourImpressions: number | null;
  competitorPosition: number | null;
  volume: number | null;
  competitors: string[];
}

export const FREE_METHODOLOGY = 'Free mode compares our Search Console queries with topics found on competitor pages. Competitor positions are not real ranking data. This is a content-coverage gap. Volume and competitor position are shown as an em dash because they were not measured.';

export function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function assignBucket(ourPosition: number | null, competitorCovers: boolean): GapBucket | null {
  if (ourPosition === null || ourPosition <= 0) return competitorCovers ? 'missing' : null;
  if (ourPosition > 20) return 'weak';
  if (ourPosition > 10) return 'almost';
  return competitorCovers ? 'shared' : 'strength';
}

function tokens(phrase: string): string[] {
  return normalizePhrase(phrase).split(' ').filter(Boolean);
}

/** A competitor phrase covers our query when the phrases match, or the shorter one sits inside the longer one. */
export function phrasesMatch(left: string, right: string): boolean {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 2) return false;
  const haystack = ` ${longer.join(' ')} `;
  return haystack.includes(` ${shorter.join(' ')} `);
}

export function buildGapKeywords(input: {
  ours: OurKeyword[];
  competitorKeywords: CompetitorKeyword[];
  intents?: Record<string, GapKeyword['intent']>;
  /** Free mode forces competitor position and volume to null. */
  ranked: boolean;
}): GapKeyword[] {
  const rows = new Map<string, GapKeyword>();
  const remember = (keyword: string, our: OurKeyword | null, competitor: CompetitorKeyword | null) => {
    const key = normalizePhrase(keyword);
    if (!key) return;
    const current = rows.get(key) ?? {
      keyword: key,
      bucket: 'missing' as GapBucket,
      intent: input.intents?.[key] ?? null,
      ourPosition: null,
      ourClicks: null,
      ourImpressions: null,
      competitorPosition: null,
      volume: null,
      competitors: [],
    };
    if (our) {
      current.ourClicks = (current.ourClicks ?? 0) + our.clicks;
      current.ourImpressions = (current.ourImpressions ?? 0) + our.impressions;
      if (our.position && (current.ourPosition === null || our.position < current.ourPosition)) current.ourPosition = our.position;
    }
    if (competitor) {
      if (!current.competitors.includes(competitor.domain)) current.competitors.push(competitor.domain);
      if (input.ranked && competitor.position && (current.competitorPosition === null || competitor.position < current.competitorPosition)) {
        current.competitorPosition = competitor.position;
      }
      if (input.ranked && competitor.volume && (current.volume === null || competitor.volume > current.volume)) current.volume = competitor.volume;
    }
    rows.set(key, current);
  };

  for (const keyword of input.competitorKeywords) remember(keyword.keyword, null, keyword);
  for (const our of input.ours) {
    const match = input.competitorKeywords.find(keyword => phrasesMatch(keyword.keyword, our.query));
    remember(our.query, our, match ?? null);
  }

  const gaps: GapKeyword[] = [];
  for (const row of rows.values()) {
    const bucket = assignBucket(row.ourPosition, row.competitors.length > 0);
    if (!bucket) continue;
    if (!input.ranked) {
      row.competitorPosition = null;
      row.volume = null;
    }
    gaps.push({ ...row, bucket });
  }
  const order: GapBucket[] = ['missing', 'weak', 'almost', 'shared', 'strength'];
  return gaps.sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket) || a.keyword.localeCompare(b.keyword));
}

export function bucketCounts(keywords: GapKeyword[]): Record<GapBucket, number> {
  const counts = { missing: 0, weak: 0, almost: 0, shared: 0, strength: 0 };
  for (const keyword of keywords) counts[keyword.bucket] += 1;
  return counts;
}
