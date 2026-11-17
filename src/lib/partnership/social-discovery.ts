// Free discovery of a competitor's official social accounts from its own website
// (homepage + footer/contact/about pages), with an optional web-search fallback
// when SERPER_API_KEY is configured. Never invents a handle: every suggestion
// carries the page it was found on. Nothing is saved here.

import { SOCIAL_PLATFORMS, handleFromUrl, type SocialPlatform } from './social';
import { mentionsCompetitor } from './intel';

export interface SocialCandidate {
  platform: SocialPlatform; handle: string; url: string; sourceUrl: string; via: 'website' | 'web-search';
  /** 2 = a visible link (href), 1 = a URL only in scripts/JSON (schema sameAs can be stale), or llms.txt text. */
  weight?: number;
}
export interface SocialSuggestion extends SocialCandidate {
  /** How many links on the site pointed at this account. */
  count: number;
  /** Other accounts found for the same platform (regional pages etc.). */
  alternatives: Array<{ handle: string; url: string; sourceUrl: string; count: number }>;
}
export interface DiscoveryResult { suggestions: SocialSuggestion[]; pagesRead: string[]; notes: string[] }

export interface DiscoveryDeps {
  fetchPublic(url: string, accept?: string): Promise<{ url: string; status: number; body: string } | null>;
  /** Null when no web-search key is configured. */
  searchWeb?(query: string): Promise<Array<{ title: string; url: string; snippet: string }> | null>;
}

export const DISCOVERY_PATHS = ['/contact', '/contact-us', '/about', '/about-us', '/hubungi-kami', '/kontak', '/tentang-kami'];
export const MAX_DISCOVERY_PAGES = 6;
const PAGE_HINT = /(contact|kontak|hubungi|about|tentang|social|sosial|follow|community|komunitas)/i;

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/\\\//g, '/');
}

