import {
  extractFetchedContent,
  htmlToPlainText,
  isDuckDuckGoAnomalyPage,
  isLikelyLoginWallHost,
  isPublicHttpUrl,
  jinaReaderUrl,
  parseDuckDuckGoResults,
  resolveSearchApiKeys,
  searchSerper,
} from './ai-research-grounding';
import { resolveEventLocation } from './event-plan-budget';
import type { EventPlanResearch } from './event-plan-research';
import {
  buildEventPricingQueries,
  extractPublicContacts,
  extractPublicRupiahAmounts,
  inferPricingCategory,
  type EventPricingHit,
  type PricingCategory,
} from './event-plan-pricing';

const MAX_PAGE_FETCHES = 5;
const MAX_BYTES = 400_000;
const DEFAULT_TIMEOUT_MS = 8_000;

export type EventPricingResearch = {
  queries: string[];
  hits: EventPricingHit[];
  warnings: string[];
};

type FetchLike = typeof fetch;

type Candidate = {
  url: string;
  title: string;
  snippet: string;
  query: string;
  submitted: boolean;
};

async function readLimitedPublicBody(
  response: Response,
  requestedUrl: string,
  maxBytes: number,
): Promise<{ url: string; text: string; contentType: string } | null> {
  const finalUrl = response.url || requestedUrl;
  if (!isPublicHttpUrl(finalUrl)) return null;
  if (!response.ok) return null;
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!response.body) {
    const text = (await response.text()).slice(0, maxBytes);
    return { url: finalUrl, text, contentType };
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
    const next = chunk.byteLength + offset > bytes.byteLength ? chunk.subarray(0, bytes.byteLength - offset) : chunk;
    bytes.set(next, offset);
    offset += next.byteLength;
    if (offset >= bytes.byteLength) break;
  }
  return { url: finalUrl, text: new TextDecoder().decode(bytes), contentType };
}

