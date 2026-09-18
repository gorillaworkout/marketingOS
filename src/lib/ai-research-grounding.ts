import {
  AI_RESEARCH_IMAGE_ONLY_PROMPT,
  buildGatewayMessages,
  type AiResearchChatMessage,
  type GatewayMessage,
} from './ai-research';

export type ResearchOrigin = 'indonesia' | 'international';

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  origin: ResearchOrigin;
}

export interface ResearchContext {
  query: string;
  sources: ResearchSource[];
  indonesiaPreferred: boolean;
}

export interface GatherResearchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
}

export const AI_RESEARCH_CONTEXT_HEADER = 'GROUNDING_SOURCES';
export const AI_RESEARCH_NO_INVENT_FACTS =
  'Do not invent company, licensing, address, officer, or numeric facts. If a fact is missing from the sources, say the grounded sources do not confirm it. If a retrieved source does state the fact, summarize it with a citation instead of refusing.';
export const AI_RESEARCH_SYNTHESIZE_HITS =
  'Relevant grounded sources were retrieved. Synthesize a rich answer from everything they state (role, institution, other public traces) and cite titles + URLs. Prefer summarizing grounded hits over saying no verified source was found. Only say a fact is unverified when these excerpts truly do not mention it.';

const DEFAULT_TIMEOUT_MS = 16_000;
const DEFAULT_MAX_BYTES = 500_000;
export const AI_RESEARCH_MAX_SOURCES = 10;
const MAX_SOURCES = AI_RESEARCH_MAX_SOURCES;
const MAX_PAGE_FETCHES = 12;
const MAX_SEARCH_QUERIES = 10;
const MAX_SNIPPET = 2_200;
const MAX_URL_LENGTH = 2_048;
const RESEARCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const INDONESIA_HINTS = [
  'indonesia', 'indonesian', 'bappebti', 'ojk', 'rupiah', 'bank indonesia',
  'apa ', 'apakah', 'bagaimana', 'mengapa', 'siapa', 'dimana', 'di mana', 'kapan',
  'tentang', 'perusahaan', 'izin', 'lisensi', 'regulasi', 'terdaftar',
  'yang ', 'untuk ', 'dari ', 'dengan ', 'tidak ', 'sudah ', 'bisa ',
];

const TRIVIAL_QUERIES = new Set([
  'hi', 'hello', 'hai', 'halo', 'hey', 'yo', 'ok', 'okay', 'thanks', 'thank you',
  'terima kasih', 'makasih', 'tes', 'test', 'ping', 'pong',
]);

const INDONESIA_HOST_MARKERS = [
  '.go.id', '.co.id', '.or.id', '.ac.id', '.id',
  'cnbcindonesia.com', 'detik.com', 'kompas.com', 'kontan.co.id',
  'antaranews.com', 'tempo.co', 'liputan6.com', 'bisnis.com',
  'idx.co.id', 'bappebti.go.id', 'ojk.go.id', 'bi.go.id',
  'id.wikipedia.org',
];

const DUPOIN_SEEDS = [
  'https://www.dupoin.co.id/',
  'https://www.dupoin.co.id/about-us/licenses',
  'https://www.dupoin.co.id/about-us',
  'https://www.dupoin.co.id/tentang',
  'https://www.dupoin.com/',
];

const BAPPEBTI_SEEDS = [
  'https://bappebti.go.id/',
  'https://bappebti.go.id/pialang_berjangka',
  'https://bappebti.go.id/pialang_berjangka/detail/423',
  'https://www.bappebti.go.id/',
];

const OJK_SEEDS = [
  'https://www.ojk.go.id/',
];

const OFFICIAL_SEEDS: Array<{ pattern: RegExp; urls: string[] }> = [
  { pattern: /\bdupoin\b/i, urls: DUPOIN_SEEDS },
  { pattern: /\b(bappebti|wakil pialang|pialang berjangka)\b/i, urls: BAPPEBTI_SEEDS },
  { pattern: /\bojk\b/i, urls: OJK_SEEDS },
];

const PREFERRED_OFFICIAL_HOSTS = [
  'bappebti.go.id',
  'ojk.go.id',
  'bi.go.id',
  'dupoin.co.id',
  'dupoin.com',
];