/** Every href on a page (weight 2), plus social URLs that appear only in scripts/JSON such as schema sameAs (weight 1). */
export function pageLinks(html: string, baseUrl: string): Array<{ url: string; weight: number }> {
  const out: Array<{ url: string; weight: number }> = [];
  const push = (raw: string, weight: number) => {
    try { out.push({ url: new URL(decodeEntities(raw.trim()), baseUrl).toString(), weight }); } catch { /* ignore */ }
  };
  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"'#][^"']*)["']/gi)) push(match[1], 2);
  // Footers rendered by JS often carry the links only in JSON (Next.js data, schema sameAs).
  for (const match of html.matchAll(/https?:(?:\\\/|\/){2}(?:www\.|m\.)?(?:instagram\.com|tiktok\.com|facebook\.com|fb\.com|youtube\.com|x\.com|twitter\.com|linkedin\.com|t\.me|telegram\.me)(?:\\\/|\/)[^"'\s<>)\\]*/gi)) push(match[0], 1);
  return out;
}

/** Social profile links on one page; share/intent links, posts, and generic platform pages are dropped. */
export function extractSocialCandidates(html: string, pageUrl: string): SocialCandidate[] {
  const best = new Map<string, SocialCandidate>();
  for (const link of pageLinks(html, pageUrl)) {
    const found = handleFromUrl(link.url);
    if (!found) continue;
    const key = `${found.platform}:${found.handle.toLowerCase()}`;
    const current = best.get(key);
    if (!current || (current.weight ?? 0) < link.weight) best.set(key, { ...found, url: link.url, sourceUrl: pageUrl, via: 'website', weight: link.weight });
  }
  return [...best.values()];
}

/** The same URL on www.<host> or on the apex host. */
export function alternateHost(website: string): string | null {
  try {
    const url = new URL(website);
    url.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
    return url.toString();
  } catch { return null; }
}

/** Host the website redirected to, when it is a different site (not just www/apex). */
export function redirectedHost(website: string, finalUrl: string): string | null {
  try {
    const from = new URL(website).hostname.replace(/^www\./, '');
    const to = new URL(finalUrl).hostname.replace(/^www\./, '');
    return from === to ? null : to;
  } catch { return null; }
}

/** The /id/ locale page of a site, unless the URL is already under a locale path. */
export function localePage(homeUrl: string): string | null {
  try {
    const url = new URL(homeUrl);
    if (/^\/id(-[a-z]{2})?(\/|$)/i.test(url.pathname)) return null;
    return new URL('/id/', url.origin).toString();
  } catch { return null; }
}

/** Same-host pages worth reading for footer/contact links, from the homepage's own links. */
export function discoveryPages(homeUrl: string, homeHtml: string): string[] {
  const home = new URL(homeUrl);
  const pages = new Set<string>();
  for (const link of pageLinks(homeHtml, homeUrl)) {
    try {
      const url = new URL(link.url);
      if (url.hostname !== home.hostname || !PAGE_HINT.test(url.pathname)) continue;
      url.hash = ''; url.search = '';
      pages.add(url.toString());
    } catch { /* ignore */ }
  }
  for (const path of DISCOVERY_PATHS) pages.add(new URL(path, home.origin).toString());
  pages.delete(home.toString());
  return [...pages].slice(0, MAX_DISCOVERY_PAGES);
}

/** Group candidates per platform; the account linked most often (homepage first on ties) wins. */
export function rankCandidates(candidates: SocialCandidate[]): SocialSuggestion[] {
  const suggestions: SocialSuggestion[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const groups = new Map<string, { first: SocialCandidate; count: number; score: number; top: number; order: number }>();
    candidates.forEach((candidate, index) => {
      if (candidate.platform !== platform) return;
      // YouTube: c/Name and @Name are the same channel; show the @ form.
      const key = platform === 'youtube' ? candidate.handle.replace(/^(@|c\/)/, '').toLowerCase() : candidate.handle.toLowerCase();
      const weight = candidate.weight ?? 2;
      const group = groups.get(key);
      if (group) {
        group.count += 1; group.score += weight; group.top = Math.max(group.top, weight);
        if ((group.first.weight ?? 2) < weight || (platform === 'youtube' && candidate.handle.startsWith('@') && !group.first.handle.startsWith('@'))) group.first = candidate;
      } else groups.set(key, { first: candidate, count: 1, score: weight, top: weight, order: index });
    });
    // Strongest single signal first (an /id/ locale link > a visible link > a script/schema-only URL,
    // which is often a stale legacy account), then how often the site links it.
    const sorted = [...groups.values()].sort((a, b) => b.top - a.top || b.score - a.score || a.order - b.order);
    if (!sorted.length) continue;
    const [best, ...rest] = sorted;
    suggestions.push({
      ...best.first, count: best.count,
      alternatives: rest.slice(0, 4).map(group => ({ handle: group.first.handle, url: group.first.url, sourceUrl: group.first.sourceUrl, count: group.count })),
    });
  }
  return suggestions;
}

/**
 * Read the website (homepage + up to MAX_DISCOVERY_PAGES contact/about pages) and
 * suggest one account per platform. When a platform is still missing and a web-search
 * key exists, one search per missing platform looks for the profile; a result counts only
 * when its title or snippet names the competitor.
 */
export async function discoverSocialAccounts(competitor: { name: string; website: string | null; region?: string }, deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const notes: string[] = [];
  const pagesRead: string[] = [];
  const candidates: SocialCandidate[] = [];
  if (competitor.website) {
    let home = await deps.fetchPublic(competitor.website).catch(() => null);
    // Some CDNs refuse one of www / apex for non-browser clients: try the other once.
    const alternate = alternateHost(competitor.website);
    if ((!home || home.status !== 200) && alternate) home = await deps.fetchPublic(alternate).catch(() => null) ?? home;
    if (home && home.status === 200) {
      const read = async (url: string, boost = 0) => {
        if (pagesRead.length >= MAX_DISCOVERY_PAGES + 2) return null;
        const answer = url === home!.url ? home : await deps.fetchPublic(url).catch(() => null);
        if (!answer || answer.status !== 200 || pagesRead.includes(answer.url)) return null;
        pagesRead.push(answer.url);
        candidates.push(...extractSocialCandidates(answer.body, answer.url).map(candidate => ({ ...candidate, weight: (candidate.weight ?? 2) + boost })));
        return answer;
      };
      await read(home.url);
      const moved = redirectedHost(competitor.website, home.url);
      if (moved) notes.push(`The website now redirects to ${moved} (rebrand or new domain?). Check the website field.`);
      // Brokers often keep Indonesian accounts on the /id/ locale, which can differ from the global ones.
      // Dupoin's market is Indonesia, so accounts linked there rank first (global ones stay as alternatives).
      const locale = localePage(home.url);
      if (locale) await read(locale, 2);
      for (const page of discoveryPages(home.url, home.body)) await read(page);
    } else {
      notes.push(`Could not read ${competitor.website}${home ? ` (HTTP ${home.status})` : ''}.`);
    }
    // llms.txt: some JS-only or bot-protected sites list their official accounts there.
    const llmsUrl = (() => { try { return new URL('/llms.txt', home && home.status === 200 ? home.url : competitor.website!).toString(); } catch { return null; } })();
    const llms = llmsUrl ? await deps.fetchPublic(llmsUrl, 'text/plain').catch(() => null) : null;
    if (llms && llms.status === 200 && !/<html/i.test(llms.body.slice(0, 500))) {
      pagesRead.push(llms.url);
      for (const match of llms.body.matchAll(/https?:\/\/[^\s)<>"'\]]+/g)) {
        const account = handleFromUrl(match[0]);
        if (account) candidates.push({ ...account, url: match[0], sourceUrl: llms.url, via: 'website', weight: 2 });
      }
    }
    if (pagesRead.length) notes.unshift(`Website: read ${pagesRead.length} page(s).`);
  } else {
    notes.push('No website on file, so the website was not read.');
  }
  const found = new Set(candidates.map(candidate => candidate.platform));
  const missing = SOCIAL_PLATFORMS.filter(platform => !found.has(platform) && platform !== 'telegram' && platform !== 'linkedin');
  if (missing.length && deps.searchWeb) {
    const domains: Record<string, string> = { instagram: 'instagram.com', tiktok: 'tiktok.com', facebook: 'facebook.com', youtube: 'youtube.com', x: 'x.com' };
    let configured = true;
    for (const platform of missing) {
      const hits = await deps.searchWeb(`"${competitor.name.replace(/"/g, '')}" site:${domains[platform]}`).catch(() => []);
      if (hits === null) { configured = false; break; }
      for (const hit of hits) {
        const account = handleFromUrl(hit.url);
        if (!account || account.platform !== platform) continue;
        if (!mentionsCompetitor(`${hit.title} ${hit.snippet} ${account.handle}`, competitor.name)) continue;
        candidates.push({ ...account, url: hit.url, sourceUrl: hit.url, via: 'web-search' });
        break;
      }
    }
    notes.push(configured ? `Web search: looked for ${missing.join(', ')}.` : 'Web search skipped: SERPER_API_KEY is not configured.');
  } else if (missing.length) {
    notes.push('Web search skipped: SERPER_API_KEY is not configured.');
  }
  return { suggestions: rankCandidates(candidates), pagesRead, notes };
}
