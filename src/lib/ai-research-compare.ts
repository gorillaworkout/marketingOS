import {
  AI_RESEARCH_MAX_SOURCES,
  prefersIndonesiaSources,
  type ResearchContext,
  type ResearchSource,
} from './ai-research-grounding';

export const AI_RESEARCH_COMPARE_MAX_SIDE = 400;
export const AI_RESEARCH_COMPARE_SECTIONS = [
  'Similarities',
  'Differences',
  'Evidence A',
  'Evidence B',
  'Conclusion',
  'Sources',
] as const;

export interface AiResearchCompareRequest {
  a: string;
  b: string;
}

function cleanSide(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, AI_RESEARCH_COMPARE_MAX_SIDE);
}

export function parseCompareSides(value: unknown): AiResearchCompareRequest | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object') {
    throw new Error('Comparison is not valid.');
  }
  const raw = value as { a?: unknown; b?: unknown };
  const a = cleanSide(raw.a);
  const b = cleanSide(raw.b);
  if (!a || !b) throw new Error('Enter entity A and entity B to compare.');
  return { a, b };
}

export function buildCompareSearchQuery(side: string): string {
  return side.replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function buildCompareUserPrompt(a: string, b: string, focus?: string): string {
  const left = cleanSide(a);
  const right = cleanSide(b);
  const lines = [
    'Compare the two items below in a balanced way.',
    `A: ${left}`,
    `B: ${right}`,
  ];
  const extra = (focus || '').replace(/\s+/g, ' ').trim();
  if (extra && extra !== left && extra !== right) {
    lines.push(`Focus: ${extra.slice(0, 500)}`);
  }
  lines.push('Use only evidence from the sources that were found. Do not invent prices or facts.');
  return lines.join('\n');
}

export function buildCompareSystemAddendum(compare: AiResearchCompareRequest): string {
  return [
    'COMPARE MODE A VS B.',
    `Entity/claim A: ${compare.a}`,
    `Entity/claim B: ${compare.b}`,
    'Research both sides separately from the sources provided. Excerpts tagged [Side A] are only for A, [Side B] only for B, and [Side A and B] for both.',
    'Do not invent prices, figures, dates, or facts. If one side has no evidence in the sources, write "no evidence found in the sources" in that section.',
    'Use these markdown headings exactly, in this order:',
    ...AI_RESEARCH_COMPARE_SECTIONS.map(section => `## ${section}`),
    'In the Sources section, list every URL you used as a markdown link. Do not add sources that are not in the context.',
  ].join('\n');
}

function sourceKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return url.trim().toLowerCase().replace(/\/$/, '');
  }
}

function tagSnippet(snippet: string, side: 'A' | 'B' | 'both'): string {
  const tag = side === 'both' ? '[Side A and B]' : side === 'A' ? '[Side A]' : '[Side B]';
  const body = snippet.replace(/\s+/g, ' ').trim();
  if (body.startsWith('[Side') || body.startsWith('[Sisi')) return body;
  return body ? `${tag} ${body}` : tag;
}

export function mergeCompareResearch(input: {
  aLabel: string;
  bLabel: string;
  aResearch: ResearchContext | null;
  bResearch: ResearchContext | null;
  maxSources?: number;
}): ResearchContext {
  const maxSources = input.maxSources ?? AI_RESEARCH_MAX_SOURCES;
  const tagged: Array<{ source: ResearchSource; side: 'A' | 'B' }> = [
    ...(input.aResearch?.sources || []).slice(0, 8).map(source => ({ source, side: 'A' as const })),
    ...(input.bResearch?.sources || []).slice(0, 8).map(source => ({ source, side: 'B' as const })),
  ];
  const merged = new Map<string, { source: ResearchSource; sides: Set<'A' | 'B'> }>();
  for (const item of tagged) {
    const key = sourceKey(item.source.url);
    if (!key) continue;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { source: item.source, sides: new Set([item.side]) });
      continue;
    }
    existing.sides.add(item.side);
    if (item.source.snippet.trim().length > existing.source.snippet.trim().length) {
      existing.source = item.source;
    }
  }
  const sources = [...merged.values()].slice(0, maxSources).map(({ source, sides }) => {
    const side = sides.has('A') && sides.has('B') ? 'both' : sides.has('A') ? 'A' : 'B';
    return { ...source, snippet: tagSnippet(source.snippet, side) };
  });
  const label = `Compare A (${input.aLabel}) vs B (${input.bLabel})`;
  return {
    query: label,
    indonesiaPreferred: prefersIndonesiaSources(`${input.aLabel} ${input.bLabel}`),
    sources,
  };
}
