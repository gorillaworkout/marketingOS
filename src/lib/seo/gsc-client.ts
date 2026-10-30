/**
 * Google Search Console client for SEO OS.
 *
 * Auth: a Google Cloud service account (JSON key) signs a JWT with the
 * `webmasters.readonly` scope and exchanges it for an access token. The key
 * file lives on the server outside the repo; its path comes from
 * GSC_SA_KEY_PATH. Key contents are never logged or returned to clients.
 */
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GSC_API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';
/** Search Analytics returns at most 25,000 rows per request. */
export const GSC_MAX_ROW_LIMIT = 25000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export const defaultSleep: SleepFn = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Configuration problem an admin can fix (missing key, missing property, no access). */
export class SeoConfigError extends Error {
  constructor(message: string, readonly code: 'missing-key-path' | 'key-unreadable' | 'key-invalid' | 'missing-property' | 'no-access' | 'property-not-found') {
    super(message);
    this.name = 'SeoConfigError';
  }
}

export class GscApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GscApiError';
  }
}

export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
}

/** Validates a parsed key file. Error messages never include key material. */
export function parseServiceAccountKey(raw: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SeoConfigError('The Search Console service account key file is not valid JSON.', 'key-invalid');
  }
  const value = parsed as Record<string, unknown>;
  if (value?.type !== 'service_account' || typeof value.client_email !== 'string' || typeof value.private_key !== 'string' || !value.private_key.includes('PRIVATE KEY')) {
    throw new SeoConfigError('The Search Console key file is not a Google service account JSON key (needs type, client_email, private_key).', 'key-invalid');
  }
  return {
    clientEmail: value.client_email,
    privateKey: value.private_key,
    privateKeyId: typeof value.private_key_id === 'string' ? value.private_key_id : undefined,
  };
}

