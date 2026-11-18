/**
 * Minimal read-only Google Ads REST client.
 *
 * Only two endpoints are ever called: customers:listAccessibleCustomers and
 * customers/{id}/googleAds:search (GAQL SELECT, paginated). There is no
 * mutate path in this module, and assertReadOnlyGaql rejects anything that is
 * not a SELECT. Errors are sanitized so tokens never reach logs or the UI.
 */
import { sanitizeGoogleAdsError, secretValues, type GoogleAdsConfig } from './config';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
/** googleAds:search returns at most 10,000 rows per page; this caps runaway paging. */
const MAX_PAGES = 500;

export class GoogleAdsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = 'GoogleAdsApiError';
  }
  get isPermission(): boolean {
    return this.status === 403 || /PERMISSION|NOT_ENABLED|CUSTOMER_NOT_ENABLED|USER_PERMISSION_DENIED/i.test(this.code ?? '');
  }
}

export interface GoogleAdsRow { [key: string]: unknown }

export interface GoogleAdsClient {
  listAccessibleCustomers(): Promise<string[]>;
  /** All rows for a GAQL SELECT on one customer, following nextPageToken. */
  search(customerId: string, query: string, options?: { loginCustomerId?: string | null }): Promise<GoogleAdsRow[]>;
}

export function assertReadOnlyGaql(query: string): void {
  const text = query.trim();
  if (!/^SELECT\s/i.test(text) || /;/.test(text)) throw new Error('Only single GAQL SELECT queries are allowed.');
}

const defaultSleep: SleepFn = ms => new Promise(resolve => setTimeout(resolve, ms));

/** "30s" / "1.5s" from QuotaErrorDetails.retryDelay -> ms. */
function parseRetryDelay(value: unknown): number | null {
  const match = typeof value === 'string' ? value.match(/^([0-9.]+)s$/) : null;
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

interface ApiErrorBody {
  error?: {
    code?: number; message?: string; status?: string;
    details?: Array<{ errors?: Array<{ errorCode?: Record<string, string>; message?: string }>; quotaErrorDetails?: { retryDelay?: string } }>;
  };
  error_description?: string;
}

function describeError(status: number, body: ApiErrorBody | null): { message: string; code: string | null; retryDelayMs: number | null } {
  const first = body?.error?.details?.flatMap(detail => detail.errors ?? [])[0];
  const codeEntry = first?.errorCode ? Object.entries(first.errorCode)[0] : null;
  const code = codeEntry ? `${codeEntry[0]}.${codeEntry[1]}` : body?.error?.status ?? null;
  const retry = body?.error?.details?.map(detail => parseRetryDelay(detail.quotaErrorDetails?.retryDelay)).find(value => value != null) ?? null;
  const message = first?.message || body?.error?.message || body?.error_description || `HTTP ${status}`;
  return { message, code, retryDelayMs: retry };
}

export function createGoogleAdsClient(config: GoogleAdsConfig, deps: { fetch?: FetchFn; sleep?: SleepFn; baseDelayMs?: number } = {}): GoogleAdsClient {
  const doFetch: FetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  const sleep = deps.sleep ?? defaultSleep;
  const baseDelayMs = deps.baseDelayMs ?? 1000;
  const secrets = secretValues(config);
  const clean = (message: unknown) => sanitizeGoogleAdsError(message, secrets);
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - 60_000 > Date.now()) return token.value;
    let response: Response;
    try {
      response = await doFetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken, grant_type: 'refresh_token' }).toString(),
      });
    } catch (error) {
      throw new GoogleAdsApiError(clean(`OAuth token request failed: ${error instanceof Error ? error.message : error}`), 0, null);
    }
    const body = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
    if (!response.ok || !body?.access_token) {
      throw new GoogleAdsApiError(clean(`OAuth refresh failed (${response.status} ${body?.error ?? ''}): ${body?.error_description ?? 'no access token returned'}`), response.status, body?.error ?? null);
    }
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function call<T>(url: string, init: { method: 'GET' | 'POST'; body?: unknown; loginCustomerId?: string | null }): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${await accessToken()}`,
        'developer-token': config.developerToken,
        'content-type': 'application/json',
      };
      const login = init.loginCustomerId === undefined ? config.loginCustomerId : init.loginCustomerId;
      if (login) headers['login-customer-id'] = login;
      let response: Response;
      try {
        response = await doFetch(url, { method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS) { await sleep(baseDelayMs * 2 ** (attempt - 1)); continue; }
        throw new GoogleAdsApiError(clean(`Google Ads request failed: ${error instanceof Error ? error.message : error}`), 0, null);
      }
      if (response.ok) return await response.json() as T;
      const body = await response.json().catch(() => null) as ApiErrorBody | null;
      const info = describeError(response.status, body);
      if (response.status === 401 && attempt === 1) { token = null; continue; }
      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        const header = Number(response.headers.get('retry-after'));
        const wait = info.retryDelayMs ?? (Number.isFinite(header) && header > 0 ? header * 1000 : baseDelayMs * 2 ** (attempt - 1));
        await sleep(Math.min(wait, 120_000));
        continue;
      }
      throw new GoogleAdsApiError(clean(`Google Ads API ${response.status}${info.code ? ` ${info.code}` : ''}: ${info.message}`), response.status, info.code);
    }
  }

  const base = `${GOOGLE_ADS_API_BASE}/${config.apiVersion}`;
  return {
    async listAccessibleCustomers() {
      const body = await call<{ resourceNames?: string[] }>(`${base}/customers:listAccessibleCustomers`, { method: 'GET', loginCustomerId: null });
      return (body.resourceNames ?? []).map(name => name.split('/')[1]).filter((id): id is string => /^[0-9]{10}$/.test(id ?? ''));
    },
    async search(customerId, query, options = {}) {
      assertReadOnlyGaql(query);
      if (!/^[0-9]{10}$/.test(customerId)) throw new Error('Invalid customer id.');
      const rows: GoogleAdsRow[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const body = await call<{ results?: GoogleAdsRow[]; nextPageToken?: string }>(`${base}/customers/${customerId}/googleAds:search`, {
          method: 'POST', body: pageToken ? { query, pageToken } : { query }, loginCustomerId: options.loginCustomerId,
        });
        rows.push(...(body.results ?? []));
        pageToken = body.nextPageToken || undefined;
        if (!pageToken) return rows;
      }
      throw new GoogleAdsApiError('Google Ads search returned too many pages; narrow the date range.', 0, null);
    },
  };
}
