import {
  buildOpenWebSearchQueries,
  buildSearchQueries,
  prefersIndonesiaSources,
  selectFinalResearchSources,
  type ResearchContext,
  type ResearchSource,
} from './ai-research-grounding';
import { throwIfResearchAborted } from './ai-research-abort';

/**
 * Deep research caps. The chat route budget stays inside the route `maxDuration`.
 * Each round calls the existing `gatherAiResearchContext` pipeline (Serper, then
 * Wikipedia / news / official seeds, then page fetch with Jina fallback).
 */
export const AI_RESEARCH_DEEP_MAX_ROUNDS = 3;
export const AI_RESEARCH_DEEP_MAX_QUERIES = AI_RESEARCH_DEEP_MAX_ROUNDS;
export const AI_RESEARCH_DEEP_ROUND_TIMEOUT_MS = 12_000;
export const AI_RESEARCH_DEEP_TIME_BUDGET_MS = 40_000;
export const AI_RESEARCH_DEEP_PLAN_MAX_TOKENS = 600;
export const AI_RESEARCH_DEEP_PLAN_TIMEOUT_MS = 12_000;
export const AI_RESEARCH_DEEP_MAX_SOURCES = 16;
export const AI_RESEARCH_MODE_STORAGE_KEY = 'dupoin-ai-research-mode';

/** English status copy sent on Deep-mode SSE `status` events and shown in the progress panel. */
export const AI_RESEARCH_DEEP_STATUS = {
  plan: 'Planning…',
  search: 'Searching…',
  read: 'Reading sources…',
  synthesize: 'Drafting answer…',
  gaps: 'Checking gaps / limitations…',
} as const;

export const DEEP_PROGRESS_COMPLETE = 'Research complete';
export const DEEP_PROGRESS_STOPPED = 'Research stopped';

export type DeepStatusPhase = 'plan' | 'search' | 'read' | 'synthesize' | 'gaps';

export interface DeepStatusSseEvent {
  type: 'status';
  phase: DeepStatusPhase;
  message: string;
  maxRounds: number;
  round?: number;
  sourceCount?: number;
  query?: string;
  skippedSearch?: boolean;
}

export type DeepResearchPhase = keyof typeof AI_RESEARCH_DEEP_STATUS;
export type DeepPlanSource = 'model' | 'fallback';
export type DeepStopReason = 'complete' | 'budget' | 'cap';

export interface DeepResearchPlan {
  outline: string[];
  queries: string[];
  source: DeepPlanSource;
}

export interface DeepResearchProgress {
  phase: 'search' | 'read';
  message: string;
  round: number;
  maxRounds: number;
  query: string;
  sourceCount?: number;
  research?: ResearchContext;
}

export interface DeepGatherResult {
  research: ResearchContext;
  roundsRun: number;
  failedRounds: number;
  stoppedReason: DeepStopReason;
}

export const AI_RESEARCH_DEEP_PLAN_PROMPT = `You are planning web research for Dupoin AI. Reply with ONLY valid JSON, no markdown:
{"outline":["step 1","step 2","step 3"],"queries":["search query 1","query 2"]}
Rules:
- 3 short outline steps in English.
- At most 3 specific, different search queries. Do not repeat the user's question word for word if it is already specific; you may widen the angle (regulator, news, definition).
- Do not write the research answer and do not invent facts.`;

export const AI_RESEARCH_DEEP_SYSTEM_ADDENDUM = `Deep research mode is on.
- Follow the research outline you were given, then answer the user's question in full.
- Use sources from several search rounds. Cite title and URL for factual claims.
- End the answer with the exact heading "## Gaps and limitations".
- In that section, name facts the sources do not cover, uncertainty about identity or figures, and the search limits. Do not fill gaps with guesses.`;

const QUERY_MAX = 180;
const OUTLINE_MAX = 240;

function cleanLine(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function pushUniqueQuery(queries: string[], seen: Set<string>, value: string): void {
  const next = cleanLine(value, QUERY_MAX);
  if (next.length < 3) return;
  const key = next.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  queries.push(next);
}

export function fallbackDeepResearchPlan(query: string): DeepResearchPlan {
  const base = cleanLine(query, QUERY_MAX);
  const queries: string[] = [];
  const seen = new Set<string>();
  const generated = base
    ? [...buildOpenWebSearchQueries(base), ...buildSearchQueries(base)]
    : [];
  for (const item of [base, ...generated]) {
    pushUniqueQuery(queries, seen, item);
    if (queries.length >= AI_RESEARCH_DEEP_MAX_QUERIES) break;
  }
  if (!queries.length) queries.push(base || 'research');
  const topic = (base || 'this question').slice(0, 120);
  return {
    outline: [
      `Define the scope: ${topic}`,
      'Collect facts from several queries and sources that check each other.',
      'Synthesize a cited answer and note gaps the sources do not cover.',
    ],
    queries,
    source: 'fallback',
  };
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] || trimmed).trim();
  const withoutThink = body.replace(/^<think>[\s\S]*?<\/think>\s*/i, '');
  const start = withoutThink.indexOf('{');
  const end = withoutThink.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return withoutThink.slice(start, end + 1);
}

