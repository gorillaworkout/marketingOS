import {
  AI_RESEARCH_IMAGE_ONLY_PROMPT,
  buildGatewayMessages,
  type AiResearchChatMessage,
  type GatewayContentPart,
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

export interface SearchApiKeys {
  serper?: string;
  brave?: string;
  tavily?: string;
}

export interface GatherResearchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
  searchApiKeys?: SearchApiKeys;
  logger?: { warn: (...args: unknown[]) => void };
  enableJinaFallback?: boolean;
}

export const AI_RESEARCH_CONTEXT_HEADER = 'GROUNDING_SOURCES';
export const AI_RESEARCH_NO_INVENT_FACTS =
  'Do not invent company, licensing, address, officer, or numeric facts. If a fact is missing from the sources, say the grounded sources do not confirm it. If a retrieved source does state the fact, summarize it with a citation instead of refusing.';
export const AI_RESEARCH_SYNTHESIZE_HITS =
  'Relevant grounded sources were retrieved. Synthesize a rich answer from everything they state (role, institution, other public traces) and cite titles + URLs. Prefer summarizing grounded hits over saying no verified source was found. Only say a fact is unverified when these excerpts truly do not mention it.';
export const AI_RESEARCH_PERSON_NAME_HIT =
  'The person name from the user query appears in the retrieved excerpts. Treat that as a verified public listing (for example an official broker or Bappebti roster). Synthesize the stated role, institution, and other public traces and cite the titles + URLs. Do not refuse with “no verified public sources” or “belum ada sumber publik terverifikasi” when the name is present. Do not invent a biography beyond what these excerpts state.';
export const AI_RESEARCH_GROUNDED_PERSON_HEADER = 'GROUNDED_PERSON_FACT:';
export const AI_RESEARCH_PERSON_FACT_PREFIX = 'PERSON_FACT:';
export const AI_RESEARCH_GROUNDED_PERSON_MUST_ANSWER =
  'Cite that URL. Do not say unconfirmed / tidak terkonfirmasi. Do not say “belum bisa dipastikan” or “tidak ada sumber terkonfirmasi”. MUST answer from this roster fact. Do not invent a biography beyond the excerpt.';
export const AI_RESEARCH_DEFAULT_TEMPERATURE = 0.7;
export const AI_RESEARCH_PERSON_HIT_TEMPERATURE = 0.25;

export interface GroundedPersonFact {
  name: string;
  section: string | null;
  title: string;
  url: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 500_000;
export const AI_RESEARCH_MAX_SOURCES = 14;
const MAX_SOURCES = AI_RESEARCH_MAX_SOURCES;
const MAX_PAGE_FETCHES = 18;
const MAX_SEARCH_QUERIES = 12;
const OFFICIAL_FETCH_FLOOR = 4;
const MAX_SOURCES_PER_HOST = 2;
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
  'https://bappebti.go.id/pialang_berjangka/detail/423',
  'https://bappebti.go.id/pialang_berjangka_wakil_pialang',
  'https://bappebti.go.id/pialang_berjangka',
  'https://bappebti.go.id/',
  'https://ceklegalitas.bappebti.go.id/',
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

export const AI_RESEARCH_JINA_READER_PREFIX = 'https://r.jina.ai/';
export const DDG_HTML_BLOCKED_WARNING =
  '[ai-research] DuckDuckGo HTML search was blocked (bot challenge / anomaly). Falling back to official seeds, multi-language Wikipedia, Wikidata, Instant Answer, Google News RSS, and Jina-backed page fetch.';
export const SERPER_EXHAUSTED_WARNING =
  '[ai-research] Serper returned no usable hits or was rate-limited. Continuing with free sources only (Wikipedia, Wikidata, Instant Answer, official seeds, news RSS, Jina). Brave is not required.';
const MAX_JINA_FETCHES = 12;
const LOGIN_WALL_HOSTS = ['instagram.com', 'threads.net'];
const LOGIN_WALL_MARKERS = [
  'log in to instagram',
  'log into instagram',
  'see photos and videos from',
  'log in to facebook',
  'log into facebook',
  'log in to continue',
  'sign in to continue',
  'you must log in',
  'please log in to view',
  'please sign in to view',
  'create an account or log in',
  'create new account',
  'sign up to see',
  "this content isn't available right now",
  'this content is not available',
];

const FACT_NEEDLES = [
  'bappebti', 'ojk', 'licensed', 'regulated', 'perizinan', 'lisensi',
  'izin', 'terdaftar', 'anggota', 'aspebtindo',
  'wakil pialang', 'pialang berjangka', 'pialang', 'pengurus',
];

const ROLE_HEADING_NEEDLES: Array<{ needle: string; weight: number }> = [
  { needle: 'wakil pialang', weight: 100 },
  { needle: 'daftar wakil', weight: 80 },
  { needle: 'pialang berjangka', weight: 70 },
  { needle: 'pengurus', weight: 50 },
  { needle: 'pialang', weight: 30 },
];

const ROLE_SNIPPET_RE = /wakil pialang|daftar wakil|pialang berjangka|\bpialang\b|pengurus/;
const NAME_WINDOW_LOOKBACK = 800;
const ROLE_WINDOW_LOOKBACK = 16;
const ROLE_WINDOW_SIZE = 360;

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
    extras.push(`"${name}"`);
    extras.push(`"${name}" Dupoin`);
    extras.push(`"${name}" Bappebti`);
    extras.push(`"${name}" "wakil pialang"`);
    extras.push(`"${name}" berita OR news OR linkedin`);
    extras.push(`"${name}" site:linkedin.com`);
    extras.push(`"${name}" site:bappebti.go.id`);
    extras.push(`"${name}" site:dupoin.co.id`);
  }

  if (deep) {
    extras.push('wakil pialang Dupoin');
    extras.push('daftar pialang berjangka Dupoin site:bappebti.go.id');
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

export function buildOpenWebSearchQueries(text: string): string[] {
  const query = text.replace(/\s+/g, ' ').trim();
  const names = extractPersonNameCandidates(query);
  const extras = [query];
  for (const name of names.slice(0, 2)) {
    extras.push(`"${name}"`);
    extras.push(`"${name}" Dupoin OR Bappebti OR "wakil pialang"`);
    extras.push(`"${name}" news OR berita OR linkedin`);
  }
  if (!names.length) {
    extras.push(`${query} news OR berita`);
    if (prefersIndonesiaSources(query) && !/\bindonesia\b/i.test(query)) {
      extras.push(`${query} Indonesia`);
    }
  }
  return [...new Set(extras.filter(Boolean))].slice(0, 5);
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

function findAllIndexes(haystack: string, needle: string): number[] {
  const hits: number[] = [];
  if (!needle) return hits;
  let from = 0;
  while (from < haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    hits.push(idx);
    from = idx + Math.max(1, needle.length);
  }
  return hits;
}

function findPersonNameIndex(haystack: string, query: string): number {
  const names = extractPersonNameCandidates(query).map(name => name.toLowerCase());
  for (const name of names) {
    const idx = haystack.indexOf(name);
    if (idx >= 0) return idx;
  }
  const tokenHits = names
    .flatMap(name => name.split(' '))
    .filter(token => token.length > 2)
    .map(token => haystack.indexOf(token))
    .filter(idx => idx >= 0)
    .sort((a, b) => a - b);
  return tokenHits[0] ?? -1;
}

function findNearestRoleHeading(haystack: string, nameIdx: number): { index: number; needle: string } | null {
  let best: { index: number; needle: string; score: number } | null = null;
  for (const { needle, weight } of ROLE_HEADING_NEEDLES) {
    for (const idx of findAllIndexes(haystack, needle)) {
      const before = nameIdx < 0 || idx <= nameIdx;
      const distance = nameIdx < 0 ? idx : Math.abs(nameIdx - idx);
      const score = (before ? 50_000 : 0) + weight * 1_000 - Math.min(distance, 200_000) / 100;
      if (!best || score > best.score) best = { index: idx, needle, score };
    }
  }
  return best;
}

function sliceRange(textLength: number, center: number, lookback: number, size: number): { start: number; end: number } {
  const start = Math.max(0, center - lookback);
  return { start, end: Math.min(textLength, start + size) };
}

function mergeTextRanges(text: string, ranges: Array<{ start: number; end: number }>, maxLen: number): string {
  const sorted = [...ranges]
    .filter(range => range.end > range.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  if (!sorted.length) return '';

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 40) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const spanStart = merged[0].start;
  const spanEnd = merged[merged.length - 1].end;
  if (spanEnd - spanStart <= maxLen) {
    return text.slice(spanStart, spanEnd);
  }

  const parts: string[] = [];
  let used = 0;
  const sep = ' […] ';
  for (const range of merged) {
    const extra = parts.length ? sep.length : 0;
    const remaining = maxLen - used - extra;
    if (remaining <= 20) break;
    const chunk = text.slice(range.start, range.end).slice(0, remaining);
    parts.push(chunk);
    used += extra + chunk.length;
  }
  return parts.join(sep);
}

export function extractRelevantWindow(text: string, query = ''): string {
  const haystack = text.toLowerCase();
  const names = extractPersonNameCandidates(query);
  const nameIdx = names.length ? findPersonNameIndex(haystack, query) : -1;

  if (names.length && nameIdx >= 0) {
    const role = findNearestRoleHeading(haystack, nameIdx);
    const nameRange = sliceRange(text.length, nameIdx, NAME_WINDOW_LOOKBACK, MAX_SNIPPET);
    if (!role) return text.slice(nameRange.start, nameRange.end);
    const roleInNameWindow = role.index >= nameRange.start && role.index < nameRange.end;
    const ranges = roleInNameWindow
      ? [nameRange]
      : [sliceRange(text.length, role.index, ROLE_WINDOW_LOOKBACK, ROLE_WINDOW_SIZE), nameRange];
    const label = `[Section: ${titleCaseName(role.needle)}] `;
    const merged = `${label}${mergeTextRanges(text, ranges, MAX_SNIPPET - label.length)}`;
    return trimPersonRosterNoise(merged).slice(0, MAX_SNIPPET);
  }

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
  const best = factHit ?? queryHit;
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
    if (!acceptCandidateUrl(url)) continue;
    const after = html.slice(match.index, match.index + 1800);
    const snippetMatch = after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i)
      || after.match(/class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
    const snippet = snippetMatch ? htmlToPlainText(snippetMatch[1]).slice(0, MAX_SNIPPET) : '';
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ title: htmlToPlainText(titleHtml).slice(0, 180) || url, url, snippet });
  }
  return results.slice(0, 12);
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
      || host === 'html.duckduckgo.com' || host === 'lite.duckduckgo.com'
      || host === 'google.com' || host.endsWith('.google.com')
      || host === 'bing.com' || host.endsWith('.bing.com')
      || host === 'serper.dev' || host.endsWith('.serper.dev')
      || host === 'tavily.com' || host.endsWith('.tavily.com')
      || host === 'brave.com' || host.endsWith('.brave.com')
      || host === 'jina.ai' || host.endsWith('.jina.ai');
  } catch {
    return true;
  }
}

