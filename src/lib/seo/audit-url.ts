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

function ipv4Private(octets: number[]): boolean {
  if (octets.length !== 4 || octets.some(part => part > 255)) return true;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Expands an IPv6 literal to 8 groups. A dotted IPv4 tail counts as the last two groups. */
function expandIpv6(input: string): number[] | null {
  let value = input.toLowerCase();
  let v4: number[] | null = null;
  const dotted = value.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    v4 = dotted[1].split('.').map(Number);
    if (v4.some(part => part > 255)) return null;
    value = value.slice(0, dotted.index).replace(/:$/, '');
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string) => (side ? side.split(':').map(part => Number.parseInt(part || '0', 16)) : []);
  const left = parseSide(halves[0] || '');
  const right = halves.length === 2 ? parseSide(halves[1] || '') : [];
  if ([...left, ...right].some(part => Number.isNaN(part) || part < 0 || part > 0xffff)) return null;
  const width = v4 ? 6 : 8;
  if (halves.length === 1) {
    if (left.length !== width) return null;
  }
  const missing = width - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array(missing).fill(0), ...right];
  if (v4) groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
  return groups.length === 8 ? groups : null;
}

function ipv6Private(groups: number[]): boolean {
  const zero = (count: number) => groups.slice(0, count).every(part => part === 0);
  if (groups.every(part => part === 0)) return true;
  if (zero(7) && groups[7] === 1) return true;
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  if (zero(5) && groups[5] === 0xffff) return ipv4Private([(groups[6] >> 8) & 0xff, groups[6] & 0xff, (groups[7] >> 8) & 0xff, groups[7] & 0xff]);
  if (zero(6)) return ipv4Private([(groups[6] >> 8) & 0xff, groups[6] & 0xff, (groups[7] >> 8) & 0xff, groups[7] & 0xff]);
  return false;
}

export function isIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/** True for private, loopback, link-local, CGNAT, unique-local, and IPv4-mapped forms of those ranges. */
export function isPrivateAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return ipv4Private(ipv4.slice(1).map(Number));
  const groups = expandIpv6(host);
  if (!groups) return false;
  return ipv6Private(groups);
}

export function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata') return false;
  if (isIpLiteral(host)) return !isPrivateAddress(host);
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
