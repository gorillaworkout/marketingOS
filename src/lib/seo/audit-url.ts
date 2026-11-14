/** Public URL checks for the website audit. No network, no secrets. */

export const DEFAULT_MAX_PAGES = 100;
export const MAX_PAGES_CAP = 200;
export const AUDIT_CONCURRENCY = 2;
export const AUDIT_TIMEOUT_MS = 10_000;
export const AUDIT_USER_AGENT = 'MarketingOS-SEO-Audit/1.0 (polite site audit; same-host only)';

export function clampMaxPages(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_PAGES;
  return Math.max(1, Math.min(MAX_PAGES_CAP, Math.floor(parsed)));
}

export function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host === '0.0.0.0' || host === '::1' || host === '::') return false;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return true;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some(part => part > 255)) return false;
  const [a, b] = octets;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

export function auditUrlError(value: string): string | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return 'Enter a full http or https URL.'; }
  if (url.username || url.password) return 'The URL cannot include a username or password.';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http and https sites can be audited.';
  if (!isPublicHost(url.hostname)) return 'That host is not a public website.';
  return null;
}

export function normalizeAuditUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = '';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  if (url.pathname !== '/' && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

export function sameHost(left: string, right: string): boolean {
  try { return new URL(left).hostname.toLowerCase() === new URL(right).hostname.toLowerCase(); } catch { return false; }
}

export function defaultAuditUrl(sites: Array<{ site_url: string; active?: boolean }>): string {
  const dupoin = sites.find(site => {
    try { return new URL(site.site_url).hostname.replace(/^www\./, '') === 'dupoin.co.id'; } catch { return false; }
  });
  if (dupoin) return dupoin.site_url;
  return sites.find(site => site.active)?.site_url || sites[0]?.site_url || '';
}