export async function loadServiceAccountKey(
  env: Record<string, string | undefined> = process.env,
  read: (path: string) => Promise<string> = path => readFile(path, 'utf8'),
): Promise<ServiceAccountKey> {
  const keyPath = env.GSC_SA_KEY_PATH?.trim();
  if (!keyPath) {
    throw new SeoConfigError('Search Console is not connected: GSC_SA_KEY_PATH is not set on the server. See docs/seo-os/setup.md.', 'missing-key-path');
  }
  let raw: string;
  try {
    raw = await read(keyPath);
  } catch {
    throw new SeoConfigError('Search Console is not connected: the service account key file at GSC_SA_KEY_PATH cannot be read. Check the path and file permissions.', 'key-unreadable');
  }
  return parseServiceAccountKey(raw);
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** Builds the signed JWT assertion for the OAuth 2.0 service account flow. */
export function buildJwtAssertion(key: ServiceAccountKey, nowSeconds: number, scope = GSC_SCOPE): string {
  const header = { alg: 'RS256', typ: 'JWT', ...(key.privateKeyId ? { kid: key.privateKeyId } : {}) };
  const claims = { iss: key.clientEmail, scope, aud: GOOGLE_TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(key.privateKey).toString('base64url')}`;
}

export interface AccessTokenProvider {
  getToken(forceRefresh?: boolean): Promise<string>;
}

export function createAccessTokenProvider(
  key: ServiceAccountKey,
  options: { fetch?: FetchLike; now?: () => number } = {},
): AccessTokenProvider {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  return {
    async getToken(forceRefresh = false) {
      if (!forceRefresh && cached && cached.expiresAt - 60_000 > now()) return cached.token;
      const assertion = buildJwtAssertion(key, Math.floor(now() / 1000));
      const response = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      });
      const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
      if (!response.ok || !body.access_token) {
        throw new SeoConfigError(`Google rejected the service account token request (${body.error || response.status}). Check that the key is active and the Search Console API is enabled in its Google Cloud project.`, 'key-invalid');
      }
      cached = { token: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 };
      return cached.token;
    },
  };
}

export interface SearchAnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsRequest {
  startDate: string;
  endDate: string;
  dimensions: Array<'date' | 'query' | 'page' | 'country' | 'device'>;
  type?: 'web';
  dataState?: 'final' | 'all';
  rowLimit?: number;
  startRow?: number;
}

export interface GscClientOptions {
  fetch?: FetchLike;
  sleep?: SleepFn;
  maxRetries?: number;
  baseDelayMs?: number;
  serviceAccountEmail?: string;
}

export const MAX_GOOGLE_ERROR_LENGTH = 400;
const MAX_GOOGLE_MESSAGE_LENGTH = 300;

/** Strips anything that looks like a credential before Google's text is stored or shown. */
function redactSecrets(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*-----[\s\S]*?(-----END [^-]*-----|$)/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bya29\.[\w.-]+/g, '[redacted]')
    .replace(/\bAIza[\w-]{20,}/g, '[redacted]')
    .replace(/\beyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, '[redacted]');
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Turns a Google API error body into a short, safe summary such as
 * "PERMISSION_DENIED (SERVICE_DISABLED, accessNotConfigured): <message>".
 * Returns '' for empty, non-JSON or unrelated bodies (their raw text is never echoed).
 */
export function describeGoogleError(bodyText: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); } catch { return ''; }
  const raw = parsed && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : undefined;
  if (typeof raw === 'string') return clip(redactSecrets(raw.replace(/\s+/g, ' ').trim()), MAX_GOOGLE_ERROR_LENGTH);
  if (!raw || typeof raw !== 'object') return '';
  const error = raw as { status?: unknown; message?: unknown; errors?: unknown; details?: unknown };
  const word = (value: unknown) => (typeof value === 'string' && /^[\w.-]{1,64}$/.test(value) ? value : '');
  const reasons: string[] = [];
  for (const list of [error.details, error.errors]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const reason = word(item && typeof item === 'object' ? (item as { reason?: unknown }).reason : undefined);
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    }
  }
  const status = word(error.status);
  const message = typeof error.message === 'string'
    ? clip(redactSecrets(error.message.replace(/\s+/g, ' ').trim()), MAX_GOOGLE_MESSAGE_LENGTH)
    : '';
  const head = [status, reasons.length ? `(${reasons.slice(0, 4).join(', ')})` : ''].filter(Boolean).join(' ');
  return clip([head, message].filter(Boolean).join(': '), MAX_GOOGLE_ERROR_LENGTH);
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function retryDelayMs(attempt: number, baseDelayMs: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  return Math.min(baseDelayMs * 2 ** attempt, 60_000);
}

export interface GscClient {
  query(property: string, request: SearchAnalyticsRequest): Promise<SearchAnalyticsRow[]>;
}

/**
 * One Search Analytics request with retry and exponential backoff on 429 and
 * 5xx (honours Retry-After), and one token refresh on 401.
 */
export function createGscClient(tokens: AccessTokenProvider, options: GscClientOptions = {}): GscClient {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  return {
    async query(property, request) {
      const url = `${GSC_API_BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
      let refreshed = false;
      for (let attempt = 0; ; attempt++) {
        const token = await tokens.getToken();
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'web', dataState: 'all', ...request }),
        });
        if (response.ok) {
          const body = await response.json() as { rows?: SearchAnalyticsRow[] };
          return body.rows ?? [];
        }
        if (response.status === 401 && !refreshed) {
          refreshed = true;
          await tokens.getToken(true);
          continue;
        }
        if (RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
          await sleep(retryDelayMs(attempt, baseDelayMs, response.headers.get('retry-after')));
          continue;
        }
        const google = describeGoogleError(await response.text().catch(() => ''));
        if (response.status === 403) {
          const who = options.serviceAccountEmail ? ` (${options.serviceAccountEmail})` : '';
          const reason = google ? ` Google said: ${google}` : '';
          throw new SeoConfigError(`The service account${who} has no access to Search Console property "${property}". Ask a property Owner to add it as a Restricted user, or check that the Search Console API is enabled.${reason}`, 'no-access');
        }
        if (response.status === 404) {
          throw new SeoConfigError(`Search Console property "${property}" was not found. Check the property type (sc-domain:example.com vs https://example.com/).`, 'property-not-found');
        }
        throw new GscApiError(`Search Console API error ${response.status}: ${google || response.statusText}`, response.status);
      }
    },
  };
}

/** Pages through a Search Analytics query with startRow until a short page is returned. */
export async function fetchAllRows(
  client: GscClient,
  property: string,
  request: Omit<SearchAnalyticsRequest, 'rowLimit' | 'startRow'>,
  rowLimit = GSC_MAX_ROW_LIMIT,
): Promise<SearchAnalyticsRow[]> {
  const rows: SearchAnalyticsRow[] = [];
  for (let startRow = 0; ; startRow += rowLimit) {
    const page = await client.query(property, { ...request, rowLimit, startRow });
    rows.push(...page);
    if (page.length < rowLimit) return rows;
  }
}
