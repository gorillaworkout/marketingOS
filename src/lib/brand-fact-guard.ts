/**
 * Shared claim guard for every generation feature.
 * Safe to import from the browser. No database and no network.
 */

export const BRAND_FACT_RULES = `VERIFIED_BRAND_FACTS
Never state a license number, regulator registration, award, ranking, statistic, or product feature unless that exact text appears in VERIFIED_BRAND_FACTS.
If VERIFIED_BRAND_FACTS is empty, omit them. Do not invent BAPPEBTI, OJK, or CoFTRA numbers, a "most trusted" or "terbaik" award, risk-management tools, a demo account, mentors, live sessions, "terbukti efektif", a personal anecdote, or a webinar or event the brief did not name.
Do not invent attendance, ROI, or other KPIs as facts.
Event Recap and Street Interview: if the brief is a plan, a test, or hypothetical, write a plan or a simulation. Do not present it as documentation of a real event.`;

const CLAIM_PATTERNS = [
  /\d{2,}\s*\/\s*BAPPEBTI\b[^.\n]*/gi,
  /\b(?:BAPPEBTI|OJK|CoFTRA)\b[^.\n]{0,80}\d+/gi,
  /\b(?:No\.|Nomor(?:\s+izin)?|registration(?:\s+number)?|registrasi)\s*[:.]?\s*[A-Z0-9][A-Z0-9./-]{3,}/gi,
  /\bmost trusted\b[^.\n]*/gi,
  /\bCNN\s*20\d{2}\b/gi,
  /\bterbaik\b/gi,
  /\b(?:award|penghargaan)\b[^.\n]{0,40}\b(?:20\d{2}|winner|pemenang|broker)\b/gi,
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function unverifiedClaims(text: string, brandFacts: string): string[] {
  const facts = normalize(brandFacts || '');
  const found: string[] = [];
  for (const pattern of CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const claim = match[0].replace(/\s+/g, ' ').trim();
      if (!claim || facts.includes(normalize(claim))) continue;
      if (!found.some(item => normalize(item) === normalize(claim))) found.push(claim);
    }
  }
  return found;
}

export function guardGeneratedText(text: string, brandFacts = ''): { text: string; warnings: string[] } {
  const claims = unverifiedClaims(text, brandFacts);
  if (!claims.length) return { text, warnings: [] };
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter(sentence => unverifiedClaims(sentence, brandFacts).length === 0);
  const next = kept.join(' ').replace(/\s+/g, ' ').trim();
  return {
    text: next,
    warnings: claims.slice(0, 3).map(claim => `Removed an unverified claim: "${claim}".`),
  };
}

export function guardField(value: string, brandFacts: string): { text: string; warnings: string[] } {
  return guardGeneratedText(value, brandFacts);
}
