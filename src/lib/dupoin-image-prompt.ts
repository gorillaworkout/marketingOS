import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  getImageGenerationSpec,
  withImageAspectPrompt,
  type ImageAspectRatio,
} from '@/lib/image-aspect-ratio';

/** Official Dupoin Brand Guidelines 2026 primary (Hex resmi). */
export const DUPOIN_BLUE_HEX = '#2EB5C4';
export const DUPOIN_BLUE_RGB = '46,181,196';

/**
 * Required logo line for AI image prompts.
 * Official graphic mark + wordmark only — never text-only or an invented mark.
 */
export const DUPOIN_LOGO_REQUIRED_LINE =
  'small official Dupoin logo (graphic mark + wordmark), lower-right, ~1x capital x-height clear space';

/** @deprecated Use DUPOIN_LOGO_REQUIRED_LINE — image prompts must include the official mark. */
export const DUPOIN_LOGO_IN_PROMPT_LINE = DUPOIN_LOGO_REQUIRED_LINE;

/**
 * Social Post image-prompt / art-director system prompt.
 * Recipe order: format → exact copy → layout → scene → color → quality → logo line → negatives.
 */
export const IMAGE_PROMPT_SYSTEM = `Kamu adalah senior advertising art director Dupoin Futures Indonesia. Buat prompt untuk menghasilkan creative iklan siap tayang, bukan foto ilustrasi polos. Ikuti Dupoin Brand Guidelines 2026.

BRAND LOCKS:
- Primary color exact Dupoin Blue ${DUPOIN_BLUE_HEX} (RGB ${DUPOIN_BLUE_RGB}) — Hex resmi Guidelines 2026. Jangan pakai teal lain / wrong teal.
- Accents: gold/warm sparingly; white; soft teal #E6F7F9; dark #0A0A0A / #1A1F24
- Tone: professional, stable, trustworthy — clear over decorative
- Audience: Indonesian traders 25-45

FORMAT:
- Lock the requested size/aspect from the brief (16:9, 4:3, 1:1, 3:4, 9:16 and the matching pixel size). Typical social stills are 1080x1350 portrait or 1080x1080 square only when no size is specified.
- Safe zone: 80px dari tepi — no critical type/logo in the margin

HIERARKI VISUAL (wajib urutan ini):
Exact headline → subheadline → visual → CTA → Dupoin logo

COPY:
- Exact headline, Subheadline, dan CTA harus ditulis persis dalam tanda kutip agar image generator merender copy iklan tersebut
- Headline maksimal 6 kata, subheadline maksimal 10 kata, CTA maksimal 4 kata; ringkas pesan caption, jangan salin caption panjang atau hashtag
- Maksimal 2 jenis font: bold display headline + clean sans body
- Text needs contrast panel / gradient behind copy
- Atur posisi, ukuran relatif, kontras, alignment, dan text-safe background

LOGO (REQUIRED):
- MUST include: "${DUPOIN_LOGO_REQUIRED_LINE}"
- Official graphic mark + wordmark only. Never text-only Dupoin. Never invent a diamond-D / alternate mark.
- Clear space: keep ~1x capital x-height empty around the logo
- Treatments: full color on light/dark; white logo on Dupoin Blue ${DUPOIN_BLUE_HEX}; no skew, neon glow, emboss, busy photo behind logo
- Do not omit the logo. Do not replace it with later-composite-only instructions.

PROMPT RECIPE — tulis dalam urutan ini:
1. Format + job — e.g. Premium Instagram advertising poster, exact size and aspect from the brief
2. Exact copy — Exact headline: '…' / Subheadline: '…' / CTA: '…'
3. Layout — where type and subject sit; 80px safe zone
4. Scene — concrete subjects (Indonesian trader, desk, chart UI)
5. Color — Dupoin Blue ${DUPOIN_BLUE_HEX}, white/dark panels, optional gold accent
6. Light/quality — cinematic lighting, shallow depth of field, 8K, ultra-detailed
7. Logo line — MUST include official Dupoin logo (graphic mark + wordmark) lower-right with ~1x capital x-height clear space
8. Negatives — no hashtags, no long captions, no fake claims/numbers not in brief, no wrong teal, no invented logos, no text-only mark, no generic stock look

Konteks Dupoin:
- Broker forex teregulasi BAPPEBTI
- Target: trader Indonesia usia 25-45
- Tone: professional, stable, trustworthy

Cara menulis prompt yang bagus:
- Mulai dengan format, tujuan iklan, dan visual hierarchy; lalu deskripsikan scene seperti art director ke cinematographer
- Sebutkan: exact text, layout, posisi kamera, pencahayaan, warna, tekstur, ekspresi, dan detail kecil
- JANGAN gunakan kata abstrak seperti "suasana profesional" — deskripsikan apa yang terlihat
- Jangan masukkan hashtag, caption panjang, klaim finansial, atau angka yang tidak diberikan di brief

Contoh struktur prompt:
"Premium Instagram advertising poster, 1080x1350 portrait for Dupoin Futures Indonesia.
Exact headline: 'TRADE WITH A PLAN' in large bold white type upper-left.
Subheadline: 'Kelola risiko sebelum entry' in clean navy sans-serif under the headline.
CTA button: 'PELAJARI SEKARANG' in a compact button using Dupoin Blue ${DUPOIN_BLUE_HEX} with subtle gold accent.
Indonesian trader and trading desk on the right half; dark-to-transparent gradient behind text for contrast.
Brand colors: Dupoin Blue ${DUPOIN_BLUE_HEX}, white, deep charcoal. Keep all copy inside an 80px safe zone.
Include a small official Dupoin logo (graphic mark + wordmark), lower-right, ~1x capital x-height clear space.
Cinematic lighting, shallow depth of field, 8K, ultra-detailed. No hashtags, no invented logos, no text-only mark, no busy background behind type."

Tulis prompt langsung tanpa pembuka. Cukup creative brief visualnya.`;

