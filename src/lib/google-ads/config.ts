/**
 * Google Ads API credentials, read only from the server environment
 * (.env.local on the VPS). Values are never logged, returned to the browser,
 * or written to the database. Only key names are ever shown.
 */

export const GOOGLE_ADS_REQUIRED_ENV_KEYS = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
] as const;

/** Optional: extra client account ids (comma separated) synced on top of every account under the MCC. */
export const GOOGLE_ADS_OPTIONAL_ENV_KEYS = ['GOOGLE_ADS_CUSTOMER_IDS', 'GOOGLE_ADS_API_VERSION'] as const;

export const DEFAULT_GOOGLE_ADS_API_VERSION = 'v23';

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** MCC (manager) id, 10 digits, no dashes. Sent as the login-customer-id header. */
  loginCustomerId: string;
  /** Extra client ids from GOOGLE_ADS_CUSTOMER_IDS, 10 digits each. */
  customerIds: string[];
  apiVersion: string;
}

export class GoogleAdsConfigError extends Error {
  constructor(message: string, readonly missing: string[] = []) {
    super(message);
    this.name = 'GoogleAdsConfigError';
  }
}

/** '123-456-7890' or ' 1234567890 ' -> '1234567890'; null when it is not a 10-digit id. */
export function normalizeCustomerId(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/[\s-]/g, '');
  return /^[0-9]{10}$/.test(digits) ? digits : null;
}

/** '1234567890' -> '123-456-7890' (how Google Ads shows ids). */
export function formatCustomerId(id: string): string {
  return /^[0-9]{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

/** Last 4 digits only, for logs. */
export function maskCustomerId(id: string): string {
  return `…${String(id).slice(-4)}`;
}

export type GoogleAdsConfigStatus =
  | { configured: true; config: GoogleAdsConfig }
  | { configured: false; missing: string[]; invalid: string[] };

export function readGoogleAdsConfig(env: Record<string, string | undefined> = process.env): GoogleAdsConfigStatus {
  const value = (key: string) => (env[key] ?? '').trim();
  const missing = GOOGLE_ADS_REQUIRED_ENV_KEYS.filter(key => !value(key));
  const invalid: string[] = [];
  const loginCustomerId = normalizeCustomerId(value('GOOGLE_ADS_LOGIN_CUSTOMER_ID'));
  if (value('GOOGLE_ADS_LOGIN_CUSTOMER_ID') && !loginCustomerId) invalid.push('GOOGLE_ADS_LOGIN_CUSTOMER_ID');
  const rawIds = value('GOOGLE_ADS_CUSTOMER_IDS').split(',').map(item => item.trim()).filter(Boolean);
  const customerIds = [...new Set(rawIds.map(normalizeCustomerId).filter((id): id is string => Boolean(id)))];
  if (rawIds.length !== rawIds.filter(id => normalizeCustomerId(id)).length) invalid.push('GOOGLE_ADS_CUSTOMER_IDS');
  const apiVersion = value('GOOGLE_ADS_API_VERSION') || DEFAULT_GOOGLE_ADS_API_VERSION;
  if (!/^v[0-9]{2}$/.test(apiVersion)) invalid.push('GOOGLE_ADS_API_VERSION');
  if (missing.length || invalid.length || !loginCustomerId) return { configured: false, missing: [...missing], invalid };
  return {
    configured: true,
    config: {
      developerToken: value('GOOGLE_ADS_DEVELOPER_TOKEN'),
      clientId: value('GOOGLE_ADS_CLIENT_ID'),
      clientSecret: value('GOOGLE_ADS_CLIENT_SECRET'),
      refreshToken: value('GOOGLE_ADS_REFRESH_TOKEN'),
      loginCustomerId,
      customerIds,
      apiVersion,
    },
  };
}

export function requireGoogleAdsConfig(env: Record<string, string | undefined> = process.env): GoogleAdsConfig {
  const status = readGoogleAdsConfig(env);
  if (status.configured) return status.config;
  const parts = [
    status.missing.length ? `missing ${status.missing.join(', ')}` : '',
    status.invalid.length ? `invalid ${status.invalid.join(', ')}` : '',
  ].filter(Boolean);
  throw new GoogleAdsConfigError(`Google Ads is not configured on the server (${parts.join('; ')}). Add the keys to .env.local and restart MarketingOS.`, status.missing);
}

/** Every secret value in the config, for redaction. */
export function secretValues(config: Partial<GoogleAdsConfig> | null | undefined): string[] {
  if (!config) return [];
  return [config.developerToken, config.clientId, config.clientSecret, config.refreshToken].filter((item): item is string => Boolean(item && item.length >= 6));
}

/**
 * Removes tokens and credentials from an error message: configured secret
 * values, OAuth access tokens (ya29.*), refresh tokens (1//*), Bearer headers,
 * and client secrets (GOCSPX-*). Also trims the message.
 */
export function sanitizeGoogleAdsError(message: unknown, secrets: string[] = []): string {
  let text = message instanceof Error ? message.message : String(message ?? 'Unknown error');
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  text = text
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/1\/\/[A-Za-z0-9._-]{10,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/GOCSPX-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/(developer[-_]?token|client[-_]?secret|refresh[-_]?token|access[-_]?token)(["']?\s*[:=]\s*["']?)[^\s"',&]+/gi, '$1$2[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}
