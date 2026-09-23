import {
  parseMarkdown,
  type MarkdownInline,
} from './ai-research-markdown';

export const AI_RESEARCH_KNOWLEDGE_TASK = 'ai-research';
export const KNOWLEDGE_GRAPH_PATH = '/dashboard/knowledge-graph';
export const PINNED_FACT_MIN_CHARS = 8;
export const PINNED_FACT_MAX_CHARS = 4_000;
export const PINNED_BRIEF_MAX_CHARS = 240;
export const PINNED_SOURCE_URL_MAX = 12;

export type PinnableClaim = {
  text: string;
  sourceUrls: string[];
};

export type PreparedResearchPin = {
  taskType: typeof AI_RESEARCH_KNOWLEDGE_TASK;
  brief: string;
  fact: string;
  sourceUrls: string[];
  conversationId: string | null;
  projectId: string | null;
};

export function knowledgeGraphFocusUrl(id: string): string {
  return `${KNOWLEDGE_GRAPH_PATH}?focus=${encodeURIComponent(id)}`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizePinnedFact(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Fakta wajib diisi.');
  const fact = value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (fact.length < PINNED_FACT_MIN_CHARS) throw new Error('Fakta terlalu pendek.');
  if (fact.length > PINNED_FACT_MAX_CHARS) throw new Error('Fakta terlalu panjang.');
  return fact;
}

export function knowledgeBriefFromFact(fact: string): string {
  const brief = collapseWhitespace(fact);
  if (brief.length <= PINNED_BRIEF_MAX_CHARS) return brief;
  return `${brief.slice(0, PINNED_BRIEF_MAX_CHARS - 1).trimEnd()}…`;
}

function isSaveableHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (value.length > 2_048) return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function canonicalSourceUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!isSaveableHttpUrl(trimmed)) return null;
  const url = new URL(trimmed);
  url.hash = '';
  return url.toString();
}

export function normalizePinnedSourceUrls(value: unknown): string[] {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null;
  if (!list) throw new Error('URL sumber tidak valid.');
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') throw new Error('URL sumber tidak valid.');
    const trimmed = item.trim();
    if (!trimmed) continue;
    const canonical = canonicalSourceUrl(trimmed);
    if (!canonical) throw new Error('URL sumber tidak valid.');
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    urls.push(canonical);
    if (urls.length > PINNED_SOURCE_URL_MAX) throw new Error('Terlalu banyak URL sumber.');
  }
  return urls;
}

export function parseStoredSourceUrls(value: unknown): string[] {
  let raw = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      raw = [trimmed];
    }
  }
  if (!Array.isArray(raw)) return [];
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const canonical = canonicalSourceUrl(item);
    if (canonical && !urls.includes(canonical)) urls.push(canonical);
  }
  return urls.slice(0, PINNED_SOURCE_URL_MAX);
}

const RECORD_ID = /^[A-Za-z0-9_-]{8,80}$/;

export function normalizeOptionalRecordId(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !RECORD_ID.test(value.trim())) throw new Error('ID tidak valid.');
  return value.trim();
}

export function prepareResearchKnowledgePin(input: {
  taskType: unknown;
  selectedOutput: unknown;
  sourceUrls?: unknown;
  conversationId?: unknown;
  projectId?: unknown;
}): PreparedResearchPin {
  if (input.taskType !== AI_RESEARCH_KNOWLEDGE_TASK) throw new Error('Jenis knowledge tidak valid.');
  const fact = normalizePinnedFact(input.selectedOutput);
  return {
    taskType: AI_RESEARCH_KNOWLEDGE_TASK,
    brief: knowledgeBriefFromFact(fact),
    fact,
    sourceUrls: normalizePinnedSourceUrls(input.sourceUrls),
    conversationId: normalizeOptionalRecordId(input.conversationId),
    projectId: normalizeOptionalRecordId(input.projectId),
  };
}

function inlineText(nodes: MarkdownInline[]): string {
  return nodes.map(node => {
    if (node.type === 'text' || node.type === 'code') return node.value;
    return inlineText(node.children);
  }).join('');
}

function inlineUrls(nodes: MarkdownInline[]): string[] {
  const urls: string[] = [];
  for (const node of nodes) {
    if (node.type === 'link') urls.push(node.href);
    if (node.type !== 'text' && node.type !== 'code') urls.push(...inlineUrls(node.children));
  }
  return urls;
}

function rawUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s)>\]]+/g) || [];
}

export function extractPinnableClaims(
  markdown: string,
  sources: Array<{ title?: string; url: string }> = [],
): PinnableClaim[] {
  const sourceUrls = sources.flatMap(source => {
    const canonical = canonicalSourceUrl(source.url);
    return canonical ? [canonical] : [];
  });
  const claims: PinnableClaim[] = [];
  const seen = new Set<string>();

  const push = (text: string, urls: string[]) => {
    const fact = collapseWhitespace(text);
    if (fact.length < 24 || fact.length > PINNED_FACT_MAX_CHARS) return;
    const key = fact.toLowerCase();
    if (seen.has(key)) return;
    const attached = normalizeLooseUrls([...urls, ...rawUrls(fact), ...sourceUrls.filter(url => fact.includes(url))]);
    const citesSource = attached.length > 0 || sources.some(source => {
      const title = collapseWhitespace(source.title || '');
      return title.length >= 8 && fact.toLowerCase().includes(title.toLowerCase());
    });
    if (!citesSource) return;
    seen.add(key);
    claims.push({ text: fact, sourceUrls: attached.length ? attached : sourceUrls.slice(0, PINNED_SOURCE_URL_MAX) });
  };

  for (const block of parseMarkdown(markdown)) {
    if (claims.length >= 5) break;
    if (block.type === 'list') {
      for (const item of block.items) {
        push(inlineText(item), inlineUrls(item));
        if (claims.length >= 5) break;
      }
      continue;
    }
    if (block.type === 'paragraph') push(inlineText(block.children), inlineUrls(block.children));
  }
  return claims;
}

function normalizeLooseUrls(values: string[]): string[] {
  const urls: string[] = [];
  for (const value of values) {
    const canonical = canonicalSourceUrl(value.replace(/[.,;]+$/, ''));
    if (canonical && !urls.includes(canonical)) urls.push(canonical);
    if (urls.length >= PINNED_SOURCE_URL_MAX) break;
  }
  return urls;
}