const FACT_NEEDLES = [
  'bappebti', 'ojk', 'licensed', 'regulated', 'perizinan', 'lisensi',
  'izin', 'terdaftar', 'anggota', 'aspebtindo',
  'wakil pialang', 'pialang berjangka', 'pialang', 'pengurus',
];

const QUERY_STOPWORDS = new Set([
  'siapa', 'sih', 'jir', 'di', 'yang', 'untuk', 'dari', 'dengan', 'tidak',
  'sudah', 'bisa', 'apa', 'apakah', 'bagaimana', 'mengapa', 'dimana', 'kapan',
  'tentang', 'halo', 'hai', 'the', 'a', 'an', 'is', 'are', 'who', 'what',
  'and', 'or', 'of', 'in', 'on', 'to', 'pt', 'tbk', 'ini', 'itu', 'kah',
  'dong', 'deh', 'kok', 'ya', 'yah', 'aja', 'nih', 'lah', 'pun', 'juga',
  'saja', 'kalau', 'kalo', 'gimana', 'kenapa', 'mana', 'ada', 'gak', 'nggak',
  'ga', 'ngga', 'gw', 'gue', 'lu', 'loe', 'bro', 'bang', 'kak',
]);

const COMMON_NON_NAME_WORDS = new Set([
  ...QUERY_STOPWORDS,
  'fakta', 'resmi', 'indonesia', 'indonesian', 'perusahaan', 'perizinan',
  'izin', 'lisensi', 'regulasi', 'terdaftar', 'kantor', 'alamat',
  'futures', 'gold', 'emas', 'forex', 'trading', 'market', 'news', 'artikel',
  'konten', 'strategi', 'pialang', 'broker', 'berjangka', 'licenses', 'about',
  'team', 'dupoin', 'bappebti', 'ojk', 'aspebtindo', 'jakarta', 'official',
  'licensed', 'regulated', 'company', 'license', 'director', 'direktur',
  'wakil', 'pengurus', 'karyawan', 'staff', 'tim', 'orang', 'ceo', 'cfo',
  'cto', 'manager', 'analis', 'analyst', 'kyc', 'aml', 'compliance',
  'ceritakan', 'jelaskan', 'sebutkan', 'daftar', 'info', 'informasi',
  'profil', 'profile', 'legal', 'hukum', 'nomor', 'telepon', 'email',
  'berita', 'linkedin',
]);

function normalized(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim();
}

function isNonPublicIpv4(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const octets = host.split('.').map(Number);
  if (octets.some(value => value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0);
}

export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (value.length > MAX_URL_LENGTH) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      return false;
    }
    if (host === 'metadata.google.internal' || host === 'metadata.aws.internal') return false;
    if (isNonPublicIpv4(host)) return false;
    if (host.includes(':')) {
      if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return false;
      if (/^2001:db8:/i.test(host)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function unwrapSearchResultUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const parsed = new URL(candidate);
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) candidate = uddg;
  } catch {
    return null;
  }
  if (!isPublicHttpUrl(candidate)) return null;
  const url = new URL(candidate);
  url.hash = '';
  return url.toString();
}

export function classifySourceOrigin(url: string): ResearchOrigin {
  const host = (() => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
  })();
  if (!host) return 'international';
  const matches = INDONESIA_HOST_MARKERS.some(marker => {
    if (marker.startsWith('.')) return host === marker.slice(1) || host.endsWith(marker);
    return host === marker || host.endsWith(`.${marker}`);
  });
  return matches ? 'indonesia' : 'international';
}

export function prefersIndonesiaSources(text: string): boolean {
  const haystack = normalized(text);
  if (!haystack) return false;
  if (/\b(indonesia|indonesian|bappebti|ojk|rupiah|jakarta)\b/.test(haystack)) return true;
  return INDONESIA_HINTS.some(hint => haystack.includes(hint));
}

export function shouldResearchQuery(text: string): boolean {
  const haystack = normalized(text);
  if (!haystack || haystack === normalized(AI_RESEARCH_IMAGE_ONLY_PROMPT)) return false;
  if (TRIVIAL_QUERIES.has(haystack)) return false;
  if (isDeepPersonResearch(text) || looksLikePersonQuery(text)) return true;
  if (haystack.length < 8 && !/\b(dupoin|bappebti|ojk|broker|forex|emas|gold)\b/.test(haystack)) {
    return false;
  }
  return true;
}

