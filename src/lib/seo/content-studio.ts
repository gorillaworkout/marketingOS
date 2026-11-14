/** Content Studio v2 checks. Safe to import from the browser. */

export const META_TITLE_MAX = 65;
export const META_DESCRIPTION_MAX = 155;
export const MAX_SUBKEYWORDS = 8;
export const MAX_SUBKEYWORD_LENGTH = 40;

export const SEARCH_INTENTS = ['informational', 'navigational', 'commercial', 'transactional'] as const;
export type SearchIntent = (typeof SEARCH_INTENTS)[number];
export const AUDIENCE_LANGUAGES = ['id', 'en'] as const;
export type AudienceLanguage = (typeof AUDIENCE_LANGUAGES)[number];

const INTENT_GUIDANCE: Record<SearchIntent, string> = {
  informational: 'Intent: informational. Write an explanatory guide with a short answer first and an FAQ. Teach the reader; do not push a signup.',
  navigational: 'Intent: navigational. Keep it concise and brand/page-focused. Give clear paths to the page the reader is looking for.',
  commercial: 'Intent: commercial. Compare options with pros and cons. Help the reader choose. Do not invent reviews.',
  transactional: 'Intent: transactional. Lead with the benefit, use a strong call to action, and give the steps to sign up or buy.',
};

export function parseSearchIntent(value: unknown): SearchIntent {
  return typeof value === 'string' && (SEARCH_INTENTS as readonly string[]).includes(value) ? value as SearchIntent : 'informational';
}

export function parseAudienceLanguage(value: unknown): AudienceLanguage {
  return value === 'en' ? 'en' : 'id';
}

export function parseSubkeywords(value: unknown): string[] {
  let source: unknown = value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { source = JSON.parse(value) as unknown; } catch { source = value; }
  }
  const items = Array.isArray(source) ? source : typeof source === 'string' ? source.split(/[,;\n]+/) : [];
  const keywords: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const keyword = item.replace(/\s+/g, ' ').trim().slice(0, MAX_SUBKEYWORD_LENGTH);
    if (!keyword || keywords.some(existing => existing.toLowerCase() === keyword.toLowerCase())) continue;
    keywords.push(keyword);
    if (keywords.length >= MAX_SUBKEYWORDS) break;
  }
  return keywords;
}

export function enforceMetaText(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).trimEnd();
}

export function intentGuidance(intent: SearchIntent): string {
  return INTENT_GUIDANCE[intent];
}

export function languageGuidance(language: AudienceLanguage): string {
  return language === 'en'
    ? 'Write the article in English. Keep the Content Studio labels out of the article.'
    : 'Write the article in Bahasa Indonesia.';
}

export function headingWarnings(markdown: string): string[] {
  const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(match => ({
    level: match[1].length,
    text: match[2].trim(),
  }));
  const warnings: string[] = [];
  const h1Count = headings.filter(heading => heading.level === 1).length;
  if (h1Count === 0) warnings.push('The article needs exactly one H1.');
  if (h1Count > 1) warnings.push('The article has more than one H1.');
  if (headings.length > 0 && headings[0].level !== 1) warnings.push('Start the article with the H1.');
  let previous = 0;
  for (const heading of headings) {
    if (heading.level > 4) warnings.push(`"${heading.text}" uses H${heading.level}. Keep headings at H1–H4.`);
    if (previous > 0 && heading.level > previous + 1) warnings.push(`"${heading.text}" skips a heading level.`);
    previous = heading.level;
  }
  return warnings;
}

export function subkeywordCoverage(markdown: string, keywords: string[]): Array<{ keyword: string; covered: boolean; inHeading: boolean }> {
  const haystack = markdown.toLowerCase();
  const headings = markdown.split('\n').filter(line => /^#{1,4}\s+/.test(line)).join('\n').toLowerCase();
  return keywords.map(keyword => {
    const needle = keyword.toLowerCase();
    return { keyword, covered: haystack.includes(needle), inHeading: headings.includes(needle) };
  });
}
