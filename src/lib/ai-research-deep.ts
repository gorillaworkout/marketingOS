import {
  buildOpenWebSearchQueries,
  buildSearchQueries,
  prefersIndonesiaSources,
  selectFinalResearchSources,
  type ResearchContext,
  type ResearchSource,
} from './ai-research-grounding';

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

export const AI_RESEARCH_DEEP_STATUS = {
  plan: 'menyusun rencana…',
  search: 'mencari…',
  read: 'membaca sumber…',
  synthesize: 'menyusun…',
} as const;

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

export const AI_RESEARCH_DEEP_PLAN_PROMPT = `Kamu merencanakan riset web untuk Dupoin AI. Balas HANYA JSON valid, tanpa markdown:
{"outline":["langkah 1","langkah 2","langkah 3"],"queries":["kueri pencarian 1","kueri 2"]}
Aturan:
- 3 langkah outline singkat dalam Bahasa Indonesia.
- Maksimal 3 kueri pencarian yang spesifik dan berbeda. Jangan mengulang pertanyaan pengguna kata per kata jika sudah cukup spesifik; boleh memperluas sudut (regulator, berita, definisi).
- Jangan menulis jawaban riset dan jangan mengarang fakta.`;

export const AI_RESEARCH_DEEP_SYSTEM_ADDENDUM = `Mode riset mendalam aktif.
- Ikuti kerangka riset yang diberikan, lalu jawab pertanyaan pengguna secara utuh.
- Gunakan sumber dari beberapa putaran pencarian. Sitasi judul dan URL untuk klaim faktual.
- Akhiri jawaban dengan heading persis "## Kesenjangan dan keterbatasan".
- Di bagian itu sebutkan fakta yang belum tercakup sumber, ketidakpastian identitas atau angka, dan batas pencarian. Jangan mengisi kekosongan dengan tebakan.`;

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
  if (!queries.length) queries.push(base || 'riset');
  const topic = (base || 'pertanyaan ini').slice(0, 120);
  return {
    outline: [
      `Definisikan cakupan: ${topic}`,
      'Kumpulkan fakta dari beberapa kueri dan sumber yang saling mengecek.',
      'Sintesis jawaban bersitasi dan catat kesenjangan yang belum tertutup sumber.',
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
  const origin = plan.source === 'model' ? 'model' : 'cadangan deterministik';
  return [
    'KERANGKA RISET MENDALAM',
    `Asal rencana: ${origin}`,
    `Putaran dijalankan: ${meta.roundsRun}. Status: ${meta.stoppedReason}.`,
    'Outline:',
    outline,
    'Kueri:',
    queries,
  ].join('\n');
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
  if (/^#{1,3}\s+kesenjangan dan keterbatasan\s*$/im.test(answer)) return answer;
  let reason: string;
  if (meta.skipped === 'url-only') {
    reason = 'Pencarian web tambahan dilewati karena pesan hanya berisi tautan. Konteks diambil dari halaman tautan bila berhasil.';
  } else if (meta.skipped === 'not-needed') {
    reason = 'Pencarian web tidak dijalankan untuk pertanyaan singkat ini.';
  } else if (meta.stoppedReason === 'budget') {
    reason = 'Pencarian dihentikan karena batas waktu riset mendalam.';
  } else if (meta.stoppedReason === 'cap') {
    reason = 'Pencarian dihentikan karena batas jumlah putaran.';
  } else {
    reason = 'Semua putaran pencarian yang direncanakan dijalankan dalam batas yang ditetapkan.';
  }
  const section = [
    '',
    '',
    '## Kesenjangan dan keterbatasan',
    '',
    `${reason} Putaran pencarian: ${meta.roundsRun} dari ${meta.plannedQueries}. Sumber yang dipakai: ${meta.sourceCount}.`,
    'Klaim di luar cuplikan sumber tidak diverifikasi. Jika suatu fakta tidak disebut di sumber, anggap belum terkonfirmasi.',
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
    const remaining = budgetMs - (now() - started);
    if (remaining < 1_500) break;
    await options.onProgress?.({
      phase: 'search',
      message: AI_RESEARCH_DEEP_STATUS.search,
      round: roundsRun + 1,
      query: searchQuery,
    });
    const timeoutMs = Math.max(1_500, Math.min(roundTimeoutMs, remaining));
    try {
      contexts.push(await options.gather(searchQuery, timeoutMs));
    } catch {
      failedRounds += 1;
      contexts.push({
        query: searchQuery,
        sources: [],
        indonesiaPreferred: prefersIndonesiaSources(searchQuery),
      });
    }
    roundsRun += 1;
    const merged = mergeDeepResearchContexts(contexts, options.query);
    await options.onProgress?.({
      phase: 'read',
      message: AI_RESEARCH_DEEP_STATUS.read,
      round: roundsRun,
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