export function parseDeepResearchPlan(raw: string, query: string): DeepResearchPlan | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as { outline?: unknown; queries?: unknown };
  if (!Array.isArray(record.outline) || !Array.isArray(record.queries)) return null;
  const outline = record.outline
    .filter((item): item is string => typeof item === 'string')
    .map(item => cleanLine(item, OUTLINE_MAX))
    .filter(Boolean)
    .slice(0, 6);
  if (outline.length < 2) return null;
  const queries: string[] = [];
  const seen = new Set<string>();
  const base = cleanLine(query, QUERY_MAX);
  const candidates = [base, ...record.queries.filter((item): item is string => typeof item === 'string')];
  for (const item of candidates) {
    pushUniqueQuery(queries, seen, item);
    if (queries.length >= AI_RESEARCH_DEEP_MAX_QUERIES) break;
  }
  if (!queries.length) return null;
  return { outline, queries, source: 'model' };
}

function sourceKey(url: string): string {
  return url.replace(/\/$/, '');
}

export function mergeDeepResearchContexts(
  contexts: ResearchContext[],
  query: string,
): ResearchContext {
  const byUrl = new Map<string, ResearchSource>();
  for (const context of contexts) {
    for (const source of context.sources) {
      if (!source.url) continue;
      const key = sourceKey(source.url);
      const existing = byUrl.get(key);
      if (!existing || source.snippet.trim().length > existing.snippet.trim().length) {
        byUrl.set(key, source);
      }
    }
  }
  const indonesiaPreferred = prefersIndonesiaSources(query);
  return {
    query,
    indonesiaPreferred,
    sources: selectFinalResearchSources(
      [...byUrl.values()],
      query,
      indonesiaPreferred,
      AI_RESEARCH_DEEP_MAX_SOURCES,
    ),
  };
}

export function formatDeepResearchPlanNote(
  plan: DeepResearchPlan,
  meta: { roundsRun: number; stoppedReason: DeepStopReason },
): string {
  const outline = plan.outline.map((item, index) => `${index + 1}. ${item}`).join('\n');
  const queries = plan.queries.map((item, index) => `${index + 1}. ${item}`).join('\n');
  const origin = plan.source === 'model' ? 'model' : 'deterministic fallback';
  return [
    'DEEP RESEARCH OUTLINE',
    `Plan source: ${origin}`,
    `Rounds run: ${meta.roundsRun}. Status: ${meta.stoppedReason}.`,
    'Outline:',
    outline,
    'Queries:',
    queries,
  ].join('\n');
}

export function answerHasDeepLimitations(answer: string): boolean {
  return /^#{1,3}\s+(gaps and limitations|kesenjangan dan keterbatasan)\s*$/im.test(answer);
}

export function formatDeepSearchStatus(round: number, maxRounds = AI_RESEARCH_DEEP_MAX_ROUNDS): string {
  const safeRound = Number.isFinite(round) && round > 0 ? Math.floor(round) : 1;
  const safeMax = Number.isFinite(maxRounds) && maxRounds > 0
    ? Math.floor(maxRounds)
    : AI_RESEARCH_DEEP_MAX_ROUNDS;
  return `Searching (round ${safeRound} of up to ${safeMax})…`;
}

export function buildDeepStatusEvent(input: {
  phase: DeepStatusPhase;
  message?: string;
  round?: number;
  maxRounds?: number;
  sourceCount?: number;
  query?: string;
  skippedSearch?: boolean;
}): DeepStatusSseEvent {
  const maxRounds = input.maxRounds && input.maxRounds > 0
    ? Math.floor(input.maxRounds)
    : AI_RESEARCH_DEEP_MAX_ROUNDS;
  let message = input.message?.trim() || '';
  if (!message) {
    if (input.phase === 'search') message = formatDeepSearchStatus(input.round ?? 1, maxRounds);
    else if (input.phase === 'plan') message = AI_RESEARCH_DEEP_STATUS.plan;
    else if (input.phase === 'read') message = AI_RESEARCH_DEEP_STATUS.read;
    else if (input.phase === 'synthesize') message = AI_RESEARCH_DEEP_STATUS.synthesize;
    else message = AI_RESEARCH_DEEP_STATUS.gaps;
  }
  const event: DeepStatusSseEvent = {
    type: 'status',
    phase: input.phase,
    message,
    maxRounds,
  };
  if (typeof input.round === 'number' && Number.isFinite(input.round)) event.round = input.round;
  if (typeof input.sourceCount === 'number' && Number.isFinite(input.sourceCount)) event.sourceCount = input.sourceCount;
  const query = input.query?.trim();
  if (query) event.query = query;
  if (input.skippedSearch) event.skippedSearch = true;
  return event;
}

