import { auditUrlError, isPublicHost, normalizeAuditUrl } from './audit-url';

export interface DomainRef { url: string; host: string }

export function parseDomain(value: string): DomainRef | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { error: 'Enter a domain.' };
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const invalid = auditUrlError(withScheme);
  if (invalid) return { error: invalid };
  const url = new URL(withScheme);
  if (!isPublicHost(url.hostname)) return { error: 'That host is not a public website.' };
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return { url: normalizeAuditUrl(url.toString()), host };
}

export function gscSourceMessage(input: {
  domain: string;
  gscProperty: string | null;
  storedRows: number;
  connectedSites?: Array<{ name: string; gscProperty: string | null; storedRows: number }>;
}): string {
  let host = input.domain.trim();
  try { host = new URL(input.domain).hostname.replace(/^www\./, ''); } catch { /* keep the typed value */ }
  if (input.storedRows > 0) {
    const property = input.gscProperty ? ` (${input.gscProperty})` : '';
    return `Using ${input.storedRows.toLocaleString('en-US')} stored Search Console queries from seo:sync for ${host}${property}.`;
  }
  const others = (input.connectedSites ?? []).filter(site => site.storedRows > 0 && site.gscProperty);
  const otherText = others.length
    ? ` Stored Search Console queries currently exist only for ${others.map(site => `${site.name} (${site.gscProperty})`).join(', ')}.`
    : '';
  if (!input.gscProperty) {
    return `${host} has no Search Console property and no synced queries. Free mode uses a Queries CSV or XLSX upload until GSC is configured for this domain.${otherText}`;
  }
  return `${host} has Search Console property ${input.gscProperty}, but no synced query rows yet. Upload a Queries export, or run seo:sync.${otherText}`;
}

export function parseCompetitors(value: string, ourHost: string): { domains: DomainRef[]; error: string | null } {
  const parts = value.split(/[\n,]+/).map(part => part.trim()).filter(Boolean);
  if (parts.length < 1 || parts.length > 5) return { domains: [], error: 'Enter 1 to 5 competitor domains.' };
  const domains: DomainRef[] = [];
  for (const part of parts) {
    const parsed = parseDomain(part);
    if ('error' in parsed) return { domains: [], error: parsed.error };
    if (parsed.host === ourHost) return { domains: [], error: 'A competitor domain has to be different from our domain.' };
    if (domains.some(domain => domain.host === parsed.host)) continue;
    domains.push(parsed);
  }
  if (!domains.length) return { domains: [], error: 'Enter 1 to 5 competitor domains.' };
  return { domains, error: null };
}
