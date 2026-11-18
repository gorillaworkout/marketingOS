import { TREG_DEFAULT_BASE_URL, TREG_ME_PATH, tregBalancePath, tregCallPath } from './treg-endpoints';

/** treg.to client. The token goes in `X-Treg-Token` only; it is never logged, stored or shown. */

export interface TregConfig {
  apiKey: string | null;
  baseUrl: string;
  /** Server-side cap on treg spend per Asia/Jakarta day, in micro-USD. */
  dailyLimitMicro: number;
  /** Below this balance the UI shows a low-balance warning. */
  lowBalanceMicro: number;
  /** Paid runs are admin-only unless TREG_ADMIN_ONLY=false. */
  adminOnly: boolean;
  /** `X-Treg-Org` for identity tokens; org-scoped tokens do not need it. */
  org: string | null;
}

export const DEFAULT_DAILY_LIMIT_USD = 5;
export const DEFAULT_LOW_BALANCE_USD = 2;

function usdToMicro(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return Math.round((Number.isFinite(parsed) && parsed >= 0 && value?.trim() ? parsed : fallback) * 1_000_000);
}

function safeBaseUrl(value: string | undefined): string {
  const text = value?.trim();
  if (!text) return TREG_DEFAULT_BASE_URL;
  try {
    const url = new URL(text);
    // The token travels in a header: refuse plain http so it never leaves in clear text.
    if (url.protocol !== 'https:') return TREG_DEFAULT_BASE_URL;
    return url.origin;
  } catch {
    return TREG_DEFAULT_BASE_URL;
  }
}

export function tregConfig(env: NodeJS.ProcessEnv = process.env): TregConfig {
  return {
    apiKey: env.TREG_API_KEY?.trim() || null,
    baseUrl: safeBaseUrl(env.TREG_BASE_URL),
    dailyLimitMicro: usdToMicro(env.TREG_DAILY_SPEND_LIMIT_USD, DEFAULT_DAILY_LIMIT_USD),
    lowBalanceMicro: usdToMicro(env.TREG_LOW_BALANCE_USD, DEFAULT_LOW_BALANCE_USD),
    adminOnly: env.TREG_ADMIN_ONLY?.trim().toLowerCase() !== 'false',
    org: env.TREG_ORG?.trim() || null,
  };
}

export type TregFailureKind =
  | 'not-configured' | 'unauthorized' | 'insufficient-balance' | 'cost-ceiling' | 'spend-cap'
  | 'rate-limited' | 'timeout' | 'unavailable' | 'provider-error' | 'network';

const REASONS: Record<TregFailureKind, string> = {
  'not-configured': 'not configured',
  unauthorized: 'the token was rejected',
  'insufficient-balance': 'insufficient balance',
  'cost-ceiling': 'the call would cost more than the per-call ceiling',
  'spend-cap': 'treg daily spend cap reached',
  'rate-limited': 'rate limited, try again later',
  timeout: 'the request timed out',
  unavailable: 'the data provider is temporarily unavailable',
  'provider-error': 'the data provider returned an error',
  network: 'could not reach treg',
};

export class TregError extends Error {
  readonly kind: TregFailureKind;
  readonly status: number | null;
  /** Micro-USD treg reported in the refusal body (402), when present. */
  readonly balanceMicro: number | null;
  /** Micro-USD treg charged for this call, when the response carried it. */
  readonly costMicro: number;
  constructor(kind: TregFailureKind, status: number | null = null, extra: { balanceMicro?: number | null; costMicro?: number } = {}) {
    super(`treg unavailable: ${REASONS[kind]}`);
    this.kind = kind;
    this.status = status;
    this.balanceMicro = extra.balanceMicro ?? null;
    this.costMicro = extra.costMicro ?? 0;
  }
}

/** The English notice shown on a run that fell back to Free mode. */
export function tregFallbackNotice(error: unknown): string {
  const kind = error instanceof TregError ? error.kind : 'provider-error';
  return `treg unavailable: ${REASONS[kind]} — showing Free mode`;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TregCallResult {
  body: unknown;
  /** From `X-Treg-Cost-Micro`; null when the header was absent (unmetered call). */
  costMicro: number | null;
  callId: string | null;
}

function intHeader(response: Response, name: string): number | null {
  const value = response.headers.get(name);
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function errorCode(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  const raw = record.error ?? (record.detail && typeof record.detail === 'object' ? (record.detail as Record<string, unknown>).error : record.detail);
  return typeof raw === 'string' ? raw : '';
}

function numberField(body: unknown, field: string): number | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const direct = record[field] ?? (record.detail && typeof record.detail === 'object' ? (record.detail as Record<string, unknown>)[field] : undefined);
  return typeof direct === 'number' && Number.isFinite(direct) ? direct : null;
}

/** Maps a non-2xx treg answer to a failure kind. Branches on the error code, not only the status. */
export function classifyTregFailure(status: number, body: unknown): TregFailureKind {
  const code = errorCode(body);
  if (code === 'insufficient_balance' || code === 'funds_required') return 'insufficient-balance';
  if (code === 'route_max_cost') return 'cost-ceiling';
  if (code === 'platform_daily_cap_reached' || code === 'member_spend_cap_reached') return 'spend-cap';
  if (code === 'provider_rate_limited' || code === 'share_busy' || status === 429) return 'rate-limited';
  if (code === 'provider_capacity_unavailable' || code === 'route_failed' || status === 502 || status === 503 || status === 504) return 'unavailable';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402) return 'insufficient-balance';
  return 'provider-error';
}