export function isLikelyLoginWallHost(url: string): boolean {
  const host = researchSourceHost(url);
  if (!host) return false;
  return LOGIN_WALL_HOSTS.some(marker => host === marker || host.endsWith(`.${marker}`));
}

export function isEmptyOrLoginWallSource(text: string, url = '', title = ''): boolean {
  if (url && isLikelyLoginWallHost(url)) return true;
  const looksHtml = /<[^>]+>/.test(text);
  const plain = (looksHtml ? htmlToPlainText(text) : text).replace(/\s+/g, ' ').trim();
  const blob = `${title} ${plain}`.toLowerCase();
  if (LOGIN_WALL_MARKERS.some(marker => blob.includes(marker))) {
    const withoutChrome = plain.replace(/log in|sign up|sign in|cookie|privacy|terms|instagram|facebook/gi, '').trim();
    return withoutChrome.length < 400;
  }
  return false;
}

function acceptCandidateUrl(url: string | null): url is string {
  return Boolean(url && isPublicHttpUrl(url) && !isSearchHost(url) && !isLikelyLoginWallHost(url));
}

export function resolveSearchApiKeys(overrides?: SearchApiKeys): Required<SearchApiKeys> {
  return {
    serper: (overrides?.serper ?? process.env.SERPER_API_KEY ?? '').trim(),
    brave: (overrides?.brave ?? process.env.BRAVE_SEARCH_API_KEY ?? '').trim(),
    tavily: (overrides?.tavily ?? process.env.TAVILY_API_KEY ?? '').trim(),
  };
}

export function isDuckDuckGoAnomalyPage(html: string): boolean {
  if (!html) return false;
  const haystack = html.toLowerCase();
  if (/\banomaly\.js\b/.test(haystack)) return true;
  if (/\bcc=botnet\b/.test(haystack)) return true;
  if (/content=["']botnet["']/.test(haystack)) return true;
  if (/bots have been using this resource/.test(haystack)) return true;
  if (/\banomaly-modal\b|\bbot.?challenge\b/.test(haystack) && !/class="[^"]*result__a/.test(html)) {
    return true;
  }
  return false;
}

export function jinaReaderUrl(target: string): string | null {
  if (!isPublicHttpUrl(target)) return null;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'r.jina.ai' || host === 'jina.ai' || host.endsWith('.jina.ai')) return null;
  const canonical = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  if (!isPublicHttpUrl(canonical)) return null;
  return `${AI_RESEARCH_JINA_READER_PREFIX}${canonical}`;
}

