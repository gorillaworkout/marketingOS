import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  classifySourceOrigin,
  isEmptyOrLoginWallSource,
  jinaReaderUrl,
  type ResearchSource,
} from './ai-research-grounding';
import {
  AI_RESEARCH_URL_MAX_BYTES,
  AI_RESEARCH_URL_MAX_CHARS,
  AI_RESEARCH_URL_MIN_TEXT,
  AI_RESEARCH_URL_TIMEOUT_MS,
  contextPageText,
  contextUrlBlockReason,
  isNonPublicIpAddress,
  scanContextUrls,
  type ContextUrlFailure,
} from './ai-research-urls';

export interface ContextUrlFetchResult {
  sources: ResearchSource[];
  failures: ContextUrlFailure[];
}

export interface FetchContextUrlOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxChars?: number;
  lookupImpl?: (hostname: string) => Promise<string[]>;
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

async function defaultLookup(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const records = await lookup(bareHost(hostname), { all: true, verbatim: true });
  return records.map(record => record.address);
}

async function assertFetchable(
  value: string,
  lookupImpl: (hostname: string) => Promise<string[]>,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const reason = contextUrlBlockReason(value);
  if (reason) return { ok: false, error: reason };
  const parsed = new URL(value);
  parsed.hash = '';
  const host = bareHost(parsed.hostname);
  if (isIP(host) || host.includes(':')) {
    if (isNonPublicIpAddress(host)) return { ok: false, error: 'address is not public' };
    return { ok: true, url: parsed.toString() };
  }
  let addresses: string[] = [];
  try {
    addresses = await lookupImpl(host);
  } catch {
    return { ok: false, error: 'host name was not found' };
  }
  if (!addresses.length || addresses.some(address => isNonPublicIpAddress(address))) {
    return { ok: false, error: 'address is not public' };
  }
  return { ok: true, url: parsed.toString() };
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; contentType: string }> {
  const contentType = response.headers.get('content-type') || '';
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('page is too large');
  if (!response.body) {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), contentType };
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
  return { text: new TextDecoder().decode(bytes), contentType };
}

function readableContentType(contentType: string): boolean {
  if (!contentType) return true;
  return /text\/|html|xml|json|markdown/i.test(contentType);
}

async function fetchOnce(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  maxBytes: number,
  headers: Record<string, string>,
): Promise<{ url: string; text: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const response = await fetchImpl(url, {
      headers,
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect has no destination');
      throw Object.assign(new Error('redirect'), { redirectTo: new URL(location, url).toString() });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await readBounded(response, maxBytes);
    if (!readableContentType(body.contentType)) throw new Error('page is not text');
    return { url, ...body };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 160);
  return 'could not fetch the page';
}

async function fetchPageText(
  startUrl: string,
  options: Required<Pick<FetchContextUrlOptions, 'fetchImpl' | 'timeoutMs' | 'maxBytes' | 'maxChars' | 'lookupImpl'>>,
): Promise<{ title: string; text: string; url: string } | { error: string }> {
  const started = Date.now();
  const remaining = () => options.timeoutMs - (Date.now() - started);
  let current = startUrl;
  let directError = 'could not fetch the page';

  for (let hop = 0; hop < 3; hop += 1) {
    const allowed = await assertFetchable(current, options.lookupImpl);
    if (!allowed.ok) return { error: allowed.error };
    if (remaining() < 500) return { error: 'timed out' };
    try {
      const page = await fetchOnce(
        options.fetchImpl,
        allowed.url,
        remaining(),
        options.maxBytes,
        {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      );
      const extracted = contextPageText(page.text, page.contentType, options.maxChars);
      if (extracted.text.length >= AI_RESEARCH_URL_MIN_TEXT && !isEmptyOrLoginWallSource(extracted.text, page.url, extracted.title)) {
        return { title: extracted.title, text: extracted.text, url: page.url };
      }
      directError = 'page is empty';
      break;
    } catch (error) {
      const redirectTo = error && typeof error === 'object' && 'redirectTo' in error
        ? String((error as { redirectTo?: string }).redirectTo || '')
        : '';
      if (redirectTo) {
        current = redirectTo;
        continue;
      }
      directError = failureMessage(error);
      break;
    }
  }

  const wrapped = jinaReaderUrl(startUrl);
  if (!wrapped || remaining() < 500) return { error: directError };
  const jinaAllowed = await assertFetchable(wrapped, options.lookupImpl);
  if (!jinaAllowed.ok) return { error: directError };
  try {
    const page = await fetchOnce(
      options.fetchImpl,
      jinaAllowed.url,
      remaining(),
      options.maxBytes,
      { Accept: 'text/plain' },
    );
    if (/just a moment|cf-browser-verification|challenge-platform|target url returned error|failed to fetch/i.test(page.text.slice(0, 500))) {
      return { error: directError };
    }
    const extracted = contextPageText(page.text, page.contentType, options.maxChars);
    if (extracted.text.length < AI_RESEARCH_URL_MIN_TEXT || isEmptyOrLoginWallSource(extracted.text, startUrl, extracted.title)) {
      return { error: 'page is empty' };
    }
    return { title: extracted.title, text: extracted.text, url: startUrl };
  } catch (error) {
    const message = failureMessage(error);
    return { error: message === 'redirect' ? directError : message };
  }
}

function toSource(url: string, title: string, text: string): ResearchSource {
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep the original url */ }
  const label = title.trim() || host;
  return {
    title: label,
    url,
    snippet: `[Tautan pengguna] ${text}`,
    origin: classifySourceOrigin(url),
  };
}

export async function fetchAiResearchContextUrls(
  text: string,
  options: FetchContextUrlOptions = {},
): Promise<ContextUrlFetchResult> {
  const scan = scanContextUrls(text);
  const failures: ContextUrlFailure[] = [
    ...scan.blocked.map(item => ({
      url: item.url,
      error: contextUrlBlockReason(item.url) || 'address is not public',
    })),
    ...scan.overflow.map(item => ({ url: item.url, error: 'maksimal 3 tautan per pesan' })),
  ];
  const fetchImpl = options.fetchImpl || fetch;
  const lookupImpl = options.lookupImpl || defaultLookup;
  const settled = await Promise.all(scan.accepted.map(async item => {
    const result = await fetchPageText(item.url, {
      fetchImpl,
      lookupImpl,
      timeoutMs: options.timeoutMs ?? AI_RESEARCH_URL_TIMEOUT_MS,
      maxBytes: options.maxBytes ?? AI_RESEARCH_URL_MAX_BYTES,
      maxChars: options.maxChars ?? AI_RESEARCH_URL_MAX_CHARS,
    });
    if ('error' in result) return { failure: { url: item.url, error: result.error } };
    return { source: toSource(result.url, result.title, result.text) };
  }));
  const sources: ResearchSource[] = [];
  for (const item of settled) {
    if ('source' in item && item.source) sources.push(item.source);
    else if ('failure' in item && item.failure) failures.push(item.failure);
  }
  return { sources, failures };
}
