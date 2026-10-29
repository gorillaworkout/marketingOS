/**
 * Search Console property identifiers:
 * - Domain property: `sc-domain:example.com`
 * - URL-prefix property: `https://example.com/` (scheme and trailing slash matter)
 * Mirrors the seo_sites_gsc_property_format CHECK in migration 035.
 */
const PROPERTY_PATTERN = /^(sc-domain:[a-z0-9.-]+|https?:\/\/\S+\/)$/;

export function isValidGscProperty(value: string): boolean {
  return PROPERTY_PATTERN.test(value);
}

/** Returns a normalized property, null for empty input, or undefined when invalid. */
export function normalizeGscProperty(input: unknown): string | null | undefined {
  if (input === null) return null;
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const value = trimmed.toLowerCase().startsWith('sc-domain:') ? `sc-domain:${trimmed.slice('sc-domain:'.length).toLowerCase()}` : trimmed;
  return isValidGscProperty(value) ? value : undefined;
}

export function gscPropertyKind(property: string | null): 'domain' | 'url-prefix' | null {
  if (!property) return null;
  return property.startsWith('sc-domain:') ? 'domain' : 'url-prefix';
}