export function parseWikipediaOpensearch(payload: unknown): Array<{ title: string; snippet: string; url: string }> {
  if (!Array.isArray(payload) || payload.length < 4) return [];
  const titles = payload[1];
  const snippets = payload[2];
  const urls = payload[3];
  if (!Array.isArray(titles) || !Array.isArray(urls)) return [];
  const results: Array<{ title: string; snippet: string; url: string }> = [];
  for (let i = 0; i < titles.length && results.length < 3; i++) {
    const title = typeof titles[i] === 'string' ? titles[i].trim() : '';
    const url = typeof urls[i] === 'string' ? unwrapSearchResultUrl(urls[i]) : null;
    if (!title || !acceptCandidateUrl(url)) continue;
    results.push({
      title,
      url,
      snippet: typeof snippets?.[i] === 'string' ? htmlToPlainText(snippets[i]) : '',
    });
  }
  return results;
}

function collectInstantAnswerTopics(items: unknown, sink: ResearchSource[]): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const node = item as { FirstURL?: unknown; Text?: unknown; Topics?: unknown };
    if (Array.isArray(node.Topics)) collectInstantAnswerTopics(node.Topics, sink);
    const url = typeof node.FirstURL === 'string' ? unwrapSearchResultUrl(node.FirstURL) : null;
    const text = typeof node.Text === 'string' ? htmlToPlainText(node.Text) : '';
    if (!acceptCandidateUrl(url) || sink.some(source => source.url === url)) continue;
    sink.push({
      title: (text.split(' - ')[0] || url).slice(0, 180),
      url,
      snippet: text.slice(0, MAX_SNIPPET),
      origin: classifySourceOrigin(url),
    });
  }
}

export function parseDuckDuckGoInstantAnswer(payload: unknown): ResearchSource[] {
  if (!payload || typeof payload !== 'object') return [];
  const row = payload as Record<string, unknown>;
  const sources: ResearchSource[] = [];
  const heading = typeof row.Heading === 'string' ? row.Heading.trim() : '';
  const abstract = typeof row.AbstractText === 'string' && row.AbstractText.trim()
    ? row.AbstractText.trim()
    : typeof row.Abstract === 'string' ? row.Abstract.trim() : '';
  const abstractUrl = typeof row.AbstractURL === 'string' ? unwrapSearchResultUrl(row.AbstractURL) : null;
  if (acceptCandidateUrl(abstractUrl) && (abstract || heading)) {
    sources.push({
      title: heading || abstractUrl,
      url: abstractUrl,
      snippet: (abstract || heading).slice(0, MAX_SNIPPET),
      origin: classifySourceOrigin(abstractUrl),
    });
  }
  collectInstantAnswerTopics(row.Results, sources);
  collectInstantAnswerTopics(row.RelatedTopics, sources);
  return sources.slice(0, 8);
}

function parseSearchApiList(
  items: unknown[],
  urlKeys: string[],
  titleKeys: string[],
  snippetKeys: string[],
): ResearchSource[] {
  const sources: ResearchSource[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const rawUrl = urlKeys.map(key => row[key]).find(value => typeof value === 'string') as string | undefined;
    const url = rawUrl ? unwrapSearchResultUrl(rawUrl) : null;
    if (!acceptCandidateUrl(url)) continue;
    const title = (titleKeys.map(key => row[key]).find(value => typeof value === 'string') as string | undefined)?.trim() || url;
    const snippet = (snippetKeys.map(key => row[key]).find(value => typeof value === 'string') as string | undefined) || '';
    sources.push({
      title: title.slice(0, 180),
      url,
      snippet: htmlToPlainText(snippet).slice(0, MAX_SNIPPET),
      origin: classifySourceOrigin(url),
    });
  }
  return sources;
}

export function parseSerperResults(payload: unknown): ResearchSource[] {
  if (!payload || typeof payload !== 'object') return [];
  const row = payload as Record<string, unknown>;
  const sources: ResearchSource[] = [];
  if (Array.isArray(row.organic)) {
    sources.push(...parseSearchApiList(row.organic, ['link', 'url'], ['title'], ['snippet', 'description']));
  }
  if (Array.isArray(row.news)) {
    sources.push(...parseSearchApiList(row.news, ['link', 'url'], ['title'], ['snippet', 'description']));
  }
  if (Array.isArray(row.topStories)) {
    sources.push(...parseSearchApiList(row.topStories, ['link', 'url'], ['title'], ['snippet', 'description']));
  }
  const graph = row.knowledgeGraph;
  if (graph && typeof graph === 'object') {
    const kg = graph as Record<string, unknown>;
    const title = typeof kg.title === 'string' ? kg.title.trim() : '';
    const snippet = typeof kg.description === 'string' ? htmlToPlainText(kg.description) : '';
    const urls = [kg.website, kg.descriptionLink]
      .map(value => typeof value === 'string' ? unwrapSearchResultUrl(value) : null)
      .filter(acceptCandidateUrl);
    for (const url of urls) {
      sources.push({
        title: (title || url).slice(0, 180),
        url,
        snippet: snippet.slice(0, MAX_SNIPPET),
        origin: classifySourceOrigin(url),
      });
    }
  }
  const unique = new Map<string, ResearchSource>();
  for (const source of sources) {
    const key = source.url.replace(/\/$/, '');
    if (!unique.has(key)) unique.set(key, source);
  }
  return [...unique.values()].slice(0, 16);
}

export function parseBraveResults(payload: unknown): ResearchSource[] {
  if (!payload || typeof payload !== 'object') return [];
  const results = (payload as { web?: { results?: unknown } }).web?.results;
  return Array.isArray(results)
    ? parseSearchApiList(results, ['url'], ['title'], ['description', 'snippet']).slice(0, 12)
    : [];
}

export function parseTavilyResults(payload: unknown): ResearchSource[] {
  if (!payload || typeof payload !== 'object') return [];
  const results = (payload as { results?: unknown }).results;
  return Array.isArray(results)
    ? parseSearchApiList(results, ['url'], ['title'], ['content', 'snippet']).slice(0, 12)
    : [];
}