function titleCaseName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function isNameToken(token: string): boolean {
  if (token.length < 3 || token.length > 16) return false;
  if (COMMON_NON_NAME_WORDS.has(token)) return false;
  if (/^\d+$/.test(token)) return false;
  return /^[a-z]{3,16}$/.test(token);
}

export function extractPersonNameCandidates(text: string): string[] {
  const quoted = [...text.matchAll(/"([^"]{3,80})"|'([^']{3,80})'/g)]
    .map(match => (match[1] || match[2] || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(titleCaseName);

  const tokens = normalized(text).split(/[^a-z0-9]+/).filter(Boolean);
  const names: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!isNameToken(tokens[i]) || !isNameToken(tokens[i + 1])) continue;
    const third = tokens[i + 2];
    const raw = third && isNameToken(third)
      ? `${tokens[i]} ${tokens[i + 1]} ${third}`
      : `${tokens[i]} ${tokens[i + 1]}`;
    names.push(titleCaseName(raw));
    i += raw.split(' ').length - 1;
  }
  return [...new Set([...quoted, ...names])];
}

export function looksLikePersonQuery(text: string): boolean {
  if (extractPersonNameCandidates(text).length > 0) return true;
  return /\b(siapa|who is|who's|who are)\b/i.test(text);
}

export function looksLikeBrokerContext(text: string): boolean {
  return /\b(dupoin|broker|pialang|berjangka|bappebti|ojk)\b/i.test(text);
}

export function isDeepPersonResearch(text: string): boolean {
  return looksLikePersonQuery(text) && looksLikeBrokerContext(text);
}

export function buildSearchQueries(text: string): string[] {
  const query = text.replace(/\s+/g, ' ').trim();
  const prioritized = [query];
  const extras: string[] = [];
  const indonesia = prefersIndonesiaSources(query);
  const names = extractPersonNameCandidates(query);
  const deep = isDeepPersonResearch(query);

  for (const name of names.slice(0, 2)) {
    extras.push(`"${name}" Dupoin`);
    extras.push(`"${name}" Bappebti`);
    extras.push(`"${name}" "wakil pialang"`);
    extras.push(`"${name}" site:bappebti.go.id`);
    extras.push(`"${name}" site:dupoin.co.id`);
    extras.push(`"${name}" Dupoin site:linkedin.com`);
    extras.push(`"${name}" Dupoin berita`);
  }

  if (deep) {
    extras.push('wakil pialang Dupoin');
    extras.push('daftar pialang berjangka Dupoin site:bappebti.go.id');
    extras.push('PT Dupoin Futures Indonesia wakil pialang site:bappebti.go.id');
  }

  if (indonesia && !/\bindonesia\b/i.test(query) && !deep) {
    extras.push(`${query} Indonesia`);
  }
  if (/\bdupoin\b/i.test(query)) {
    extras.push('Dupoin Futures Indonesia BAPPEBTI site:dupoin.co.id');
    extras.push('PT Dupoin Futures Indonesia Bappebti site:bappebti.go.id');
  } else if (indonesia && looksLikeEntityQuery(query)) {
    extras.push(`${query} site:.id`);
  }
  return [...new Set([...prioritized, ...extras])].slice(0, MAX_SEARCH_QUERIES);
}

export function buildFallbackSearchQueries(text: string): string[] {
  const names = extractPersonNameCandidates(text);
  const extras: string[] = [
    'wakil pialang Dupoin site:bappebti.go.id',
    'PT Dupoin Futures Indonesia site:bappebti.go.id',
    'daftar wakil pialang berjangka Bappebti',
    'Dupoin Futures Indonesia news OR berita',
  ];
  for (const name of names.slice(0, 2)) {
    extras.unshift(`"${name}" "PT Dupoin Futures Indonesia"`);
    extras.unshift(`"${name}" wakil pialang berjangka`);
    extras.push(`"${name}" site:linkedin.com`);
  }
  if (/\bojk\b/i.test(text)) extras.push('Dupoin site:ojk.go.id');
  const already = new Set(buildSearchQueries(text));
  return extras.filter(query => !already.has(query)).slice(0, 6);
}

function looksLikeEntityQuery(text: string): boolean {
  return /\b(perusahaan|perizinan|izin|lisensi|regulasi|terdaftar|broker|kantor|alamat|pt |tbk)\b/i.test(text);
}

export function officialSeedUrls(text: string): string[] {
  const urls = OFFICIAL_SEEDS.flatMap(seed => seed.pattern.test(text) ? seed.urls : []);
  if (isDeepPersonResearch(text) || /\bdupoin\b/i.test(text)) {
    urls.push(...BAPPEBTI_SEEDS, ...DUPOIN_SEEDS);
  }
  if (/\bojk\b/i.test(text)) urls.push(...OJK_SEEDS);
  return [...new Set(urls)];
}

export function isOfficialResearchHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return PREFERRED_OFFICIAL_HOSTS.some(official => host === official || host.endsWith(`.${official}`));
  } catch {
    return false;
  }
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToPlainText(match[1]).slice(0, 180) : '';
}