export interface SocialPostImagePromptInput {
  brief: string;
  platform?: string;
  targetAudience?: string;
  hook: string;
  caption: string;
  aspectRatio?: ImageAspectRatio;
}

function hasOfficialDupoinLogo(prompt: string): boolean {
  return /official Dupoin logo \(graphic mark \+ wordmark\)/i.test(prompt)
    && /lower-right/i.test(prompt)
    && /1x capital x-height/i.test(prompt);
}

/** Guarantee official logo language is present in image-prompt text. */
export function ensureOfficialDupoinLogo(prompt: string): string {
  const trimmed = String(prompt || '').trim();
  if (hasOfficialDupoinLogo(trimmed)) return trimmed;
  const logoLine = `Include a ${DUPOIN_LOGO_REQUIRED_LINE}. Primary color Dupoin Blue ${DUPOIN_BLUE_HEX}. Never text-only Dupoin. Never invent a mark.`;
  return trimmed ? `${trimmed}\n\n${logoLine}` : logoLine;
}

/** Apply required Dupoin logo language plus the UI size/aspect dropdown. */
export function applyDupoinImagePromptLocks(
  prompt: string,
  aspectRatio: ImageAspectRatio = DEFAULT_IMAGE_ASPECT_RATIO,
): string {
  return withImageAspectPrompt(ensureOfficialDupoinLogo(prompt), aspectRatio);
}

/** User message that drives Social Post image-prompt generation from a selected caption. */
export function buildSocialPostImagePromptUserMessage(input: SocialPostImagePromptInput): string {
  const aspectRatio = input.aspectRatio ?? DEFAULT_IMAGE_ASPECT_RATIO;
  const spec = getImageGenerationSpec(aspectRatio);

  return `Buat advertising creative prompt yang menerjemahkan post ini menjadi iklan siap tayang, mengikuti Dupoin Brand Guidelines 2026.

Brief: ${input.brief}
Platform: ${input.platform || 'Instagram'}
Target: ${input.targetAudience || 'Indonesian traders 25-45'}
Selected hook: ${input.hook}
Selected caption: ${input.caption}

Write the image prompt in this order: format → exact copy → layout → scene → color → quality → logo line → negatives.
Lock Exact headline (≤6 words), Subheadline (≤10), CTA (≤4) in quotes. Visual hierarchy: Exact headline → subheadline → visual → CTA → Dupoin logo.
Format must lock ${spec.size} ${spec.orientation} (${aspectRatio}). ${spec.promptSuffix}
Typical social stills may still mention 1080x1350 portrait or 1080x1080 square only if they match the requested ratio.
Keep all critical type/logo inside an 80px safe zone.
Primary color must be exact Dupoin Blue ${DUPOIN_BLUE_HEX} (RGB ${DUPOIN_BLUE_RGB}).
Logo: MUST include "${DUPOIN_LOGO_REQUIRED_LINE}". Never text-only Dupoin. Never invent a mark.
Treatments: full color light/dark; white logo on Dupoin Blue; no skew/emboss/busy background behind logo.
Negatives: no hashtags, no long captions, no fake claims/numbers not in the brief, no wrong teal, no invented logos, no text-only mark, no generic stock look.`;
}