export function extractFetchedContent(text: string, query = '', contentType = ''): { title: string; snippet: string } {
  const titleLine = text.match(/^\s*Title:\s*(.+)$/m)?.[1]?.trim() || '';
  const looksHtml = /html/i.test(contentType)
    || /<html[\s>]/i.test(text.slice(0, 2500))
    || /<title[\s>]/i.test(text.slice(0, 4000));
  if (looksHtml) {
    const extracted = extractPageSnippet(text, query);
    return { title: extracted.title || titleLine, snippet: extracted.snippet };
  }
  const stripped = text
    .replace(/^\s*Title:\s*.+$/m, ' ')
    .replace(/^\s*URL Source:\s*.+$/m, ' ')
    .replace(/^\s*Published Time:\s*.+$/m, ' ')
    .replace(/^\s*Markdown Content:\s*/m, ' ')
    .replace(/#{1,6}/g, ' ');
  const snippet = extractRelevantWindow(htmlToPlainText(stripped), query).slice(0, MAX_SNIPPET);
  return { title: titleLine, snippet };
}

export function wikipediaSearchHosts(indonesiaPreferred: boolean): string[] {
  return indonesiaPreferred
    ? ['id.wikipedia.org', 'en.wikipedia.org']
    : ['en.wikipedia.org', 'id.wikipedia.org'];
}

export function buildWikipediaQueries(text: string): string[] {
  const names = extractPersonNameCandidates(text);
  const queries: string[] = [];
  if (names[0]) queries.push(names[0]);
  if (/\bdupoin\b/i.test(text) || isDeepPersonResearch(text)) {
    queries.push('Dupoin Futures Indonesia');
  }
  if (/\b(bappebti|pialang|dupoin)\b/i.test(text) || isDeepPersonResearch(text)) {
    queries.push('Bappebti');
  }
  if (!queries.length && shouldResearchQuery(text)) {
    queries.push(text.replace(/\s+/g, ' ').trim());
  }
  return [...new Set(queries)].slice(0, 3);
}

export function buildNewsRssQueries(text: string): string[] {
  const names = extractPersonNameCandidates(text);
  const extras: string[] = [];
  if (names[0]) extras.push(`"${names[0]}" Dupoin OR Bappebti`);
  if (/\bdupoin\b/i.test(text) || isDeepPersonResearch(text)) {
    extras.push('Dupoin Futures Indonesia');
  }
  if (!extras.length) extras.push(text.replace(/\s+/g, ' ').trim());
  return [...new Set(extras.filter(Boolean))].slice(0, 2);
}

export function parseWikidataSearch(payload: unknown): Array<{ id: string; title: string; snippet: string; url: string }> {
  if (!payload || typeof payload !== 'object') return [];
  const search = (payload as { search?: unknown }).search;
  if (!Array.isArray(search)) return [];
  return search.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { id?: unknown; label?: unknown; description?: unknown; concepturi?: unknown };
    if (typeof row.id !== 'string' || !/^Q\d+$/i.test(row.id)) return [];
    const title = typeof row.label === 'string' && row.label.trim() ? row.label.trim() : row.id;
    const snippet = typeof row.description === 'string' ? htmlToPlainText(row.description) : '';
    const rawUrl = typeof row.concepturi === 'string' ? row.concepturi : `https://www.wikidata.org/wiki/${row.id}`;
    const url = unwrapSearchResultUrl(rawUrl);
    if (!acceptCandidateUrl(url)) return [];
    return [{ id: row.id, title, snippet, url }];
  }).slice(0, 5);
}