function metaContent(html: string, name: string): string {
  const named = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i'));
  return named ? htmlToPlainText(named[1]) : '';
}

export function extractRelevantWindow(text: string, query = ''): string {
  const haystack = text.toLowerCase();
  const nameHit = extractPersonNameCandidates(query)
    .flatMap(name => name.toLowerCase().split(' '))
    .filter(token => token.length > 2)
    .map(token => haystack.indexOf(token))
    .filter(idx => idx >= 0)
    .sort((a, b) => a - b)[0];
  const factHit = FACT_NEEDLES
    .map(needle => haystack.indexOf(needle))
    .filter(idx => idx >= 0)
    .sort((a, b) => a - b)[0];
  const queryHit = normalized(query)
    .split(' ')
    .filter(token => token.length > 3)
    .map(token => haystack.indexOf(token))
    .filter(idx => idx >= 0)
    .sort((a, b) => a - b)[0];
  const best = nameHit ?? factHit ?? queryHit;
  if (best == null || best < 0) return text.slice(0, MAX_SNIPPET);
  const start = Math.max(0, best - 180);
  return text.slice(start, start + MAX_SNIPPET);
}

export function extractPageSnippet(html: string, query = ''): { title: string; snippet: string } {
  const title = htmlTitle(html);
  const meta = metaContent(html, 'description') || metaContent(html, 'og:description');
  const cleaned = html
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ');
  const body = htmlToPlainText(cleaned);
  const window = extractRelevantWindow(body, query);
  const combined = meta && window && !window.toLowerCase().includes(meta.slice(0, 32).toLowerCase())
    ? `${window} ${meta}`
    : window || meta;
  return { title, snippet: combined.replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET) };
}

export function parseDuckDuckGoResults(html: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seen = new Set<string>();
  const linkRe = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html))) {
    const tag = match[0];
    const href = tag.match(/href="([^"]+)"/i)?.[1];
    const titleHtml = tag.replace(/^[\s\S]*?>/, '').replace(/<\/a>$/i, '');
    const url = href ? unwrapSearchResultUrl(decodeHtmlAttr(href)) : null;
    if (!url || isSearchHost(url)) continue;
    const after = html.slice(match.index, match.index + 1800);
    const snippetMatch = after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i)
      || after.match(/class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
    const snippet = snippetMatch ? htmlToPlainText(snippetMatch[1]).slice(0, MAX_SNIPPET) : '';
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ title: htmlToPlainText(titleHtml).slice(0, 180) || url, url, snippet });
  }
  return results.slice(0, 10);
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function isSearchHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')
      || host === 'html.duckduckgo.com' || host === 'lite.duckduckgo.com';
  } catch {
    return true;
  }
}

export function parseWikipediaSearch(payload: unknown): Array<{ title: string; snippet: string }> {
  if (!payload || typeof payload !== 'object') return [];
  const query = (payload as { query?: { search?: unknown } }).query;
  if (!query || !Array.isArray(query.search)) return [];
  return query.search.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { title?: unknown; snippet?: unknown };
    if (typeof row.title !== 'string' || !row.title.trim()) return [];
    return [{
      title: row.title.trim(),
      snippet: typeof row.snippet === 'string' ? htmlToPlainText(row.snippet) : '',
    }];
  }).slice(0, 3);
}