export function ensureDeepLimitationsSection(
  answer: string,
  meta: {
    roundsRun: number;
    sourceCount: number;
    stoppedReason: DeepStopReason;
    plannedQueries: number;
    skipped?: 'url-only' | 'not-needed' | null;
  },
): string {
  if (answerHasDeepLimitations(answer)) return answer;
  let reason: string;
  if (meta.skipped === 'url-only') {
    reason = 'Extra web search was skipped because the message only contains links. Context comes from those pages when the fetch succeeds.';
  } else if (meta.skipped === 'not-needed') {
    reason = 'Web search was not run for this short question.';
  } else if (meta.stoppedReason === 'budget') {
    reason = 'Search stopped because the deep-research time limit was reached.';
  } else if (meta.stoppedReason === 'cap') {
    reason = 'Search stopped because the round limit was reached.';
  } else {
    reason = 'Every planned search round ran within the set limits.';
  }
  const section = [
    '',
    '',
    '## Gaps and limitations',
    '',
    `${reason} Search rounds: ${meta.roundsRun} of ${meta.plannedQueries}. Sources used: ${meta.sourceCount}.`,
    'Claims outside the source excerpts are not verified. If a fact is not stated in the sources, treat it as unconfirmed.',
    '',
  ].join('\n');
  return `${answer}${section}`;
}

export async function runDeepResearchGather(options: {
  query: string;
  plan: DeepResearchPlan;
  gather: (query: string, timeoutMs: number) => Promise<ResearchContext>;
  now?: () => number;
  budgetMs?: number;
  maxRounds?: number;
  roundTimeoutMs?: number;
  onProgress?: (event: DeepResearchProgress) => void | Promise<void>;
  /** Stops before the next search round. An in-flight round still finishes unless `gather` watches this signal. */
  signal?: AbortSignal;
}): Promise<DeepGatherResult> {
  const budgetMs = options.budgetMs ?? AI_RESEARCH_DEEP_TIME_BUDGET_MS;
  const maxRounds = options.maxRounds ?? AI_RESEARCH_DEEP_MAX_ROUNDS;
  const roundTimeoutMs = options.roundTimeoutMs ?? AI_RESEARCH_DEEP_ROUND_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const started = now();
  const queries = options.plan.queries.slice(0, maxRounds);
  const contexts: ResearchContext[] = [];
  let roundsRun = 0;
  let failedRounds = 0;

  for (const searchQuery of queries) {
    if (options.signal?.aborted) throwIfResearchAborted(options.signal);
    const remaining = budgetMs - (now() - started);
    if (remaining < 1_500) break;
    await options.onProgress?.({
      phase: 'search',
      message: formatDeepSearchStatus(roundsRun + 1, maxRounds),
      round: roundsRun + 1,
      maxRounds,
      query: searchQuery,
    });
    const timeoutMs = Math.max(1_500, Math.min(roundTimeoutMs, remaining));
    try {
      contexts.push(await options.gather(searchQuery, timeoutMs));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      failedRounds += 1;
      contexts.push({
        query: searchQuery,
        sources: [],
        indonesiaPreferred: prefersIndonesiaSources(searchQuery),
      });
    }
    roundsRun += 1;
    if (options.signal?.aborted) throwIfResearchAborted(options.signal);
    const merged = mergeDeepResearchContexts(contexts, options.query);
    await options.onProgress?.({
      phase: 'read',
      message: AI_RESEARCH_DEEP_STATUS.read,
      round: roundsRun,
      maxRounds,
      query: searchQuery,
      sourceCount: merged.sources.length,
      research: merged,
    });
  }

  let stoppedReason: DeepStopReason = 'complete';
  if (roundsRun < queries.length) stoppedReason = 'budget';
  else if (options.plan.queries.length > maxRounds) stoppedReason = 'cap';

  return {
    research: mergeDeepResearchContexts(contexts, options.query),
    roundsRun,
    failedRounds,
    stoppedReason,
  };
}
