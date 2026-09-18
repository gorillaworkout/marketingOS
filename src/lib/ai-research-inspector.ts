import {
  extractGroundedPersonFacts,
  isOfficialPersonFact,
  isOfficialResearchHost,
  researchSourceHost,
  shouldResearchQuery,
  type ResearchContext,
  type ResearchOrigin,
} from './ai-research-grounding';

/** Truncated snippet length for the SSE/UI payload. The model still receives full excerpts. */
export const AI_RESEARCH_UI_SNIPPET_MAX = 400;
export const AI_RESEARCH_MAX_PINNED_URLS = 32;

export type ResearchGatherStatus = 'ok' | 'failed' | 'skipped' | 'empty';
export type ResearchTraceKind = 'person_fact' | 'other_public_trace';
export type ResearchOriginChip = 'indonesia' | 'international' | 'official';

export interface InspectorResearchSource {
  title: string;
  url: string;
  origin: ResearchOrigin;
  snippet: string;
  official: boolean;
  originChip: ResearchOriginChip;
  traceKind: ResearchTraceKind | null;
}

export interface ResearchSsePayload {
  type: 'research';
  sourceCount: number;
  grounding: ResearchGatherStatus;
  sources: InspectorResearchSource[];
}

export const RESEARCH_STATUS_COPY: Record<ResearchGatherStatus, { title: string; body: string }> = {
  ok: {
    title: 'Sumber yang dipakai',
    body: 'Semua jejak yang di-ground ke model. Anda yang memutuskan mana yang dipercaya.',
  },
  empty: {
    title: 'Tidak ada sumber',
    body: 'Pencarian selesai, tetapi tidak ada sumber web yang bisa dipakai. Jawaban tidak grounded.',
  },
  failed: {
    title: 'Pencarian sumber gagal',
    body: 'Gagal mengambil sumber riset. Jawaban Dupoin AI mungkin tidak grounded ke web. Coba kirim ulang.',
  },
  skipped: {
    title: 'Riset web dilewati',
    body: 'Pertanyaan ini tidak membutuhkan pencarian sumber.',
  },
};

export const RESEARCH_FAILED_BANNER =
  'Pencarian sumber gagal. Jawaban Dupoin AI mungkin tidak grounded ke web.';
export const RESEARCH_DISCONNECT_BANNER =
  'Koneksi terputus sebelum jawaban selesai. Cuplikan yang sudah diterima tetap ditampilkan.';
export const RESEARCH_IDLE_COPY =
  'Sumber muncul setelah Anda mengirim pertanyaan riset. Semua jejak yang ditemukan akan ditampilkan di sini.';

export function truncateResearchSnippet(
  snippet: string,
  max = AI_RESEARCH_UI_SNIPPET_MAX,
): string {
  const trimmed = (snippet || '').replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  const cut = Math.max(1, max - 1);
  const sliced = trimmed.slice(0, cut);
  const lastSpace = sliced.lastIndexOf(' ');
  const body = lastSpace >= Math.floor(cut * 0.6) ? sliced.slice(0, lastSpace) : sliced;
  return `${body.trimEnd()}…`;
}

export function resolveResearchGatherStatus(options: {
  query: string;
  failed: boolean;
  sourceCount: number;
}): ResearchGatherStatus {
  if (options.failed) return 'failed';
  if (!shouldResearchQuery(options.query)) return 'skipped';
  if (options.sourceCount <= 0) return 'empty';
  return 'ok';
}

export function parsePinnedSourceUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const url = item.trim();
    if (!url || url.length > 2_048) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    } catch {
      continue;
    }
    const key = url.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
    if (urls.length >= AI_RESEARCH_MAX_PINNED_URLS) break;
  }
  return urls;
}

function sourceUrlKey(url: string): string {
  return url.replace(/\/$/, '');
}

export function applyPinnedResearchSources(
  research: ResearchContext,
  pinnedUrls: string[],
): ResearchContext {
  if (!pinnedUrls.length) return research;
  const wanted = new Set(pinnedUrls.map(sourceUrlKey));
  const filtered = research.sources.filter(source => wanted.has(sourceUrlKey(source.url)));
  if (!filtered.length) return research;
  return { ...research, sources: filtered };
}

export function serializeInspectorSources(
  research: ResearchContext | null,
): InspectorResearchSource[] {
  if (!research?.sources.length) return [];
  const facts = extractGroundedPersonFacts(research);
  const factByUrl = new Map<string, (typeof facts)[number]>();
  for (const fact of facts) {
    const key = sourceUrlKey(fact.url);
    if (!factByUrl.has(key)) factByUrl.set(key, fact);
  }

  return research.sources.map(source => {
    const official = isOfficialResearchHost(source.url);
    const fact = factByUrl.get(sourceUrlKey(source.url));
    let traceKind: ResearchTraceKind | null = null;
    if (fact) {
      traceKind = isOfficialPersonFact(fact) ? 'person_fact' : 'other_public_trace';
    }
    return {
      title: (source.title || source.url).trim() || source.url,
      url: source.url,
      origin: source.origin,
      snippet: truncateResearchSnippet(source.snippet),
      official,
      originChip: official ? 'official' : source.origin,
      traceKind,
    };
  });
}

export function buildResearchSsePayload(options: {
  query: string;
  research: ResearchContext | null;
  failed: boolean;
}): ResearchSsePayload {
  const sources = options.failed ? [] : serializeInspectorSources(options.research);
  return {
    type: 'research',
    sourceCount: sources.length,
    grounding: resolveResearchGatherStatus({
      query: options.query,
      failed: options.failed,
      sourceCount: sources.length,
    }),
    sources,
  };
}

export function inspectorSourceHost(url: string): string {
  return researchSourceHost(url) || url;
}

export function normalizeInspectorSource(raw: unknown): InspectorResearchSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.url !== 'string' || !item.url.trim()) return null;
  const url = item.url.trim();
  const origin: ResearchOrigin = item.origin === 'indonesia' ? 'indonesia' : 'international';
  const official = item.official === true || isOfficialResearchHost(url);
  const originChip: ResearchOriginChip =
    item.originChip === 'official' || item.originChip === 'indonesia' || item.originChip === 'international'
      ? item.originChip
      : official ? 'official' : origin;
  const traceKind: ResearchTraceKind | null =
    item.traceKind === 'person_fact' || item.traceKind === 'other_public_trace'
      ? item.traceKind
      : null;
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : url;
  return {
    title,
    url,
    origin,
    snippet: truncateResearchSnippet(typeof item.snippet === 'string' ? item.snippet : ''),
    official,
    originChip,
    traceKind,
  };
}
