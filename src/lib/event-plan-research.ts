export type EventPlanResearch = {
  status: 'unverified' | 'source-provided';
  sources: Array<{ url: string; claim: 'Needs manual quotation verification' }>;
  contacts: Array<{ vendor: string; phone: string; email: string; sourceUrl: string; verified: false }>;
};

const MAX_RESEARCH_URLS = 5;
const MAX_RESEARCH_URL_LENGTH = 2048;

function isPublicHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return false;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
  const private172 = /^172\.(\d+)\./.exec(host);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
  return !host.startsWith('fc') && !host.startsWith('fd') && !host.startsWith('fe80:');
}

export function normalizeResearchUrls(value: unknown): { urls: string[]; error?: string } {
  const submitted = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(/\r?\n/) : [];
  const urls: string[] = [];
  for (const candidate of submitted) {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > MAX_RESEARCH_URL_LENGTH) {
      return { urls: [], error: 'Research links must be valid public HTTP/HTTPS URLs' };
    }
    try {
      const url = new URL(candidate.trim());
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isPublicHostname(url.hostname)) {
        return { urls: [], error: 'Research links must be valid public HTTP/HTTPS URLs' };
      }
      const normalized = candidate.trim();
      if (!urls.includes(normalized)) urls.push(normalized);
    } catch {
      return { urls: [], error: 'Research links must be valid public HTTP/HTTPS URLs' };
    }
  }
  if (urls.length > MAX_RESEARCH_URLS) return { urls: [], error: 'Research links allow a maximum of 5 URLs' };
  return { urls };
}

export function normalizeResearch(value: unknown, allowedUrls: string[]): EventPlanResearch {
  if (allowedUrls.length === 0) return { status: 'unverified', sources: [], contacts: [] };
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const contacts = Array.isArray(source.contacts) ? source.contacts.flatMap((contact) => {
    if (!contact || typeof contact !== 'object' || Array.isArray(contact)) return [];
    const entry = contact as Record<string, unknown>;
    if (typeof entry.vendor !== 'string' || typeof entry.phone !== 'string' || typeof entry.email !== 'string' || typeof entry.sourceUrl !== 'string' || !allowedUrls.includes(entry.sourceUrl)) return [];
    return [{ vendor: entry.vendor, phone: entry.phone, email: entry.email, sourceUrl: entry.sourceUrl, verified: false as const }];
  }) : [];
  return {
    status: 'source-provided',
    sources: allowedUrls.map((url) => ({ url, claim: 'Needs manual quotation verification' as const })),
    contacts,
  };
}