export function parseWikidataEntities(payload: unknown): ResearchSource[] {
  if (!payload || typeof payload !== 'object') return [];
  const entities = (payload as { entities?: Record<string, unknown> }).entities;
  if (!entities) return [];
  const sources: ResearchSource[] = [];
  for (const value of Object.values(entities)) {
    if (!value || typeof value !== 'object') continue;
    const entity = value as {
      id?: unknown;
      labels?: Record<string, { value?: string }>;
      descriptions?: Record<string, { value?: string }>;
      sitelinks?: Record<string, { title?: string }>;
    };
    const id = typeof entity.id === 'string' ? entity.id : '';
    const title = entity.labels?.id?.value || entity.labels?.en?.value || id;
    const snippet = entity.descriptions?.id?.value || entity.descriptions?.en?.value || '';
    if (id && /^Q\d+$/i.test(id)) {
      const url = `https://www.wikidata.org/wiki/${id}`;
      if (acceptCandidateUrl(url)) {
        sources.push({
          title: (title || id).slice(0, 180),
          url,
          snippet: htmlToPlainText(snippet).slice(0, MAX_SNIPPET),
          origin: classifySourceOrigin(url),
        });
      }
    }
    const sitelinks = entity.sitelinks || {};
    const wikiSites: Array<[string, string]> = [
      ['idwiki', 'id.wikipedia.org'],
      ['enwiki', 'en.wikipedia.org'],
    ];
    for (const [site, host] of wikiSites) {
      const pageTitle = sitelinks[site]?.title?.trim();
      if (!pageTitle) continue;
      const url = `https://${host}/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
      if (!acceptCandidateUrl(url)) continue;
      sources.push({
        title: pageTitle.slice(0, 180),
        url,
        snippet: htmlToPlainText(snippet || pageTitle).slice(0, MAX_SNIPPET),
        origin: classifySourceOrigin(url),
      });
    }
  }
  return sources.slice(0, 8);
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNewsRss(xml: string): Array<{ title: string; url: string; snippet: string }> {
  if (!xml || !/<item\b/i.test(xml)) return [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const title = decodeXmlText(item.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1] || '');
    const link = decodeXmlText(item.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i)?.[1] || '');
    const sourceUrl = item.match(/<source\b[^>]*url=["']([^"']+)["'][^>]*>/i)?.[1] || '';
    const snippet = decodeXmlText(
      item.match(/<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/i)?.[1] || '',
    );
    const url = unwrapSearchResultUrl(link) || unwrapSearchResultUrl(sourceUrl);
    if (!title || !acceptCandidateUrl(url) || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: title.slice(0, 180),
      url,
      snippet: snippet.slice(0, MAX_SNIPPET),
    });
    if (results.length >= 8) break;
  }
  return results;
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

export function parseWikipediaExtract(payload: unknown, host?: string): { title: string; url: string; snippet: string } | null {
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
    const wikiHost = host || (prefersIndonesiaTitle(title) ? 'id.wikipedia.org' : 'en.wikipedia.org');
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
  phase: 'fetch' | 'final' = 'final',
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
    const snippetLower = source.snippet.toLowerCase();
    if (names.some(name => snippetLower.includes(name)) && ROLE_SNIPPET_RE.test(snippetLower)) {
      score += 40;
    }
    if (/pialang_berjangka\/detail\/|pialang_berjangka_wakil|\/pialang_berjangka(?:\/|$)/i.test(source.url)) {
      score += 35;
    }
    if (isLikelyLoginWallHost(source.url) || isEmptyOrLoginWallSource(source.snippet, source.url, source.title)) {
      score -= 200;
    }
    if (!source.snippet.trim()) {
      if (phase === 'fetch') {
        if (isOfficialResearchHost(source.url)) score += 15;
      } else {
        score -= 80;
      }
    } else if (source.snippet.length < 40) score -= 20;
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

export function researchSourceHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function diversifyResearchSources(
  sources: ResearchSource[],
  limit: number,
  maxPerHost = MAX_SOURCES_PER_HOST,
): ResearchSource[] {
  const counts = new Map<string, number>();
  const picked: ResearchSource[] = [];
  const overflow: ResearchSource[] = [];
  for (const source of sources) {
    const host = researchSourceHost(source.url) || source.url;
    const used = counts.get(host) || 0;
    if (used < maxPerHost) {
      picked.push(source);
      counts.set(host, used + 1);
      if (picked.length >= limit) return picked;
    } else {
      overflow.push(source);
    }
  }
  for (const source of overflow) {
    if (picked.length >= limit) break;
    picked.push(source);
  }
  return picked;
}

export function selectFetchCandidates(
  sources: ResearchSource[],
  query: string,
  indonesiaPreferred: boolean,
  limit = MAX_PAGE_FETCHES,
): ResearchSource[] {
  const ranked = rankResearchSources(sources, indonesiaPreferred, query, sources.length, 'fetch');
  const official = ranked.filter(source => isOfficialResearchHost(source.url));
  const web = ranked.filter(source => !isOfficialResearchHost(source.url));
  const floorLimit = Math.min(OFFICIAL_FETCH_FLOOR, limit);
  const floor = diversifyResearchSources(official, floorLimit, MAX_SOURCES_PER_HOST);
  const remaining = Math.max(0, limit - floor.length);
  const webPicked = diversifyResearchSources(web, remaining, MAX_SOURCES_PER_HOST);
  const combined = [...floor, ...webPicked];
  if (combined.length < limit) {
    const seen = new Set(combined.map(source => source.url.replace(/\/$/, '')));
    for (const source of ranked) {
      if (combined.length >= limit) break;
      const key = source.url.replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(source);
    }
  }
  return combined.slice(0, limit);
}

export function sourcesMentionPersonName(context: ResearchContext): boolean {
  const names = extractPersonNameCandidates(context.query).map(name => name.toLowerCase());
  if (!names.length) return false;
  return context.sources.some(source => {
    const blob = `${source.title} ${source.snippet}`.toLowerCase();
    return names.some(name => blob.includes(name));
  });
}

const SECTION_LABEL_RE = /\[Section:\s*([^\]]+)\]/i;
const REKENING_NOISE_PATTERNS = [
  /nomor\s+rekening(?:\s+bank)?(?:\s+penampung)?(?:\s+dana)?(?:\s+nasabah)?(?:\s+dan)?/gi,
  /\brekening(?:\s+penampung)?/gi,
  /\b(?:bca|mandiri|bni|bri|btn)\s+\d{6,}\b/gi,
  /\b(?:bca|mandiri|bni|bri|btn)\b/gi,
  /\b\d{8,}\b/g,
];

export function trimPersonRosterNoise(text: string): string {
  let cleaned = text;
  for (const pattern of REKENING_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

function shouldTrimRosterNoise(query: string, snippet: string): boolean {
  const names = extractPersonNameCandidates(query);
  if (!names.length) return false;
  const lower = snippet.toLowerCase();
  const hasName = names.some(name => lower.includes(name.toLowerCase()));
  return hasName && (SECTION_LABEL_RE.test(snippet) || ROLE_SNIPPET_RE.test(lower));
}

function snippetSectionLabel(snippet: string): string | null {
  const labeled = snippet.match(SECTION_LABEL_RE)?.[1]?.replace(/\s+/g, ' ').trim();
  if (labeled) return labeled;
  const lower = snippet.toLowerCase();
  const role = ROLE_HEADING_NEEDLES.find(item => lower.includes(item.needle));
  return role ? titleCaseName(role.needle) : null;
}

function scorePersonFact(fact: GroundedPersonFact): number {
  let score = 0;
  if (fact.section) score += 40;
  if (/wakil pialang/i.test(fact.section || '')) score += 40;
  try {
    const host = new URL(fact.url).hostname.replace(/^www\./, '');
    if (host === 'bappebti.go.id' || host.endsWith('.bappebti.go.id')) score += 30;
    if (PREFERRED_OFFICIAL_HOSTS.some(official => host === official || host.endsWith(`.${official}`))) {
      score += 10;
    }
  } catch { /* ignore */ }
  return score;
}

export function extractGroundedPersonFacts(context: ResearchContext): GroundedPersonFact[] {
  const names = extractPersonNameCandidates(context.query);
  if (!names.length) return [];
  const facts: GroundedPersonFact[] = [];
  const seen = new Set<string>();
  for (const source of context.sources) {
    const blob = `${source.title} ${source.snippet}`;
    const lower = blob.toLowerCase();
    for (const name of names) {
      if (!lower.includes(name.toLowerCase())) continue;
      const key = `${name.toLowerCase()}|${source.url.replace(/\/$/, '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        name,
        section: snippetSectionLabel(source.snippet),
        title: source.title,
        url: source.url,
      });
    }
  }
  facts.sort((a, b) => scorePersonFact(b) - scorePersonFact(a));
  return facts;
}

export function formatGroundedPersonFactLine(fact: GroundedPersonFact): string {
  const section = fact.section || 'listed in excerpt';
  return `${AI_RESEARCH_PERSON_FACT_PREFIX} ${fact.name} | ${section} | ${fact.url}`;
}

export function formatGroundedPersonInstruction(facts: GroundedPersonFact[]): string | null {
  if (!facts.length) return null;
  return [
    AI_RESEARCH_GROUNDED_PERSON_HEADER,
    AI_RESEARCH_GROUNDED_PERSON_MUST_ANSWER,
    '',
    ...facts.slice(0, 6).map(formatGroundedPersonFactLine),
  ].join('\n');
}