export function parseWikipediaExtract(payload: unknown): { title: string; url: string; snippet: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const pages = (payload as { query?: { pages?: Record<string, unknown> } }).query?.pages;
  if (!pages) return null;
  for (const value of Object.values(pages)) {
    if (!value || typeof value !== 'object') continue;
    const page = value as { title?: unknown; extract?: unknown; missing?: unknown; pageid?: unknown };
    if (page.missing != null || typeof page.title !== 'string') continue;
    const title = page.title.trim();
    const snippet = typeof page.extract === 'string' ? page.extract.replace(/\s+/g, ' ').trim() : '';
    if (!title || !snippet) continue;
    const wikiHost = prefersIndonesiaTitle(title) ? 'id.wikipedia.org' : 'en.wikipedia.org';
    return {
      title,
      url: `https://${wikiHost}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      snippet: snippet.slice(0, MAX_SNIPPET),
    };
  }
  return null;
}

function prefersIndonesiaTitle(title: string): boolean {
  return /\b(indonesia|bappebti|jakarta|rupiah)\b/i.test(title);
}

export function rankResearchSources(
  sources: ResearchSource[],
  indonesiaPreferred: boolean,
  query = '',
  limit = MAX_SOURCES,
): ResearchSource[] {
  const officialHosts = [...PREFERRED_OFFICIAL_HOSTS, ...officialSeedUrls(query).map(url => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  })].filter(Boolean);
  const names = extractPersonNameCandidates(query).map(name => name.toLowerCase());

  const scored = sources.map((source, index) => {
    let score = 0;
    const blob = `${source.title} ${source.snippet} ${source.url}`.toLowerCase();
    try {
      const host = new URL(source.url).hostname.replace(/^www\./, '');
      if (officialHosts.some(official => host === official || host.endsWith(`.${official}`))) score += 50;
      if (host === 'bappebti.go.id' || host.endsWith('.bappebti.go.id')) score += 20;
      if (host === 'ojk.go.id' || host.endsWith('.ojk.go.id')) score += 10;
      if (host.includes('linkedin.com') && names.some(name => blob.includes(name))) score += 15;
    } catch { /* ignore */ }
    if (indonesiaPreferred && source.origin === 'indonesia') score += 20;
    if (names.some(name => blob.includes(name))) score += 30;
    if (/wakil pialang|pialang berjangka/.test(blob)) score += 20;
    if (source.snippet.length > 80) score += 5;
    if (source.snippet.length > 400) score += 4;
    return { source, index, score };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const unique = new Map<string, ResearchSource>();
  for (const row of scored) {
    const key = row.source.url.replace(/\/$/, '');
    if (!unique.has(key)) unique.set(key, row.source);
  }
  return [...unique.values()].slice(0, limit);
}

export function sourcesHaveUsefulHits(context: ResearchContext): boolean {
  return context.sources.some(source => {
    const blob = `${source.title} ${source.snippet} ${source.url}`.toLowerCase();
    return source.snippet.trim().length >= 40
      || /bappebti|wakil pialang|pialang|ojk|dupoin/i.test(blob);
  });
}

export function formatResearchContext(context: ResearchContext): string {
  const lines = [
    AI_RESEARCH_CONTEXT_HEADER,
    `User query: ${context.query}`,
    context.indonesiaPreferred
      ? 'Prefer Indonesia-specific sources for this query.'
      : 'Use the most relevant grounded sources available.',
    AI_RESEARCH_NO_INVENT_FACTS,
  ];
  if (context.sources.length === 0) {
    lines.push('No web sources were retrieved. Do not invent company facts.');
    return lines.join('\n');
  }
  if (sourcesHaveUsefulHits(context)) {
    lines.push(AI_RESEARCH_SYNTHESIZE_HITS);
  }
  context.sources.forEach((source, index) => {
    lines.push('');
    lines.push(`[${index + 1}] ${source.title}`);
    lines.push(`URL: ${source.url}`);
    lines.push(`Origin: ${source.origin}`);
    lines.push(`Excerpt: ${source.snippet}`);
  });
  lines.push('');
  lines.push('Cite sources in the answer using the titles and URLs above.');
  return lines.join('\n');
}

export function injectResearchContext(
  messages: GatewayMessage[],
  context: ResearchContext | null,
): GatewayMessage[] {
  if (!context || context.sources.length === 0) return messages;
  const grounded: GatewayMessage = { role: 'system', content: formatResearchContext(context) };
  if (messages.length === 0) return [grounded];
  return [messages[0], grounded, ...messages.slice(1)];
}

export function buildAiResearchChatMessages(options: {
  systemPrompt: string;
  history: AiResearchChatMessage[];
  incoming: AiResearchChatMessage[];
  maxHistory?: number;
  research: ResearchContext | null;
}): GatewayMessage[] {
  return injectResearchContext(
    buildGatewayMessages(options.systemPrompt, options.history, options.incoming, options.maxHistory),
    options.research,
  );
}

async function fetchBounded(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ url: string; text: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal, cache: 'no-store' });
    const finalUrl = response.url || url;
    if (!isPublicHttpUrl(finalUrl)) throw new Error('Research fetch landed on a blocked host.');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('Research response exceeds the size limit.');
    if (!response.body) {
      const text = await response.text();
      return { url: finalUrl, text: text.slice(0, maxBytes), contentType };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const chunk of chunks) {
      const next = chunk.byteLength + offset > bytes.byteLength
        ? chunk.subarray(0, bytes.byteLength - offset)
        : chunk;
      bytes.set(next, offset);
      offset += next.byteLength;
      if (offset >= bytes.byteLength) break;
    }
    return { url: finalUrl, text: new TextDecoder().decode(bytes), contentType };
  } finally {
    clearTimeout(timer);
  }
}

function remainingMs(deadline: number, now: () => number): number {
  return Math.max(0, deadline - now());
}

async function searchDuckDuckGo(
  query: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResearchSource[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { text } = await fetchBounded(fetchImpl, url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': RESEARCH_USER_AGENT,
    },
    redirect: 'follow',
  }, maxBytes, timeoutMs);
  return parseDuckDuckGoResults(text).map(result => ({
    ...result,
    origin: classifySourceOrigin(result.url),
  }));
}

async function searchWikipedia(
  query: string,
  indonesiaPreferred: boolean,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResearchSource[]> {
  const host = indonesiaPreferred ? 'id.wikipedia.org' : 'en.wikipedia.org';
  const searchUrl = `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3&utf8=1`;
  const { text } = await fetchBounded(fetchImpl, searchUrl, {
    headers: { Accept: 'application/json', 'User-Agent': RESEARCH_USER_AGENT },
    redirect: 'follow',
  }, maxBytes, timeoutMs);
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return []; }
  const hits = parseWikipediaSearch(payload);
  const sources: ResearchSource[] = [];
  for (const hit of hits.slice(0, 2)) {
    const extractUrl = `https://${host}/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(hit.title)}&format=json&utf8=1`;
    try {
      const extracted = await fetchBounded(fetchImpl, extractUrl, {
        headers: { Accept: 'application/json', 'User-Agent': RESEARCH_USER_AGENT },
        redirect: 'follow',
      }, maxBytes, timeoutMs);
      const parsed = parseWikipediaExtract(JSON.parse(extracted.text));
      if (parsed) {
        sources.push({
          title: parsed.title,
          url: `https://${host}/wiki/${encodeURIComponent(parsed.title.replace(/ /g, '_'))}`,
          snippet: parsed.snippet,
          origin: classifySourceOrigin(`https://${host}/`),
        });
        continue;
      }
    } catch {
      // Fall through to the search snippet.
    }
    sources.push({
      title: hit.title,
      url: `https://${host}/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      snippet: hit.snippet.slice(0, MAX_SNIPPET),
      origin: classifySourceOrigin(`https://${host}/`),
    });
  }
  return sources;
}

async function fetchPageSource(
  candidate: { title: string; url: string; snippet: string },
  query: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResearchSource> {
  const origin = classifySourceOrigin(candidate.url);
  try {
    const page = await fetchBounded(fetchImpl, candidate.url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': RESEARCH_USER_AGENT,
      },
      redirect: 'follow',
    }, maxBytes, timeoutMs);
    if (!isPublicHttpUrl(page.url)) {
      return { title: candidate.title, url: candidate.url, snippet: candidate.snippet, origin };
    }
    const extracted = extractPageSnippet(page.text, query);
    const snippet = pickRicherSnippet(extracted.snippet, candidate.snippet, query).slice(0, MAX_SNIPPET);
    return {
      title: extracted.title || candidate.title,
      url: page.url,
      snippet,
      origin: classifySourceOrigin(page.url),
    };
  } catch {
    return { title: candidate.title, url: candidate.url, snippet: candidate.snippet, origin };
  }
}

