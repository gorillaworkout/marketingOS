/**
 * Shared claim guard for every generation feature.
 * Safe to import from the browser. No database and no network.
 */

/**
 * Real Dupoin awards and ratings.
 * Sources: dupoin.co.id/en/about-us/our-awards and CNN Indonesia
 * (cnnindonesia.com/ekonomi/20251030180700-83-1290255/pt-dupoin-futures-indonesia-sabet-most-trusted-broker).
 * `keys` are the phrases that identify the award, `issuers` must be named next to it,
 * and `years` are the only years a mention may carry.
 */
export const DUPOIN_VERIFIED_AWARDS = [
  { fact: 'Most Trusted Broker 2025 by CNN Indonesia (CNN Indonesia Awards 2025)', keys: ['most trusted broker'], issuers: ['cnn'], years: ['2025'] },
  { fact: 'Highest Trading Volume Broker 2025 by CNBC Indonesia', keys: ['highest trading volume'], issuers: ['cnbc'], years: ['2025'] },
  { fact: 'Top Futures Broker 2026 by Bloomberg Technoz', keys: ['top futures broker'], issuers: ['bloomberg'], years: ['2026'] },
  { fact: 'Best Growth Trading Platform 2024 by CNBC Indonesia', keys: ['best growth trading platform'], issuers: ['cnbc'], years: ['2024'] },
  { fact: 'peringkat A+++ dari Bappebti 2023–2025', keys: ['a+++'], issuers: ['bappebti'], years: ['2023', '2024', '2025'] },
] as const;

/** Confirmed on the BAPPEBTI register and dupoin.co.id/about-us/licenses. No OJK or BI number: those public sources disagree. */
export const DUPOIN_VERIFIED_FACTS = [
  'PT Dupoin Futures Indonesia is regulated by BAPPEBTI, license 423/BAPPEBTI/SI/VII/2004.',
  'JFX membership SPAB-064/BBJ/04/04.',
  'KBI membership 05/AK-KBI/PN/V/2024.',
  'ASPEBTINDO 0013/ASPEBTINDO/ANG-B/05/2024.',
  'ISO/IEC 27001:2022 certificate 824 153 24006.',
  `Awards: ${DUPOIN_VERIFIED_AWARDS.map(award => award.fact).join('; ')}.`,
].join(' ');

export function usesDupoinFacts(site?: { name?: string | null; siteUrl?: string | null; site_url?: string | null } | null): boolean {
  if (!site) return true;
  const name = (site.name || '').trim().toLowerCase();
  const url = `${site.siteUrl || ''} ${site.site_url || ''}`.toLowerCase();
  if (url.includes('indonesiancheer')) return false;
  if (name === 'ica' || name.startsWith('ica ') || name.includes('ica cheer')) return false;
  return true;
}

/** Brand-guideline key messages plus the built-in Dupoin register, except on the ICA site. */
export function mergeBrandFacts(
  keyMessages?: string | null,
  site?: { name?: string | null; siteUrl?: string | null; site_url?: string | null } | null,
): string {
  const extra = (keyMessages || '').trim();
  if (!usesDupoinFacts(site)) return extra;
  return [DUPOIN_VERIFIED_FACTS, extra].filter(Boolean).join('\n');
}

export const BRAND_FACT_RULES = `VERIFIED_BRAND_FACTS
Never state a license number, regulator registration, award, ranking, statistic, or product feature unless that exact text appears in VERIFIED_BRAND_FACTS.
If VERIFIED_BRAND_FACTS is empty, omit them. Do not invent BAPPEBTI, OJK, or CoFTRA numbers, an award or a "terbaik" claim that VERIFIED_BRAND_FACTS does not list, risk-management tools, a demo account, mentors, live sessions, "terbukti efektif", a personal anecdote, or a webinar or event the brief did not name.
Do not invent attendance, ROI, or other KPIs as facts.
Awards: use them sparingly, as credibility proof only. Mention at most one award per piece, keep the issuer and year exactly as listed, and never make an award the main message, headline, or a promise of profit.
Event Recap and Street Interview: if the brief is a plan, a test, or hypothetical, write a plan or a simulation. Do not present it as documentation of a real event.`;

