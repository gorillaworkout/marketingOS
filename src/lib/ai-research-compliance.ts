/**
 * Light, heuristic scan of a finished research answer.
 * This is a writing reminder for marketing, not a legal review.
 */

export const COMPLIANCE_BANNER_TEXT = 'Perhatian compliance — review sebelum dipakai ke konten publik.';

export type ComplianceFlagKind = 'guaranteed-return' | 'aggressive-solicitation';

export interface ComplianceFlag {
  kind: ComplianceFlagKind;
  label: string;
  excerpt: string;
}

export interface ComplianceScan {
  flagged: boolean;
  flags: ComplianceFlag[];
}

const FLAG_LABEL: Record<ComplianceFlagKind, string> = {
  'guaranteed-return': 'Bahasa jaminan imbal hasil',
  'aggressive-solicitation': 'Ajakan buka akun yang menekan',
};

/** Calm Dupoin account CTA used by Article Market News. Not a pressure pattern. */
const NORMAL_DUPOIN_CTA = /buka akun dupoin untuk memantau pergerakan pasar dengan pengelolaan risiko\.?/gi;

const GUARANTEED_PATTERNS: RegExp[] = [
  /pasti\s+untung/i,
  /untung\s+pasti/i,
  /pasti\s+cuan/i,
  /cuan\s+pasti/i,
  /profit\s+pasti/i,
  /dijamin\s+(?:untung|profit|cuan|balik|kembali|imbal)/i,
  /jaminan\s+(?:untung|profit|imbal|return)/i,
  /imbal\s+hasil\s+(?:pasti|dijamin|terjamin)/i,
  /return\s+terjamin/i,
  /guaranteed\s+(?:return|profit|income|yield)s?/i,
  /risk[-\s]?free(?:\s+return)?/i,
  /\bno\s+risk\b/i,
  /(?:untung|profit|cuan|imbal hasil|return|trading|modal)\s+tanpa\s+risiko/i,
  /tanpa\s+risiko\s+(?:kerugian|rugi|sama\s+sekali)/i,
  /bebas\s+risiko/i,
  /tidak\s+(?:akan\s+)?mungkin\s+rugi/i,
  /100\s*%\s*(?:profit|untung|cuan|aman)/i,
  /pasti\s+balik\s+modal/i,
  /modal\s+pasti\s+kembali/i,
];

const PRESSURE = /(segera|buruan|sekarang juga|wajib|jangan sampai|sebelum terlambat|kesempatan terakhir|last chance|act now|hanya hari ini|terbatas)/i;
const SOLICIT = /(buka akun|daftar(?:kan)?|deposit|hubungi kami|open an account)/i;

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function negatedBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 56), index);
  return /\b(tidak|bukan|jangan|hindari|avoid|no|not|never)\b/i.test(before);
}

function firstHit(text: string, pattern: RegExp): { index: number; match: string } | null {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let found: RegExpExecArray | null;
  while ((found = re.exec(text))) {
    if (negatedBefore(text, found.index)) continue;
    return { index: found.index, match: found[0] };
  }
  return null;
}

function excerptAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf('.', index - 1) + 1, text.lastIndexOf('!', index - 1) + 1, text.lastIndexOf('?', index - 1) + 1);
  const nextStop = ['.', '!', '?'].map(mark => {
    const at = text.indexOf(mark, index);
    return at === -1 ? text.length : at + 1;
  });
  const end = Math.min(...nextStop);
  const sentence = squash(text.slice(start, end));
  if (sentence.length <= 180) return sentence;
  return `${sentence.slice(0, 179).trim()}…`;
}

function withoutNormalCta(text: string): string {
  return text.replace(NORMAL_DUPOIN_CTA, ' ');
}

export function scanResearchCompliance(answer: string): ComplianceScan {
  const text = squash(answer);
  if (!text) return { flagged: false, flags: [] };

  const flags: ComplianceFlag[] = [];
  const guaranteedSource = withoutNormalCta(text);
  for (const pattern of GUARANTEED_PATTERNS) {
    const hit = firstHit(guaranteedSource, pattern);
    if (!hit) continue;
    flags.push({
      kind: 'guaranteed-return',
      label: FLAG_LABEL['guaranteed-return'],
      excerpt: excerptAround(guaranteedSource, hit.index),
    });
    break;
  }

  const solicitationSource = withoutNormalCta(text);
  const chunks = solicitationSource.split(/(?<=[.!?])\s+|\n+/);
  let cursor = 0;
  for (const chunk of chunks) {
    const piece = chunk.trim();
    const local = piece.toLowerCase();
    const pressureAt = local.search(PRESSURE);
    const solicitAt = local.search(SOLICIT);
    if (piece && pressureAt !== -1 && solicitAt !== -1) {
      const index = cursor + Math.min(pressureAt, solicitAt);
      if (!negatedBefore(solicitationSource, cursor + pressureAt) && !negatedBefore(solicitationSource, cursor + solicitAt)) {
        flags.push({
          kind: 'aggressive-solicitation',
          label: FLAG_LABEL['aggressive-solicitation'],
          excerpt: excerptAround(solicitationSource, index),
        });
        break;
      }
    }
    cursor += chunk.length + 1;
  }

  return { flagged: flags.length > 0, flags };
}
