import { defaultHostLookup, hostResolvesPublic, type HostLookup } from '@/lib/seo/audit-crawl';

/**
 * One public GET for Competitor Intelligence (brand hub pages, help-center
 * JSON, public Instagram post pages). Same SSRF guard as the site crawl: every
 * hop must resolve to public addresses only. No cookies, no login, honest
 * user agent; a login wall simply yields no caption.
 */
export const PUBLIC_FETCH_USER_AGENT = 'MarketingOS-Partnership/1.0 (public pages only)';
const MAX_REDIRECTS = 4;
const BODY_CAP = 1_500_000;

export async function fetchPublic(
  url: string,
  accept = 'text/html,application/xhtml+xml',
  options: { timeoutMs?: number; lookup?: HostLookup; fetchImpl?: typeof fetch } = {},
): Promise<{ url: string; status: number; body: string } | null> {
  const lookup = options.lookup ?? defaultHostLookup;
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return null; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!(await hostResolvesPublic(parsed.hostname, lookup))) return null;
    let response: Response;
    try {
      response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? 12_000), headers: { 'user-agent': PUBLIC_FETCH_USER_AGENT, accept }, cache: 'no-store' });
    } catch {
      return null;
    }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    const length = Number(response.headers.get('content-length') || 0);
    const body = length > BODY_CAP ? '' : (await response.text().catch(() => '')).slice(0, BODY_CAP);
    return { url: current, status: response.status, body };
  }
  return null;
}