async function fetchPublicText(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxBytes: number,
  headers: HeadersInit,
): Promise<string | null> {
  if (!isPublicHttpUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const response = await fetchImpl(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = await readLimitedPublicBody(response, url, maxBytes);
    return body?.text ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function usablePage(text: string): boolean {
  const plain = htmlToPlainText(text);
  if (plain.length < 80) return false;
  return !/just a moment|cf-browser-verification|challenge-platform|access denied|target url returned error/i.test(plain.slice(0, 500));
}

async function fetchPublicDocument(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxBytes: number,
  enableJina: boolean,
): Promise<string | null> {
  if (!isPublicHttpUrl(url) || isLikelyLoginWallHost(url)) return null;
  const direct = await fetchPublicText(url, fetchImpl, timeoutMs, maxBytes, {
    Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  if (direct && usablePage(direct)) return direct;
  if (!enableJina) return direct;
  const wrapped = jinaReaderUrl(url);
  if (!wrapped) return direct;
  const viaJina = await fetchPublicText(wrapped, fetchImpl, timeoutMs, maxBytes, { Accept: 'text/plain' });
  if (viaJina && usablePage(viaJina)) return viaJina;
  return direct || viaJina;
}

function splitStatements(text: string): string[] {
  const parts = text
    .split(/\n+|(?<=\.)\s+(?!\d)|;\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts.slice(0, 24) : [];
}

function hitsFromDocument(candidate: Candidate, text: string): EventPricingHit[] {
  const plain = htmlToPlainText(text).replace(/\s+/g, ' ').trim();
  const sourceText = plain || candidate.snippet;
  const contacts = extractPublicContacts(sourceText);
  const queryCategory = inferPricingCategory(candidate.query);
  const grouped = new Map<PricingCategory, { amounts: number[]; snippets: string[] }>();
  for (const statement of splitStatements(sourceText)) {
    const amounts = extractPublicRupiahAmounts(statement);
    if (!amounts.length) continue;
    const category = inferPricingCategory(statement, queryCategory);
    const group = grouped.get(category) || { amounts: [], snippets: [] };
    for (const amount of amounts) {
      if (!group.amounts.includes(amount)) group.amounts.push(amount);
    }
    group.snippets.push(statement);
    grouped.set(category, group);
  }
  const title = candidate.title || candidate.url;
  if (grouped.size === 0) {
    const extracted = sourceText ? extractFetchedContent(sourceText, candidate.query).snippet : '';
    return [{
      url: candidate.url,
      title,
      snippet: (extracted || sourceText).slice(0, 700),
      query: candidate.query,
      category: inferPricingCategory(`${candidate.query} ${sourceText.slice(0, 400)}`, queryCategory),
      amounts: [],
      phones: contacts.phones,
      emails: contacts.emails,
    }];
  }
  return [...grouped.entries()].map(([category, group]) => ({
    url: candidate.url,
    title,
    snippet: group.snippets.join(' ').slice(0, 700),
    query: candidate.query,
    category,
    amounts: group.amounts,
    phones: contacts.phones,
    emails: contacts.emails,
  }));
}

async function searchPublicWeb(
  queries: string[],
  fetchImpl: FetchLike,
  serperKey: string,
  timeoutMs: number,
  warnings: string[],
): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: Candidate) => {
    if (!isPublicHttpUrl(candidate.url) || isLikelyLoginWallHost(candidate.url) || seen.has(candidate.url)) return;
    seen.add(candidate.url);
    found.push(candidate);
  };

  if (serperKey) {
    const settled = await Promise.allSettled(
      queries.map((query) => searchSerper(query, serperKey, fetchImpl, MAX_BYTES, timeoutMs)),
    );
    let hits = 0;
    let exhausted = false;
    settled.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      exhausted = exhausted || result.value.exhausted;
      hits += result.value.sources.length;
      for (const source of result.value.sources) {
        push({
          url: source.url,
          title: source.title,
          snippet: source.snippet,
          query: queries[index],
          submitted: false,
        });
      }
    });
    if (exhausted || hits === 0) warnings.push('Serper returned no usable public hits. Continuing with public pages.');
    if (hits > 0) return found;
  }

  let blocked = false;
  for (const query of queries) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchPublicText(url, fetchImpl, timeoutMs, MAX_BYTES, {
      Accept: 'text/html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    if (!html || isDuckDuckGoAnomalyPage(html)) {
      blocked = true;
      continue;
    }
    for (const result of parseDuckDuckGoResults(html)) {
      push({
        url: result.url,
        title: result.title,
        snippet: result.snippet,
        query,
        submitted: false,
      });
    }
    if (found.length >= 6) break;
  }
  if (blocked && found.length === 0) warnings.push('Public web search was blocked. Submitted URLs are still fetched when they are public.');
  return found;
}

export async function researchEventPricing(input: {
  eventName?: string;
  theme?: string;
  location?: string;
  researchUrls?: string[];
  fetchImpl?: FetchLike;
  serperApiKey?: string;
  timeoutMs?: number;
  enableJina?: boolean;
}): Promise<EventPricingResearch> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const enableJina = input.enableJina !== false;
  const location = resolveEventLocation(input.location);
  const queries = buildEventPricingQueries({ eventName: input.eventName, theme: input.theme, location });
  const warnings: string[] = [];
  const serperKey = input.serperApiKey !== undefined ? input.serperApiKey.trim() : resolveSearchApiKeys().serper;
  const searched = await searchPublicWeb(queries, fetchImpl, serperKey, timeoutMs, warnings);
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: Candidate) => {
    if (!isPublicHttpUrl(candidate.url) || isLikelyLoginWallHost(candidate.url) || seen.has(candidate.url)) return;
    seen.add(candidate.url);
    candidates.push(candidate);
  };
  for (const url of input.researchUrls || []) {
    push({ url, title: url, snippet: '', query: `${location} sewa venue`, submitted: true });
  }
  for (const candidate of searched) push(candidate);

  const priced = candidates.filter((candidate) => extractPublicRupiahAmounts(candidate.snippet).length > 0);
  const fetchList = [...candidates.filter((candidate) => candidate.submitted), ...priced, ...candidates]
    .filter((candidate, index, list) => list.findIndex((item) => item.url === candidate.url) === index)
    .slice(0, MAX_PAGE_FETCHES);

  const documents = new Map<string, string>();
  await Promise.all(fetchList.map(async (candidate) => {
    const text = await fetchPublicDocument(candidate.url, fetchImpl, timeoutMs, MAX_BYTES, enableJina);
    if (text) documents.set(candidate.url, text);
  }));

  const hits: EventPricingHit[] = [];
  const consumed = new Set<string>();
  for (const candidate of fetchList) {
    const text = documents.get(candidate.url) || candidate.snippet;
    if (!text.trim() && !candidate.submitted) continue;
    hits.push(...hitsFromDocument(candidate, text));
    consumed.add(candidate.url);
  }
  for (const candidate of priced) {
    if (consumed.has(candidate.url)) continue;
    hits.push(...hitsFromDocument(candidate, candidate.snippet));
  }
  return { queries, hits: hits.slice(0, 12), warnings };
}

export function toEventPlanResearch(research: EventPricingResearch, submittedUrls: string[] = []): EventPlanResearch {
  const contacts: EventPlanResearch['contacts'] = [];
  const seenContacts = new Set<string>();
  for (const hit of research.hits) {
    const vendor = hit.title.replace(/\s+/g, ' ').trim().slice(0, 120) || hit.url;
    const pairs = Math.max(hit.phones.length, hit.emails.length, hit.phones.length || hit.emails.length ? 1 : 0);
    for (let index = 0; index < Math.min(pairs, 2); index += 1) {
      const phone = hit.phones[index] || '';
      const email = hit.emails[index] || '';
      if (!phone && !email) continue;
      const key = `${hit.url}|${phone}|${email}`;
      if (seenContacts.has(key)) continue;
      seenContacts.add(key);
      contacts.push({ vendor, phone, email, sourceUrl: hit.url, verified: false });
    }
  }
  const sources = research.hits.map((hit) => ({
    url: hit.url,
    title: hit.title,
    snippet: hit.snippet,
    query: hit.query,
    claim: hit.amounts.length
      ? 'Harga publik dari halaman ini (bukan quotation terverifikasi)'
      : 'Belum ditemukan harga publik di halaman ini — minta quotation ke vendor',
  }));
  const listed = new Set(sources.map((source) => source.url));
  for (const url of submittedUrls) {
    if (!isPublicHttpUrl(url) || listed.has(url)) continue;
    sources.push({
      url,
      title: url,
      snippet: '',
      query: 'submitted link',
      claim: 'Halaman publik tidak berhasil diambil — minta quotation ke vendor',
    });
  }
  const status = research.hits.length ? 'researched' : submittedUrls.length ? 'source-provided' : 'unverified';
  return {
    status,
    sources,
    contacts,
    queries: research.queries,
  };
}
