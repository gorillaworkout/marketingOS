import {
  AI_RESEARCH_MAX_SOURCES,
  prefersIndonesiaSources,
  type ResearchContext,
  type ResearchSource,
} from './ai-research-grounding';

export const AI_RESEARCH_COMPARE_MAX_SIDE = 400;
export const AI_RESEARCH_COMPARE_SECTIONS = [
  'Kesamaan',
  'Perbedaan',
  'Bukti A',
  'Bukti B',
  'Kesimpulan',
  'Sumber',
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
    throw new Error('Perbandingan tidak valid.');
  }
  const raw = value as { a?: unknown; b?: unknown };
  const a = cleanSide(raw.a);
  const b = cleanSide(raw.b);
  if (!a || !b) throw new Error('Isi entitas A dan entitas B untuk membandingkan.');
  return { a, b };
}

export function buildCompareSearchQuery(side: string): string {
  return side.replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function buildCompareUserPrompt(a: string, b: string, focus?: string): string {
  const left = cleanSide(a);
  const right = cleanSide(b);
  const lines = [
    'Bandingkan dua hal berikut secara berimbang.',
    `A: ${left}`,
    `B: ${right}`,
  ];
  const extra = (focus || '').replace(/\s+/g, ' ').trim();
  if (extra && extra !== left && extra !== right) {
    lines.push(`Fokus: ${extra.slice(0, 500)}`);
  }
  lines.push('Gunakan hanya bukti dari sumber yang ditemukan. Jangan mengarang harga atau fakta.');
  return lines.join('\n');
}

export function buildCompareSystemAddendum(compare: AiResearchCompareRequest): string {
  return [
    'MODE PERBANDINGAN A VS B.',
    `Entitas/klaim A: ${compare.a}`,
    `Entitas/klaim B: ${compare.b}`,
    'Riset kedua sisi secara terpisah dari sumber yang diberikan. Cuplikan yang diawali [Sisi A] hanya untuk A, [Sisi B] hanya untuk B, dan [Sisi A dan B] untuk keduanya.',
    'Jangan mengarang harga, angka, tanggal, atau fakta. Jika satu sisi tidak punya bukti di sumber, tulis "bukti tidak ditemukan di sumber" pada bagian itu.',
    'Wajib memakai heading markdown persis ini, berurutan:',
    ...AI_RESEARCH_COMPARE_SECTIONS.map(section => `## ${section}`),
    'Di bagian Sumber, cantumkan setiap URL yang dipakai sebagai tautan markdown. Jangan menambah sumber yang tidak ada di konteks.',
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
  const tag = side === 'both' ? '[Sisi A dan B]' : side === 'A' ? '[Sisi A]' : '[Sisi B]';
  const body = snippet.replace(/\s+/g, ' ').trim();
  if (body.startsWith('[Sisi')) return body;
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
  const label = `Bandingkan A (${input.aLabel}) vs B (${input.bLabel})`;
  return {
    query: label,
    indonesiaPreferred: prefersIndonesiaSources(`${input.aLabel} ${input.bLabel}`),
    sources,
  };
}