function pickRicherSnippet(extracted: string, fallback: string, query: string): string {
  const names = extractPersonNameCandidates(query).map(name => name.toLowerCase());
  const extractedHit = names.some(name => extracted.toLowerCase().includes(name));
  const fallbackHit = names.some(name => fallback.toLowerCase().includes(name));
  if (fallbackHit && !extractedHit) return fallback || extracted;
  if (extractedHit && !fallbackHit) return extracted || fallback;
  if (extracted.length > 40) return extracted;
  return fallback || extracted;
}

function uniqueSourceCount(sources: ResearchSource[]): number {
  return new Set(sources.map(source => source.url.replace(/\/$/, ''))).size;
}

function isUsableResearchSource(source: ResearchSource, query: string): boolean {
  const blob = `${source.title} ${source.snippet} ${source.url}`.toLowerCase();
  const names = extractPersonNameCandidates(query).map(name => name.toLowerCase());
  return source.snippet.trim().length >= 40
    || isOfficialResearchHost(source.url)
    || source.url.includes('dupoin')
    || names.some(name => blob.includes(name))
    || /wakil pialang|bappebti|pialang berjangka/.test(blob);
}

export async function gatherAiResearchContext(
  query: string,
  options: GatherResearchOptions = {},
): Promise<ResearchContext> {
  const indonesiaPreferred = prefersIndonesiaSources(query);
  const empty: ResearchContext = { query, sources: [], indonesiaPreferred };
  if (!shouldResearchQuery(query)) return empty;

  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const now = options.now || Date.now;
  const deadline = now() + timeoutMs;
  const names = extractPersonNameCandidates(query);
  const deep = isDeepPersonResearch(query);

  const queries = buildSearchQueries(query);
  const found: ResearchSource[] = officialSeedUrls(query).map(url => ({
    title: url,
    url,
    snippet: '',
    origin: classifySourceOrigin(url),
  }));

  const searchBudget = Math.max(1_500, Math.floor(remainingMs(deadline, now) * 0.5));
  const wikiQuery = names[0] || (deep ? '' : query);
  const searches = await Promise.allSettled([
    ...queries.map(item => searchDuckDuckGo(item, fetchImpl, maxBytes, searchBudget)),
    ...(wikiQuery ? [searchWikipedia(wikiQuery, indonesiaPreferred, fetchImpl, maxBytes, searchBudget)] : []),
  ]);
  let searchHits = 0;
  for (const result of searches) {
    if (result.status === 'fulfilled' && result.value.length) {
      found.push(...result.value);
      searchHits += result.value.length;
    }
  }

  if (searchHits < 3 || uniqueSourceCount(found) < 4) {
    const fallbackQueries = buildFallbackSearchQueries(query);
    const fallbackBudget = Math.max(1_200, Math.floor(remainingMs(deadline, now) * 0.45));
    if (fallbackQueries.length && fallbackBudget > 0) {
      const extras = await Promise.allSettled(
        fallbackQueries.map(item => searchDuckDuckGo(item, fetchImpl, maxBytes, fallbackBudget)),
      );
      for (const result of extras) {
        if (result.status === 'fulfilled') found.push(...result.value);
      }
    }
  }

  const ranked = rankResearchSources(found, indonesiaPreferred, query, MAX_PAGE_FETCHES);
  if (ranked.length === 0) return empty;

  const fetchBudget = Math.max(1_200, remainingMs(deadline, now));
  const fetched = await Promise.all(ranked.map(source => fetchPageSource(source, query, fetchImpl, maxBytes, fetchBudget)));
  const usable = fetched.filter(source => isUsableResearchSource(source, query));
  return {
    query,
    indonesiaPreferred,
    sources: rankResearchSources(usable.length ? usable : fetched, indonesiaPreferred, query),
  };
}