/** Meta values may only use [A-Za-z0-9._-:] (max 128) and must not look like an email. */
export function tregMetaHeader(meta: Record<string, string>): string {
  return Object.entries(meta).slice(0, 5)
    .map(([key, value]) => [key.replace(/[^A-Za-z0-9._-]/g, ''), value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 128)])
    .filter(([key, value]) => key && value)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function headers(config: TregConfig, extra: Record<string, string> = {}): Record<string, string> {
  if (!config.apiKey) throw new TregError('not-configured');
  const out: Record<string, string> = { 'X-Treg-Token': config.apiKey, accept: 'application/json', ...extra };
  if (config.org) out['X-Treg-Org'] = config.org;
  return out;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

async function send(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: string }).name) : '';
    throw new TregError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
}

export interface TregCallOptions {
  endpointId: string;
  body: unknown;
  meta?: Record<string, string>;
  idempotencyKey?: string;
  /** Per-call ceiling in USD; treg refuses (402 route_max_cost, nothing charged) above it. */
  maxCostUsd?: number;
  timeoutMs?: number;
  /** GET endpoints (e.g. justoneapi.*) take query parameters instead of a JSON body. Default POST. */
  method?: 'POST' | 'GET';
  query?: Record<string, string>;
}

export async function tregCall(config: TregConfig, options: TregCallOptions, fetchImpl: FetchLike = fetch): Promise<TregCallResult> {
  const isGet = options.method === 'GET';
  const extra: Record<string, string> = isGet ? {} : { 'content-type': 'application/json' };
  const meta = options.meta ? tregMetaHeader(options.meta) : '';
  if (meta) extra['X-Treg-Meta'] = meta;
  if (options.idempotencyKey) extra['Idempotency-Key'] = options.idempotencyKey.slice(0, 200);
  if (options.maxCostUsd && options.maxCostUsd > 0) extra['X-Treg-Route-Max-Cost'] = options.maxCostUsd.toFixed(4);
  const query = isGet && options.query ? `?${new URLSearchParams(options.query)}` : '';
  const response = await send(fetchImpl, `${config.baseUrl}${tregCallPath(options.endpointId)}${query}`, {
    method: isGet ? 'GET' : 'POST',
    headers: headers(config, extra),
    ...(isGet ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
  });
  const costMicro = intHeader(response, 'X-Treg-Cost-Micro');
  const body = await readBody(response);
  if (!response.ok) {
    throw new TregError(classifyTregFailure(response.status, body), response.status, {
      balanceMicro: numberField(body, 'balance_micro'),
      costMicro: costMicro ?? 0,
    });
  }
  return { body, costMicro, callId: response.headers.get('X-Treg-Call-Id') };
}

export interface TregBalance {
  balanceMicro: number;
  fetchedAt: string;
}

async function getJson(config: TregConfig, path: string, fetchImpl: FetchLike): Promise<unknown> {
  const response = await send(fetchImpl, `${config.baseUrl}${path}`, { method: 'GET', headers: headers(config), signal: AbortSignal.timeout(10_000) });
  const body = await readBody(response);
  if (!response.ok) throw new TregError(classifyTregFailure(response.status, body), response.status);
  return body;
}

/** `GET /auth/me` → `org_id`, then `GET /orgs/{org_id}/balance` → `balance_micro`. */
export async function fetchTregBalance(config: TregConfig, fetchImpl: FetchLike = fetch): Promise<TregBalance> {
  const me = await getJson(config, TREG_ME_PATH, fetchImpl);
  const orgId = me && typeof me === 'object' ? (me as Record<string, unknown>).org_id : null;
  if (typeof orgId !== 'number' && typeof orgId !== 'string') throw new TregError('unauthorized');
  const balance = await getJson(config, tregBalancePath(orgId), fetchImpl);
  const micro = numberField(balance, 'balance_micro');
  if (micro === null) throw new TregError('provider-error');
  return { balanceMicro: Math.round(micro), fetchedAt: new Date().toISOString() };
}

export const BALANCE_TTL_MS = 5 * 60_000;
let cached: { value: TregBalance; at: number } | null = null;

/** Balance cached for 5 minutes. A refusal that carries `balance_micro` refreshes it for free. */
export async function cachedTregBalance(config: TregConfig, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<TregBalance> {
  if (cached && now - cached.at < BALANCE_TTL_MS) return cached.value;
  const value = await fetchTregBalance(config, fetchImpl);
  cached = { value, at: now };
  return value;
}

export function rememberTregBalance(balanceMicro: number, now = Date.now()): void {
  cached = { value: { balanceMicro, fetchedAt: new Date(now).toISOString() }, at: now };
}

export function forgetTregBalance(): void {
  cached = null;
}

export function microToUsd(micro: number): number {
  return Math.round(micro) / 1_000_000;
}