function lastUserMessageIndex(messages: GatewayMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

function attachInstructionToContent(
  content: string | GatewayContentPart[],
  instruction: string,
): string | GatewayContentPart[] {
  const suffix = `\n\n${instruction}`;
  if (typeof content === 'string') return `${content}${suffix}`;
  return [...content, { type: 'text', text: suffix }];
}

export function injectGroundedPersonInstruction(
  messages: GatewayMessage[],
  context: ResearchContext,
): GatewayMessage[] {
  const instruction = formatGroundedPersonInstruction(extractGroundedPersonFacts(context));
  if (!instruction) return messages;
  const factMessage: GatewayMessage = { role: 'system', content: instruction };
  const lastUser = lastUserMessageIndex(messages);
  if (lastUser < 0) return [...messages, factMessage];
  const user = messages[lastUser];
  return [
    ...messages.slice(0, lastUser),
    factMessage,
    { ...user, content: attachInstructionToContent(user.content, instruction) },
    ...messages.slice(lastUser + 1),
  ];
}

export function resolveAiResearchTemperature(research: ResearchContext | null): number {
  if (research && sourcesMentionPersonName(research)) return AI_RESEARCH_PERSON_HIT_TEMPERATURE;
  return AI_RESEARCH_DEFAULT_TEMPERATURE;
}

export function sourcesHaveUsefulHits(context: ResearchContext): boolean {
  const names = extractPersonNameCandidates(context.query).map(name => name.toLowerCase());
  return context.sources.some(source => {
    if (isLikelyLoginWallHost(source.url) || isEmptyOrLoginWallSource(source.snippet, source.url, source.title)) {
      return false;
    }
    const blob = `${source.title} ${source.snippet} ${source.url}`.toLowerCase();
    return source.snippet.trim().length >= 40
      || names.some(name => blob.includes(name))
      || /bappebti|wakil pialang|pialang|ojk|dupoin/i.test(blob);
  });
}

export function formatResearchContext(context: ResearchContext): string {
  const personInstruction = formatGroundedPersonInstruction(extractGroundedPersonFacts(context));
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
  if (personInstruction) {
    lines.push(personInstruction);
  }
  if (sourcesHaveUsefulHits(context)) {
    lines.push(AI_RESEARCH_SYNTHESIZE_HITS);
  }
  if (sourcesMentionPersonName(context)) {
    lines.push(AI_RESEARCH_PERSON_NAME_HIT);
  }
  context.sources.forEach((source, index) => {
    lines.push('');
    lines.push(`[${index + 1}] ${source.title}`);
    lines.push(`URL: ${source.url}`);
    lines.push(`Origin: ${source.origin}`);
    const excerpt = shouldTrimRosterNoise(context.query, source.snippet)
      ? trimPersonRosterNoise(source.snippet)
      : source.snippet;
    lines.push(`Excerpt: ${excerpt}`);
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
  const next = messages.length === 0 ? [grounded] : [messages[0], grounded, ...messages.slice(1)];
  return injectGroundedPersonInstruction(next, context);
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
): Promise<{ url: string; text: string; contentType: string; status: number }> {
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
      return { url: finalUrl, text: text.slice(0, maxBytes), contentType, status: response.status };
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
    return { url: finalUrl, text: new TextDecoder().decode(bytes), contentType, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

function remainingMs(deadline: number, now: () => number): number {
  return Math.max(0, deadline - now());
}

type HtmlSearchResult = { sources: ResearchSource[]; blocked: boolean };

function jsonPayload(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

async function searchDuckDuckGoHtml(
  query: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<HtmlSearchResult> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const { text, status } = await fetchBounded(fetchImpl, url, {
      headers: {
        Accept: 'text/html',
        'User-Agent': RESEARCH_USER_AGENT,
      },
      redirect: 'follow',
    }, maxBytes, timeoutMs);
    if (status === 202 || status === 403 || isDuckDuckGoAnomalyPage(text)) {
      return { sources: [], blocked: true };
    }
    const parsed = parseDuckDuckGoResults(text);
    if (parsed.length === 0 && isDuckDuckGoAnomalyPage(text)) {
      return { sources: [], blocked: true };
    }
    return {
      sources: parsed.map(result => ({ ...result, origin: classifySourceOrigin(result.url) })),
      blocked: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP 202|HTTP 400|HTTP 403|HTTP 429/.test(message)) {
      return { sources: [], blocked: true };
    }
    return { sources: [], blocked: false };
  }
}

async function searchDuckDuckGoInstantAnswer(
  query: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResearchSource[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=marketingos`;
  try {
    const { text } = await fetchBounded(fetchImpl, url, {
      headers: { Accept: 'application/json', 'User-Agent': RESEARCH_USER_AGENT },
      redirect: 'follow',
    }, maxBytes, timeoutMs);
    return parseDuckDuckGoInstantAnswer(jsonPayload(text));
  } catch {
    return [];
  }
}

async function wikipediaHitsToSources(
  hits: Array<{ title: string; snippet: string }>,
  host: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResearchSource[]> {
  const sources: ResearchSource[] = [];
  for (const hit of hits.slice(0, 2)) {
    const extractUrl = `https://${host}/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(hit.title)}&format=json&utf8=1`;
    try {
      const extracted = await fetchBounded(fetchImpl, extractUrl, {
        headers: { Accept: 'application/json', 'User-Agent': RESEARCH_USER_AGENT },
        redirect: 'follow',
      }, maxBytes, timeoutMs);
      const parsed = parseWikipediaExtract(jsonPayload(extracted.text), host);
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

async function searchWikipediaOnHost(
  query: string,
  host: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResearchSource[]> {
  try {
    const searchUrl = `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3&utf8=1`;
    const { text } = await fetchBounded(fetchImpl, searchUrl, {
      headers: { Accept: 'application/json', 'User-Agent': RESEARCH_USER_AGENT },
      redirect: 'follow',
    }, maxBytes, timeoutMs);
    let hits = parseWikipediaSearch(jsonPayload(text));
    if (hits.length === 0) {
      const openUrl = `https://${host}/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&namespace=0&format=json`;
      try {
        const opened = await fetchBounded(fetchImpl, openUrl, {
          headers: { Accept: 'application/json', 'User-Agent': RESEARCH_USER_AGENT },
          redirect: 'follow',
        }, maxBytes, timeoutMs);
        hits = parseWikipediaOpensearch(jsonPayload(opened.text)).map(hit => ({
          title: hit.title,
          snippet: hit.snippet,
        }));
      } catch {
        hits = [];
      }
    }
    return wikipediaHitsToSources(hits, host, fetchImpl, maxBytes, timeoutMs);
  } catch {
    return [];
  }
}

async function searchWikipedia(
  query: string,
  indonesiaPreferred: boolean,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResearchSource[]> {
  const hosts = wikipediaSearchHosts(indonesiaPreferred);
  const settled = await Promise.allSettled(
    hosts.map(host => searchWikipediaOnHost(query, host, fetchImpl, maxBytes, timeoutMs)),
  );
  const sources: ResearchSource[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') sources.push(...result.value);
  }
  return sources;
}

type SerperAttempt = { sources: ResearchSource[]; exhausted: boolean };

async function searchSerper(
  query: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<SerperAttempt> {
  try {
    const { text } = await fetchBounded(fetchImpl, 'https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
        'User-Agent': RESEARCH_USER_AGENT,
      },
      body: JSON.stringify({ q: query, num: 12, gl: 'id', hl: 'id' }),
    }, maxBytes, timeoutMs);
    return { sources: parseSerperResults(jsonPayload(text)), exhausted: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      sources: [],
      exhausted: /HTTP 429|HTTP 402|HTTP 403/.test(message),
    };
  }
}

async function searchWikidata(
  query: string,
  indonesiaPreferred: boolean,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResearchSource[]> {
  const language = indonesiaPreferred ? 'id' : 'en';
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=${language}&uselang=${language}&format=json&limit=5&type=item`;
  try {
    const { text } = await fetchBounded(fetchImpl, searchUrl, {
      headers: { Accept: 'application/json', 'User-Agent': RESEARCH_USER_AGENT },
      redirect: 'follow',
    }, maxBytes, timeoutMs);
    const hits = parseWikidataSearch(jsonPayload(text));
    const sources: ResearchSource[] = hits.map(hit => ({
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet.slice(0, MAX_SNIPPET),
      origin: classifySourceOrigin(hit.url),
    }));
    const ids = hits.map(hit => hit.id).slice(0, 3);
    if (!ids.length) return sources;
    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels|descriptions|sitelinks&sitefilter=enwiki|idwiki&languages=en|id&format=json`;
    try {
      const entities = await fetchBounded(fetchImpl, entityUrl, {
        headers: { Accept: 'application/json', 'User-Agent': RESEARCH_USER_AGENT },
        redirect: 'follow',
      }, maxBytes, timeoutMs);
      sources.push(...parseWikidataEntities(jsonPayload(entities.text)));
    } catch {
      // Search hits alone are still usable.
    }
    return sources;
  } catch {
    return [];
  }
}

function googleNewsRssUrl(query: string, indonesiaPreferred: boolean): string {
  const locale = indonesiaPreferred
    ? 'hl=id&gl=ID&ceid=ID:id'
    : 'hl=en-US&gl=US&ceid=US:en';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${locale}`;
}

async function searchNewsRss(
  query: string,
  indonesiaPreferred: boolean,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResearchSource[]> {
  const url = googleNewsRssUrl(query, indonesiaPreferred);
  try {
    const { text } = await fetchBounded(fetchImpl, url, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': RESEARCH_USER_AGENT,
      },
      redirect: 'follow',
    }, maxBytes, timeoutMs);
    return parseNewsRss(text).map(result => ({
      ...result,
      origin: classifySourceOrigin(result.url),
    }));
  } catch {
    return [];
  }
}

type PageFetchOptions = {
  enableJina: boolean;
  jinaState: { count: number };
};

async function fetchPageSource(
  candidate: { title: string; url: string; snippet: string },
  query: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number,
  options: PageFetchOptions,
): Promise<ResearchSource> {
  const origin = classifySourceOrigin(candidate.url);
  const fallback: ResearchSource = {
    title: candidate.title,
    url: candidate.url,
    snippet: candidate.snippet,
    origin,
  };
  if (!isPublicHttpUrl(candidate.url) || isLikelyLoginWallHost(candidate.url)) return fallback;

  try {
    const host = new URL(candidate.url).hostname.toLowerCase();
    if ((host === 'wikipedia.org' || host.endsWith('.wikipedia.org')) && candidate.snippet.trim().length >= 80) {
      return {
        title: candidate.title,
        url: candidate.url,
        snippet: candidate.snippet.slice(0, MAX_SNIPPET),
        origin,
      };
    }
  } catch {
    // Continue with a normal fetch.
  }

  const tryDirect = async (): Promise<ResearchSource | null> => {
    try {
      const page = await fetchBounded(fetchImpl, candidate.url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': RESEARCH_USER_AGENT,
        },
        redirect: 'follow',
      }, maxBytes, timeoutMs);
      if (!isPublicHttpUrl(page.url) || isLikelyLoginWallHost(page.url)) return null;
      if (isEmptyOrLoginWallSource(page.text, page.url, htmlTitle(page.text))) {
        if (candidate.snippet.trim().length >= 40 && !isEmptyOrLoginWallSource(candidate.snippet, candidate.url, candidate.title)) {
          return { title: candidate.title, url: candidate.url, snippet: candidate.snippet.slice(0, MAX_SNIPPET), origin };
        }
        return null;
      }
      const extracted = extractFetchedContent(page.text, query, page.contentType);
      const snippet = pickRicherSnippet(extracted.snippet, candidate.snippet, query).slice(0, MAX_SNIPPET);
      if (!snippet.trim() || isEmptyOrLoginWallSource(snippet, page.url, extracted.title)) return null;
      return {
        title: extracted.title || candidate.title,
        url: page.url,
        snippet,
        origin: classifySourceOrigin(page.url),
      };
    } catch {
      return null;
    }
  };

  const tryJina = async (): Promise<ResearchSource | null> => {
    if (!options.enableJina || options.jinaState.count >= MAX_JINA_FETCHES) return null;
    const wrapped = jinaReaderUrl(candidate.url);
    if (!wrapped) return null;
    options.jinaState.count += 1;
    try {
      // Chrome UAs from datacenters trip Jina's Cloudflare challenge (HTTP 403).
      // A bare Accept: text/plain request succeeds from the same IP.
      const page = await fetchBounded(fetchImpl, wrapped, {
        headers: {
          Accept: 'text/plain',
        },
        redirect: 'follow',
      }, maxBytes, timeoutMs);
      if (/just a moment|cf-browser-verification|challenge-platform|target url returned error|failed to fetch/i.test(page.text.slice(0, 500))) {
        return null;
      }
      if (isEmptyOrLoginWallSource(page.text, candidate.url)) {
        if (candidate.snippet.trim().length >= 40 && !isEmptyOrLoginWallSource(candidate.snippet, candidate.url, candidate.title)) {
          return { title: candidate.title, url: candidate.url, snippet: candidate.snippet.slice(0, MAX_SNIPPET), origin };
        }
        return null;
      }
      const extracted = extractFetchedContent(page.text, query, page.contentType);
      const snippet = pickRicherSnippet(extracted.snippet, candidate.snippet, query).slice(0, MAX_SNIPPET);
      if (!snippet.trim() || isEmptyOrLoginWallSource(snippet, candidate.url, extracted.title)) return null;
      return {
        title: extracted.title || candidate.title,
        url: candidate.url,
        snippet,
        origin: classifySourceOrigin(candidate.url),
      };
    } catch {
      return null;
    }
  };

  // Native fetch first (VPS now has the Sectigo intermediate for bappebti.go.id).
  // Jina stays a fallback for TLS/network failures and hosts that bot-block datacenters.
  const attempts = [tryDirect, tryJina];
  let best: ResearchSource | null = null;
  for (const attempt of attempts) {
    const result = await attempt();
    if (result && result.snippet.trim().length >= 40) return result;
    if (result && !best) best = result;
  }
  return best || fallback;
}

function snippetGroundingScore(text: string, query: string): number {
  const names = extractPersonNameCandidates(query).map(name => name.toLowerCase());
  const lower = text.toLowerCase();
  let score = 0;
  if (names.some(name => lower.includes(name))) score += 3;
  if (ROLE_SNIPPET_RE.test(lower)) score += 2;
  if (score >= 5) score += 2;
  if (text.trim().length > 80) score += 1;
  return score;
}

function pickRicherSnippet(extracted: string, fallback: string, query: string): string {
  const extractedScore = snippetGroundingScore(extracted, query);
  const fallbackScore = snippetGroundingScore(fallback, query);
  if (fallbackScore > extractedScore) return fallback || extracted;
  if (extractedScore > fallbackScore) return extracted || fallback;
  if (extracted.length > 40) return extracted;
  return fallback || extracted;
}

function uniqueSourceCount(sources: ResearchSource[]): number {
  return new Set(sources.map(source => source.url.replace(/\/$/, ''))).size;
}

function isUsableResearchSource(source: ResearchSource, query: string): boolean {
  if (isLikelyLoginWallHost(source.url) || isEmptyOrLoginWallSource(source.snippet, source.url, source.title)) {
    return false;
  }
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
  const keys = resolveSearchApiKeys(options.searchApiKeys);
  const serperKey = keys.serper;
  const logger = options.logger || console;
  const enableJina = options.enableJinaFallback !== false;
  const jinaState = { count: 0 };

  const queries = buildSearchQueries(query);
  const serperQueries = serperKey ? buildOpenWebSearchQueries(query) : [];
  const wikiQueries = buildWikipediaQueries(query);
  const newsQueries = buildNewsRssQueries(query);
  const instantQueries = [...new Set([
    query,
    names[0] || '',
    /\bdupoin\b/i.test(query) || isDeepPersonResearch(query) ? 'Dupoin Futures Indonesia' : '',
    /\b(bappebti|pialang|dupoin)\b/i.test(query) || isDeepPersonResearch(query) ? 'Bappebti' : '',
  ].filter(Boolean))].slice(0, 3);
  const found: ResearchSource[] = officialSeedUrls(query).map(url => ({
    title: url,
    url,
    snippet: '',
    origin: classifySourceOrigin(url),
  }));

  let serperHits = 0;
  let serperExhausted = !serperKey;
  if (serperKey && serperQueries.length) {
    const serperBudget = Math.max(1_500, Math.floor(remainingMs(deadline, now) * 0.35));
    const serperSettled = await Promise.allSettled(
      serperQueries.map(item => searchSerper(item, serperKey, fetchImpl, maxBytes, serperBudget)),
    );
    let quotaHit = false;
    for (const result of serperSettled) {
      if (result.status !== 'fulfilled') continue;
      if (result.value.exhausted) quotaHit = true;
      if (result.value.sources.length) {
        found.push(...result.value.sources);
        serperHits += result.value.sources.length;
      }
    }
    serperExhausted = quotaHit || serperHits === 0;
    if (serperExhausted) logger.warn(SERPER_EXHAUSTED_WARNING);
  }

  const needHtmlSearch = !serperKey || serperHits < 3;
  const searchBudget = Math.max(1_500, Math.floor(remainingMs(deadline, now) * 0.4));
  const [ddgProbe, wikiSettled, instantSettled, wikidataSettled, newsSettled] = await Promise.all([
    needHtmlSearch
      ? searchDuckDuckGoHtml(queries[0], fetchImpl, maxBytes, Math.min(3_000, searchBudget))
      : Promise.resolve({ sources: [], blocked: false } as HtmlSearchResult),
    Promise.allSettled(wikiQueries.map(item => (
      searchWikipedia(item, indonesiaPreferred, fetchImpl, maxBytes, searchBudget)
    ))),
    Promise.allSettled(instantQueries.map(item => (
      searchDuckDuckGoInstantAnswer(item, fetchImpl, maxBytes, searchBudget)
    ))),
    Promise.allSettled(wikiQueries.map(item => (
      searchWikidata(item, indonesiaPreferred, fetchImpl, maxBytes, searchBudget)
    ))),
    Promise.allSettled(newsQueries.map(item => (
      searchNewsRss(item, indonesiaPreferred, fetchImpl, maxBytes, searchBudget)
    ))),
  ]);

  let htmlSearchBlocked = ddgProbe.blocked;
  let searchHits = ddgProbe.sources.length;
  found.push(...ddgProbe.sources);

  for (const result of wikiSettled) {
    if (result.status === 'fulfilled') found.push(...result.value);
  }
  for (const result of instantSettled) {
    if (result.status === 'fulfilled') found.push(...result.value);
  }
  for (const result of wikidataSettled) {
    if (result.status === 'fulfilled') found.push(...result.value);
  }
  for (const result of newsSettled) {
    if (result.status === 'fulfilled') found.push(...result.value);
  }

  if (needHtmlSearch && !htmlSearchBlocked && serperHits < 3 && queries.length > 1) {
    const rest = await Promise.allSettled(
      queries.slice(1).map(item => searchDuckDuckGoHtml(item, fetchImpl, maxBytes, searchBudget)),
    );
    for (const result of rest) {
      if (result.status !== 'fulfilled') continue;
      if (result.value.blocked) continue;
      found.push(...result.value.sources);
      searchHits += result.value.sources.length;
    }
  }

  if (htmlSearchBlocked && serperHits < 3) {
    logger.warn(DDG_HTML_BLOCKED_WARNING);
  }

  if (needHtmlSearch && !htmlSearchBlocked && serperHits < 3 && (searchHits < 3 || uniqueSourceCount(found) < 4)) {
    const fallbackQueries = buildFallbackSearchQueries(query);
    const fallbackBudget = Math.max(1_200, Math.floor(remainingMs(deadline, now) * 0.35));
    if (fallbackQueries.length && fallbackBudget > 0) {
      const extras = await Promise.allSettled(
        fallbackQueries.map(item => searchDuckDuckGoHtml(item, fetchImpl, maxBytes, fallbackBudget)),
      );
      for (const result of extras) {
        if (result.status !== 'fulfilled') continue;
        if (result.value.blocked) htmlSearchBlocked = true;
        else found.push(...result.value.sources);
      }
    }
  }

  const ranked = selectFetchCandidates(
    found.filter(source => !isLikelyLoginWallHost(source.url)),
    query,
    indonesiaPreferred,
    MAX_PAGE_FETCHES,
  );
  if (ranked.length === 0) return empty;

  const fetchBudget = Math.max(1_200, remainingMs(deadline, now));
  const fetched = await Promise.all(ranked.map(source => fetchPageSource(
    source,
    query,
    fetchImpl,
    maxBytes,
    fetchBudget,
    { enableJina, jinaState },
  )));
  const cleaned = fetched.filter(source => (
    !isLikelyLoginWallHost(source.url)
    && !isEmptyOrLoginWallSource(source.snippet, source.url, source.title)
  ));
  const withText = cleaned.filter(source => source.snippet.trim().length >= 40);
  const usable = cleaned.filter(source => isUsableResearchSource(source, query));
  const selected = withText.length >= 3 ? withText : usable.length ? usable : cleaned;
  return {
    query,
    indonesiaPreferred,
    sources: diversifyResearchSources(
      rankResearchSources(selected, indonesiaPreferred, query, selected.length),
      MAX_SOURCES,
    ),
  };
}