const CLAIM_PATTERNS = [
  /\d{2,}\s*\/\s*BAPPEBTI\b[^.\n]*/gi,
  /\b(?:BAPPEBTI|OJK|CoFTRA)\b[^.\n]{0,80}\d+/gi,
  /\b(?:No\.|Nomor(?:\s+izin)?|registration(?:\s+number)?|registrasi)\s*[:.]?\s*[A-Z0-9][A-Z0-9./-]{3,}/gi,
  /\bmost[\s-]+trusted\b[^.\n]*/gi,
  /\bCNN\s*20\d{2}\b/gi,
  /\bterbaik\b/gi,
  /\b(?:award|penghargaan)\b[^.\n]{0,40}\b(?:20\d{2}|winner|pemenang|broker)\b/gi,
  /\b(?:best|top|highest|leading|number one|#1)\b[^.\n]{0,40}?\b(?:broker|platform|pialang)\b(?=[^.\n]{0,60}?(?:\b20\d{2}\b|\b(?:by|versi|oleh|awards?)\b))[^.\n]*/gi,
  /\b(?:peringkat|rating|predikat|rated)\s+A\+*(?![\w+])[^.\n]*/gi,
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Case- and punctuation-insensitive form used to match award mentions. */
function loose(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** The sentence or line around a match, so an award can be matched with its issuer. */
function contextAround(text: string, start: number, end: number): string {
  let from = text.lastIndexOf('\n', start - 1) + 1;
  for (const boundary of text.slice(0, start).matchAll(/[.!?]\s/g)) from = Math.max(from, (boundary.index ?? 0) + 1);
  const stop = text.slice(end).search(/[!?\n]|\.(?:\s|$)/);
  return text.slice(from, stop >= 0 ? end + stop : text.length);
}

const ISSUER_OR_YEAR = /^ (?:(?:cnn|cnbc|bloomberg|technoz|bappebti|indonesia|awards?|20\d{2}|by|dari|oleh) )+$/;

function isVerifiedAward(claim: string, context: string, looseFacts: string): boolean {
  const claimLoose = loose(claim);
  const contextLoose = loose(context);
  const years = claimLoose.match(/ 20\d{2}(?= )/g)?.map(year => year.trim()) || [];
  return DUPOIN_VERIFIED_AWARDS.some(award => {
    if (!looseFacts.includes(loose(award.fact))) return false;
    if (!award.issuers.some(issuer => contextLoose.includes(` ${issuer} `))) return false;
    if (!award.keys.some(key => contextLoose.includes(loose(key)))) return false;
    const claimHasKey = award.keys.some(key => claimLoose.includes(loose(key)));
    if (!claimHasKey && !ISSUER_OR_YEAR.test(claimLoose)) return false;
    return years.every(year => (award.years as readonly string[]).includes(year));
  });
}

export function unverifiedClaims(text: string, brandFacts: string): string[] {
  const facts = normalize(brandFacts || '');
  const looseFacts = loose(brandFacts || '');
  const found: string[] = [];
  for (const pattern of CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const claim = match[0].replace(/\s+/g, ' ').trim();
      if (!claim || facts.includes(normalize(claim))) continue;
      const start = match.index ?? 0;
      if (isVerifiedAward(claim, contextAround(text, start, start + match[0].length), looseFacts)) continue;
      if (!found.some(item => normalize(item) === normalize(claim))) found.push(claim);
    }
  }
  return found;
}

export function guardGeneratedText(text: string, brandFacts = ''): { text: string; warnings: string[] } {
  const claims = unverifiedClaims(text, brandFacts);
  if (!claims.length) return { text, warnings: [] };
  // Work line by line so Markdown structure (headings, lists, tables) survives.
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || unverifiedClaims(line, brandFacts).length === 0) { kept.push(line); continue; }
    if (line.trim().startsWith('|')) continue;
    const marker = line.match(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)?/)?.[0] ?? '';
    const sentences = line.slice(marker.length).split(/(?<=[.!?])\s+/);
    const rest = sentences.filter(sentence => unverifiedClaims(sentence, brandFacts).length === 0).join(' ').replace(/[ \t]+/g, ' ').trim();
    if (rest) kept.push(`${marker}${rest}`);
  }
  const next = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: next,
    warnings: claims.slice(0, 3).map(claim => `Removed an unverified claim: "${claim}".`),
  };
}

export function guardField(value: string, brandFacts: string): { text: string; warnings: string[] } {
  return guardGeneratedText(value, brandFacts);
}
