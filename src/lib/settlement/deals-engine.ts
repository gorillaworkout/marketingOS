/**
 * In-memory rules for a Deals History session. SQL in deals-store.ts follows these steps.
 * The input state is never mutated, so a thrown commit leaves the caller holding the old facts.
 */
import { eachDate, MAX_CHUNK_BYTES, MAX_CHUNK_DEALS, type DealsTitle, type ParsedDeal } from './deals-parse';

export type DealFact = ParsedDeal;

export interface StagedDeal extends DealFact { seq: number }

export interface DhSession {
  id: string;
  ownerId: string;
  status: 'open' | 'committed' | 'aborted';
  title: DealsTitle | null;
  chunks: Record<number, string>;
  staging: Record<string, StagedDeal>;
}

export interface CoverageCell { status: 'full' | 'partial'; sessionId: string }

export interface DhState {
  sessions: Record<string, DhSession>;
  facts: Record<string, DealFact>;
  coverage: Record<string, CoverageCell>;
}

export function emptyDhState(): DhState {
  return { sessions: {}, facts: {}, coverage: {} };
}

const clone = <T>(value: T): T => structuredClone(value);

export type EngineResult<T> = { ok: true; state: DhState; value: T } | { ok: false; state: DhState; error: string };

export function openDhSession(state: DhState, input: { id: string; ownerId: string; title: DealsTitle | null }): EngineResult<{ id: string }> {
  if (state.sessions[input.id]) return { ok: false, state, error: 'Session already exists' };
  const next = clone(state);
  next.sessions[input.id] = { id: input.id, ownerId: input.ownerId, status: 'open', title: input.title, chunks: {}, staging: {} };
  return { ok: true, state: next, value: { id: input.id } };
}

function owned(state: DhState, sessionId: string, actorId: string): DhSession | string {
  const session = state.sessions[sessionId];
  if (!session) return 'Session not found';
  if (session.ownerId !== actorId) return 'You cannot change another user\'s upload session';
  if (session.status !== 'open') return 'Session is not open';
  return session;
}

export function applyDhChunk(state: DhState, input: {
  sessionId: string; actorId: string; seq: number; hash: string; deals: DealFact[]; byteLength: number;
}): EngineResult<{ idempotent: boolean; staged: number }> {
  const session = owned(state, input.sessionId, input.actorId);
  if (typeof session === 'string') return { ok: false, state, error: session };
  if (input.deals.length > MAX_CHUNK_DEALS) return { ok: false, state, error: `A chunk can contain at most ${MAX_CHUNK_DEALS} deals` };
  if (input.byteLength > MAX_CHUNK_BYTES) return { ok: false, state, error: 'The chunk is larger than 25 MB' };
  if (session.chunks[input.seq] === input.hash) return { ok: true, state, value: { idempotent: true, staged: 0 } };
  const next = clone(state);
  const target = next.sessions[input.sessionId];
  for (const deal of Object.keys(target.staging)) {
    if (target.staging[deal].seq === input.seq) delete target.staging[deal];
  }
  for (const deal of input.deals) {
    const current = target.staging[deal.deal];
    if (current && current.seq > input.seq) continue;
    target.staging[deal.deal] = { ...deal, seq: input.seq };
  }
  target.chunks[input.seq] = input.hash;
  return { ok: true, state: next, value: { idempotent: false, staged: input.deals.length } };
}

const money = (deals: DealFact[], field: 'commission' | 'swap') => Math.round(deals.reduce((sum, deal) => sum + deal[field], 0) * 100) / 100;

export function footerMatches(deals: DealFact[], footer: { commission: number; swap: number }): boolean {
  return Math.abs(money(deals, 'commission') - footer.commission) <= 0.01 && Math.abs(money(deals, 'swap') - footer.swap) <= 0.01;
}

export interface MergeResult {
  upserts: DealFact[];
  touchedDates: string[];
  inserted: number;
  updated: number;
  unchanged: number;
}

/** Merge this file's deals into the facts for those deal ids only. Deals not in `incoming` are not returned and must stay. */
export function mergeIncoming(existing: Record<string, DealFact>, incoming: DealFact[]): MergeResult {
  const upserts: DealFact[] = [];
  const touched = new Set<string>();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  for (const deal of incoming) {
    const previous = existing[deal.deal];
    if (!previous) {
      inserted += 1;
      touched.add(deal.serverDate);
      upserts.push(deal);
    } else if (sameFact(previous, deal)) {
      unchanged += 1;
    } else {
      updated += 1;
      touched.add(previous.serverDate);
      touched.add(deal.serverDate);
      upserts.push(deal);
    }
  }
  return { upserts, touchedDates: [...touched].sort(), inserted, updated, unchanged };
}

function sameFact(a: DealFact, b: DealFact): boolean {
  return a.login === b.login && a.serverTime === b.serverTime && a.entry === b.entry
    && a.volume === b.volume && a.commission === b.commission && a.fee === b.fee
    && a.swap === b.swap && a.profit === b.profit && a.currency === b.currency && a.rate === b.rate;
}

export function commitDhSession(state: DhState, input: {
  sessionId: string; actorId: string; footer: { commission: number; swap: number }; beforePublish?: () => void;
}): EngineResult<MergeResult> {
  const session = owned(state, input.sessionId, input.actorId);
  if (typeof session === 'string') return { ok: false, state, error: session };
  const incoming = Object.values(session.staging).map(row => ({
    deal: row.deal, login: row.login, serverTime: row.serverTime, serverDate: row.serverDate, entry: row.entry,
    volume: row.volume, commission: row.commission, fee: row.fee, swap: row.swap, profit: row.profit, currency: row.currency, rate: row.rate,
  }));
  if (!footerMatches(incoming, input.footer)) return { ok: false, state, error: 'Footer total does not match the parsed Commission and Swap columns' };
  const existing: Record<string, DealFact> = {};
  for (const deal of incoming) if (state.facts[deal.deal]) existing[deal.deal] = state.facts[deal.deal];
  const merged = mergeIncoming(existing, incoming);
  input.beforePublish?.();
  const next = clone(state);
  for (const deal of merged.upserts) next.facts[deal.deal] = deal;
  const published = next.sessions[input.sessionId];
  published.status = 'committed';
  published.staging = {};
  if (published.title) {
    for (const date of eachDate(published.title.from, published.title.to)) {
      if (published.title.star) next.coverage[date] = { status: 'full', sessionId: published.id };
      else if (next.coverage[date]?.status !== 'full') next.coverage[date] = { status: 'partial', sessionId: published.id };
    }
  }
  return { ok: true, state: next, value: merged };
}

export function abortDhSession(state: DhState, input: { sessionId: string; actorId: string }): EngineResult<{ aborted: true }> {
  const session = owned(state, input.sessionId, input.actorId);
  if (typeof session === 'string') return { ok: false, state, error: session };
  const next = clone(state);
  next.sessions[input.sessionId].status = 'aborted';
  next.sessions[input.sessionId].staging = {};
  next.sessions[input.sessionId].chunks = {};
  return { ok: true, state: next, value: { aborted: true } };
}
