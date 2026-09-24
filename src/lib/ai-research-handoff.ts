import { validateStoredSources } from './ai-research';

/** One-click prefill into existing generators. Nothing here publishes. */

export const AI_RESEARCH_HANDOFF_STORAGE_KEY = 'mos.ai-research.handoff';
export const AI_RESEARCH_HANDOFF_QUERY = 'from';
export const AI_RESEARCH_HANDOFF_VALUE = 'ai-research';
export const AI_RESEARCH_HANDOFF_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type AiResearchHandoffTarget = 'social-post' | 'article-market-news' | 'video-script';

export interface AiResearchHandoffSource {
  title: string;
  url: string;
}

export interface AiResearchHandoffRecord {
  target: AiResearchHandoffTarget;
  query: string;
  answer: string;
  sources: AiResearchHandoffSource[];
  savedAt: string;
}

export const AI_RESEARCH_HANDOFF_MODULES: Array<{
  id: AiResearchHandoffTarget;
  label: string;
  href: string;
}> = [
  {
    id: 'social-post',
    label: 'Send to Social Post',
    href: `/dashboard/social-post?${AI_RESEARCH_HANDOFF_QUERY}=${AI_RESEARCH_HANDOFF_VALUE}`,
  },
  {
    id: 'article-market-news',
    label: 'Send to Article Market News',
    href: `/dashboard/sop?${AI_RESEARCH_HANDOFF_QUERY}=${AI_RESEARCH_HANDOFF_VALUE}`,
  },
  {
    id: 'video-script',
    label: 'Send to Video Script',
    href: `/dashboard/video-script?${AI_RESEARCH_HANDOFF_QUERY}=${AI_RESEARCH_HANDOFF_VALUE}`,
  },
];

export function condenseResearchText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, Math.max(0, max - 1));
  const space = cut.lastIndexOf(' ');
  const base = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${base.trim()}…`;
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function safeSources(value: unknown): AiResearchHandoffSource[] {
  return validateStoredSources(value).filter(source => isPublicHttpUrl(source.url));
}

function sourceLines(sources: AiResearchHandoffSource[], limit = 8): string[] {
  return safeSources(sources).slice(0, limit).map(source => `- ${source.title} (${source.url})`);
}

export function buildSocialPostBrief(input: {
  query: string;
  answer: string;
  sources?: AiResearchHandoffSource[];
}): string {
  const query = condenseResearchText(input.query, 500) || 'Dupoin AI research';
  const answer = condenseResearchText(input.answer, 1_600);
  const sources = sourceLines(input.sources || []);
  return [
    `Research topic: ${query}`,
    '',
    'Summary:',
    answer || '(Empty answer)',
    '',
    sources.length ? `Sources:\n${sources.join('\n')}` : 'Sources: none on this message.',
    '',
    'Note: draft from Dupoin AI Research. Not published yet — edit before you generate.',
  ].join('\n');
}

export function buildVideoScriptBrief(input: {
  query: string;
  answer: string;
  sources?: AiResearchHandoffSource[];
}): string {
  const query = condenseResearchText(input.query, 500) || 'Dupoin AI research';
  const answer = condenseResearchText(input.answer, 1_600);
  const sources = sourceLines(input.sources || []);
  return [
    `Research topic: ${query}`,
    '',
    'Summary:',
    answer || '(Empty answer)',
    '',
    sources.length ? `Sources:\n${sources.join('\n')}` : 'Sources: none on this message.',
    '',
    'Note: draft from Dupoin AI Research. Not published yet — edit before you generate a video script.',
  ].join('\n');
}

export function buildVideoScriptReferenceLinks(sources?: AiResearchHandoffSource[]): string {
  return safeSources(sources || []).slice(0, 4).map((source) => source.url).join('\n');
}

export function buildArticleMarketNewsPrefill(input: {
  query: string;
  answer: string;
  sources?: AiResearchHandoffSource[];
}): { keyword: string; angle: string } {
  const query = condenseResearchText(input.query, 500) || 'Market research';
  const keyword = condenseResearchText(query.replace(/[?？]+$/g, ''), 120);
  const sources = sourceLines(input.sources || []);
  const angle = [
    condenseResearchText(input.answer, 1_800),
    '',
    `Research question: ${query}`,
    sources.length ? `Research sources:\n${sources.join('\n')}` : '',
    'Complete the competitor structure and PAA. Do not generate until the facts are checked.',
  ].filter(Boolean).join('\n');
  return { keyword, angle };
}

export function serializeAiResearchHandoff(record: Omit<AiResearchHandoffRecord, 'savedAt'> & { savedAt?: string }): string {
  const sources = safeSources(record.sources);
  const payload: AiResearchHandoffRecord = {
    target: record.target,
    query: condenseResearchText(record.query, 2_000),
    answer: record.answer.replace(/\s+$/g, '').slice(0, 20_000),
    sources,
    savedAt: record.savedAt || new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

export function parseAiResearchHandoff(
  raw: string | null | undefined,
  target: AiResearchHandoffTarget,
  now = Date.now(),
): { brief?: string; keyword?: string; angle?: string; references?: string; query: string } | null {
  if (!raw) return null;
  let parsed: Partial<AiResearchHandoffRecord>;
  try {
    parsed = JSON.parse(raw) as Partial<AiResearchHandoffRecord>;
  } catch {
    return null;
  }
  if (parsed.target !== target) return null;
  const savedAt = typeof parsed.savedAt === 'string' ? Date.parse(parsed.savedAt) : NaN;
  if (!Number.isFinite(savedAt) || now - savedAt > AI_RESEARCH_HANDOFF_MAX_AGE_MS || savedAt > now + 60_000) return null;
  const query = typeof parsed.query === 'string' ? parsed.query : '';
  const answer = typeof parsed.answer === 'string' ? parsed.answer : '';
  const sources = safeSources(parsed.sources);
  if (target === 'social-post') {
    return { query, brief: buildSocialPostBrief({ query, answer, sources }) };
  }
  if (target === 'video-script') {
    return {
      query,
      brief: buildVideoScriptBrief({ query, answer, sources }),
      references: buildVideoScriptReferenceLinks(sources),
    };
  }
  const article = buildArticleMarketNewsPrefill({ query, answer, sources });
  return { query, keyword: article.keyword, angle: article.angle };
}

export function writeAiResearchHandoff(record: Omit<AiResearchHandoffRecord, 'savedAt'>): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(AI_RESEARCH_HANDOFF_STORAGE_KEY, serializeAiResearchHandoff(record));
}

export function readAiResearchHandoff(
  target: AiResearchHandoffTarget,
  now = Date.now(),
): { brief?: string; keyword?: string; angle?: string; references?: string; query: string } | null {
  if (typeof sessionStorage === 'undefined') return null;
  return parseAiResearchHandoff(sessionStorage.getItem(AI_RESEARCH_HANDOFF_STORAGE_KEY), target, now);
}
