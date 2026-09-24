import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MarketNewsCandidate, MarketProductCategory } from './market-research';
import type { MarketResearchSourceStatus } from './market-research-status';

const TOKEN_VERSION = 'mr1';
export const MARKET_RESEARCH_SHORTLIST_TTL_MS = 30 * 60 * 1000;

export interface MarketResearchGatherClaims {
  userId: string;
  brief: string;
  researchDate: string;
  exp: number;
  candidates: MarketNewsCandidate[];
  groupsSearched: MarketProductCategory[];
  groupCandidateCounts: Record<MarketProductCategory, number>;
  sourceStatus: MarketResearchSourceStatus[];
  themeCandidateCount: number;
}

export interface MarketResearchShortlistCandidate {
  id: string;
  outlet: string;
  title: string;
  url: string;
  publishedAt: string;
  publicationTimeKnown: boolean;
  categories: MarketNewsCandidate['categories'];
  symbols: string[];
  origin: MarketNewsCandidate['origin'];
  importanceCategory: string;
  evidenceLevel: MarketNewsCandidate['evidenceLevel'];
  excerpt: string;
}

export function marketResearchGatherSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = (env.JWT_SECRET || env.AI_RESEARCH_SHARE_SECRET || '').trim();
  if (!secret) throw new Error('Set JWT_SECRET before Market Research can hold a candidate shortlist.');
  return secret;
}

export function toMarketResearchShortlistCandidate(candidate: MarketNewsCandidate): MarketResearchShortlistCandidate {
  return {
    id: candidate.id,
    outlet: candidate.outlet,
    title: candidate.title,
    url: candidate.url,
    publishedAt: candidate.publishedAt,
    publicationTimeKnown: candidate.publicationTimeKnown !== false,
    categories: candidate.categories,
    symbols: candidate.symbols,
    origin: candidate.origin,
    importanceCategory: candidate.importanceCategory,
    evidenceLevel: candidate.evidenceLevel,
    excerpt: candidate.evidence.replace(/\s+/g, ' ').trim().slice(0, 220),
  };
}

export function signMarketResearchGatherToken(claims: MarketResearchGatherClaims, secret: string, now = Date.now()): string {
  if (!secret.trim()) throw new Error('Shortlist signing secret is required.');
  if (!claims.userId.trim() || !claims.brief.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(claims.researchDate)) {
    throw new Error('Shortlist claims are incomplete.');
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new Error('Shortlist expiry is invalid.');
  if (!Array.isArray(claims.candidates) || claims.candidates.length < 2) throw new Error('A shortlist needs at least two candidates.');
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(`${TOKEN_VERSION}~${payload}`).digest('base64url');
  return `${TOKEN_VERSION}~${payload}~${sig}`;
}

export function verifyMarketResearchGatherToken(
  token: string,
  secret: string,
  now = Date.now(),
): { ok: true; claims: MarketResearchGatherClaims } | { ok: false; reason: 'expired' | 'invalid' } {
  if (!secret.trim() || !token) return { ok: false, reason: 'invalid' };
  const parts = token.split('~');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: 'invalid' };
  const payload = parts[1];
  const sig = parts[2];
  if (!payload || !sig) return { ok: false, reason: 'invalid' };
  const expected = createHmac('sha256', secret).update(`${TOKEN_VERSION}~${payload}`).digest('base64url');
  const actual = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return { ok: false, reason: 'invalid' };
  let parsed: MarketResearchGatherClaims;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MarketResearchGatherClaims;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.candidates)) return { ok: false, reason: 'invalid' };
  if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) return { ok: false, reason: 'invalid' };
  if (parsed.exp <= now) return { ok: false, reason: 'expired' };
  if (typeof parsed.userId !== 'string' || typeof parsed.brief !== 'string' || typeof parsed.researchDate !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  if (!parsed.candidates.every(isCandidate)) return { ok: false, reason: 'invalid' };
  return { ok: true, claims: parsed };
}

export function candidatesForShortlist(claims: MarketResearchGatherClaims, ids: readonly string[]): MarketNewsCandidate[] {
  const wanted = new Set(ids);
  const picked = claims.candidates.filter(candidate => wanted.has(candidate.id));
  if (picked.length !== wanted.size) throw new Error('One or more shortlist candidates are no longer available. Run the search again.');
  if (picked.length === 0) throw new Error('Select at least one candidate.');
  return picked;
}

function isCandidate(value: unknown): value is MarketNewsCandidate {
  if (!value || typeof value !== 'object') return false;
  const row = value as MarketNewsCandidate;
  return typeof row.id === 'string'
    && typeof row.url === 'string'
    && typeof row.title === 'string'
    && typeof row.evidence === 'string'
    && typeof row.outlet === 'string'
    && Array.isArray(row.symbols)
    && Array.isArray(row.categories)
    && (row.evidenceLevel === 'publisher-metadata' || row.evidenceLevel === 'search-snippet' || row.evidenceLevel === 'full-text');
}
